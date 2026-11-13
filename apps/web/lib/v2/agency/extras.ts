/**
 * Buying seats and sites beyond the Agency plan's own (CC-31 D4; docs/specs/v2/31-agency.md §7): one
 * `subscriptions.update` on the account's subscription, through CC-03's catalog and Stripe client.
 * The route has already established the owner (`seat_may('buy_seats')`) and the tier.
 *
 * This writes no limit. `accounts.seat_limit` and `site_limit` change when the webhook applies the
 * subscription Stripe confirms (`mirrorOf`, `limitsFor`), so a request cannot set one.
 *
 * Refused before any Stripe call: quantities the plan does not sell (`limitsFor`), more extra seats
 * than `MAX_EXTRA_SEATS`, and a limit below what the account uses (`in_use`), so the webhook does not
 * remove a person or pause a site because of a request made here. Refused once the subscription is
 * read: one that is set to end, one that is not `active` (a trial's included), one whose items are not
 * the catalog's Agency plan (`mirrorOf`), and a change that raises one quantity and lowers the other
 * (`mixed_change`): one update has one proration rule, and a raise's would credit the lowered item.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { z } from 'zod';
import { limitsFor, type Extras } from '../../entitlement-v2';
import type { Catalog, Interval } from '../../billing/catalog';
import { CatalogError } from '../../billing/stripe-catalog';
import { mirrorOf } from '../../billing/subscription-mirror';
import { noticeTo, refuse, type NoticeCode, type RequestBody } from '../account/route';
import { MAX_EXTRA_SEATS } from './extras-bounds';

export { MAX_EXTRA_SEATS } from './extras-bounds';

/**
 * A raised quantity is invoiced at once for the rest of the period, and the change is refused when
 * that invoice cannot be paid, so the limit never rises on an unpaid invoice (owner ruling, Q4).
 */
export const RAISE = {
  proration_behavior: 'always_invoice',
  payment_behavior: 'error_if_incomplete',
} as const satisfies Stripe.SubscriptionUpdateParams;

/** A lowered quantity is not credited: it bills from the next invoice (owner ruling, Q4). */
export const LOWER = {
  proration_behavior: 'none',
} as const satisfies Stripe.SubscriptionUpdateParams;

/** A form posts each quantity as digits; JSON sends the number. */
const quantity = z.preprocess(
  (v) => (typeof v === 'string' && /^\d{1,3}$/.test(v) ? Number(v) : v),
  z.int().min(0),
);

const ExtrasBody = z.strictObject({
  seats: quantity,
  sites: quantity,
  accountId: z.uuid().optional(),
});

export type ExtrasInput = z.infer<typeof ExtrasBody>;

/**
 * POST /api/billing/seats: `{seats, sites}`, the extra quantities wanted (absolute, so a retry asks
 * for the same thing), and optionally the account. It has no field for a limit or a price.
 */
export function parseExtras(body: RequestBody): ExtrasInput | null {
  const parsed = ExtrasBody.safeParse(body.fields);
  return parsed.success ? parsed.data : null;
}

/** What the account holds and uses, read with the service role. */
export interface ExtrasAccount {
  /** The subscription the account follows, with the last event its mirror row applied. */
  subscription: { id: string; lastEventId: string | null } | null;
  /** Active seats, and invited ones whose link has not expired. */
  seatsInUse: number;
  /** Live sites that are not staging copies. */
  sitesInUse: number;
}

export interface ExtrasAccounts {
  /** Null when there is no such account. */
  read(accountId: string, now: Date): Promise<ExtrasAccount | null>;
}

/** The Stripe calls a change of extras makes. */
export interface ExtrasStripe {
  subscriptions: {
    retrieve(id: string): PromiseLike<Stripe.Subscription>;
    update(
      id: string,
      params: Stripe.SubscriptionUpdateParams,
      options: { idempotencyKey: string },
    ): PromiseLike<Stripe.Subscription>;
  };
}

export interface ExtrasDeps {
  accounts: ExtrasAccounts;
  stripe: ExtrasStripe;
  catalog: Catalog;
  now: () => Date;
}

export type ExtrasRefusal =
  | { ok: false; status: 400; code: 'invalid' | 'mixed_change' }
  | { ok: false; status: 402; code: 'payment_failed' }
  | { ok: false; status: 404; code: 'not_found' }
  | { ok: false; status: 409; code: 'in_use'; detail: { what: 'seats' | 'sites'; inUse: number } }
  | {
      ok: false;
      status: 409;
      code:
        | 'no_subscription'
        | 'subscription_ending'
        | 'subscription_not_active'
        | 'not_agency_subscription';
    }
  | { ok: false; status: 503; code: 'billing_unavailable' };

export type ExtrasResult =
  /** `changed` is false when the subscription already held these quantities: no Stripe write. */
  { ok: true; extras: Extras; changed: boolean } | ExtrasRefusal;

const UNAVAILABLE: ExtrasRefusal = { ok: false, status: 503, code: 'billing_unavailable' };

/**
 * The subscription statuses a change is made in. Not `trialing`: the webhook's reading of a
 * trialing update changes no entitlement (`lib/billing/state-machine.ts` ignores the status), so
 * the account's limits would stay the plan's while Stripe held the extras and this route said they
 * were bought. Extras are bought once the trial has become the plan.
 */
const CHANGEABLE: ReadonlySet<string> = new Set(['active']);

const isCardError = (err: unknown): boolean =>
  (err as { type?: unknown } | null)?.type === 'StripeCardError';

const invoiceId = (sub: Stripe.Subscription): string => {
  const invoice = sub.latest_invoice;
  if (invoice === null || invoice === undefined) return 'none';
  return typeof invoice === 'string' ? invoice : invoice.id;
};

/**
 * The length of the clock windows a key names. Stripe keeps the first answer for a key for a day,
 * a card's decline included, and a declined raise changes nothing else the key is built from; so
 * the key also names the ten-minute window of the clock it was made in, and the same change asked
 * in a later window is a new attempt (with another card, say). The windows are fixed, so two
 * attempts a second apart on either side of a boundary have two keys. Asking twice is safe either
 * way: the quantities are the ones wanted, not amounts to add, and a subscription that already
 * holds them is answered before Stripe is called.
 */
export const RETRY_WINDOW_MS = 10 * 60 * 1000;

/**
 * The key Stripe deduplicates a change by. A retry of one request within one `RETRY_WINDOW_MS`
 * window finds the subscription as the first attempt found it, and repeats the key. A later
 * request for the same quantities (bought, lowered, bought again) does not: it differs in the
 * quantities it starts from, in the subscription's latest invoice (a paid raise makes one), in the
 * last event the mirror applied, or in its window.
 */
function idempotencyKey(
  sub: Stripe.Subscription,
  lastEventId: string | null,
  from: Extras,
  to: Extras,
  now: Date,
): string {
  return [
    'extras',
    sub.id,
    invoiceId(sub),
    lastEventId ?? 'none',
    `${from.seats}-${from.sites}`,
    `${to.seats}-${to.sites}`,
    Math.floor(now.getTime() / RETRY_WINDOW_MS),
  ].join(':');
}

type Item = Stripe.SubscriptionUpdateParams.Item;

/** The item change that takes one extra from `from` to `to`, or null when it stays. */
async function itemChange(
  catalog: Catalog,
  interval: Interval,
  kind: 'seat' | 'site',
  existing: string | undefined,
  from: number,
  to: number,
): Promise<Item | null> {
  if (from === to) return null;
  if (existing === undefined) {
    return { price: await catalog.priceFor('agency', interval, kind), quantity: to };
  }
  return to === 0 ? { id: existing, deleted: true } : { id: existing, quantity: to };
}

/**
 * Sets the account's extra seats and sites to `want`. In order: the quantities, then what the
 * account uses, then the subscription as Stripe holds it, then one update of the items that change,
 * with `RAISE` when quantities rise and `LOWER` when they fall.
 */
export async function changeExtras(
  deps: ExtrasDeps,
  input: { accountId: string; want: Extras },
): Promise<ExtrasResult> {
  const { want } = input;
  let limits;
  try {
    limits = limitsFor('agency', want);
  } catch {
    return { ok: false, status: 400, code: 'invalid' };
  }
  if (want.seats > MAX_EXTRA_SEATS) return { ok: false, status: 400, code: 'invalid' };

  const account = await deps.accounts.read(input.accountId, deps.now());
  if (account === null) return { ok: false, status: 404, code: 'not_found' };
  if (account.subscription === null) return { ok: false, status: 409, code: 'no_subscription' };
  if (limits.seats < account.seatsInUse) {
    return {
      ok: false,
      status: 409,
      code: 'in_use',
      detail: { what: 'seats', inUse: account.seatsInUse },
    };
  }
  if (limits.sites < account.sitesInUse) {
    return {
      ok: false,
      status: 409,
      code: 'in_use',
      detail: { what: 'sites', inUse: account.sitesInUse },
    };
  }

  const sub = await deps.stripe.subscriptions.retrieve(account.subscription.id);
  if (!CHANGEABLE.has(sub.status)) {
    return { ok: false, status: 409, code: 'subscription_not_active' };
  }
  if (sub.cancel_at_period_end) return { ok: false, status: 409, code: 'subscription_ending' };

  try {
    const held = await mirrorOf(sub, deps.catalog);
    if ('refused' in held || held.plan !== 'agency') {
      return { ok: false, status: 409, code: 'not_agency_subscription' };
    }
    const from = held.extras;
    if (from.seats === want.seats && from.sites === want.sites) {
      return { ok: true, extras: from, changed: false };
    }

    const existing: Partial<Record<'seat' | 'site', string>> = {};
    for (const item of sub.items.data) {
      const price = await deps.catalog.planOfPrice(item.price.id);
      if (price?.kind === 'seat' || price?.kind === 'site') existing[price.kind] = item.id;
    }
    const changes = [
      await itemChange(deps.catalog, held.interval, 'seat', existing.seat, from.seats, want.seats),
      await itemChange(deps.catalog, held.interval, 'site', existing.site, from.sites, want.sites),
    ];
    const rises = want.seats > from.seats || want.sites > from.sites;
    const falls = want.seats < from.seats || want.sites < from.sites;
    if (rises && falls) return { ok: false, status: 400, code: 'mixed_change' };
    const updated = await deps.stripe.subscriptions.update(
      sub.id,
      { items: changes.filter((c) => c !== null), ...(rises ? RAISE : LOWER) },
      {
        idempotencyKey: idempotencyKey(
          sub,
          account.subscription.lastEventId,
          from,
          want,
          deps.now(),
        ),
      },
    );
    const now = await mirrorOf(updated, deps.catalog);
    if ('refused' in now) throw new Error(`extras: Stripe answered a subscription ${now.refused}`);
    return { ok: true, extras: now.extras, changed: true };
  } catch (err) {
    if (err instanceof CatalogError) return UNAVAILABLE;
    if (isCardError(err)) return { ok: false, status: 402, code: 'payment_failed' };
    throw err;
  }
}

const SeatRow = z.object({ status: z.string(), invite_expires_at: z.string().nullable() });

/** The accounts port over the service-role client. */
export function supabaseExtrasAccounts(admin: SupabaseClient): ExtrasAccounts {
  return {
    async read(accountId, now) {
      const account = await admin
        .from('accounts')
        .select('current_subscription_id')
        .eq('id', accountId)
        .is('deleted_at', null)
        .maybeSingle();
      if (account.error) throw new Error(`accounts read failed: ${account.error.message}`);
      if (account.data === null) return null;
      const id = (account.data as { current_subscription_id: string | null })
        .current_subscription_id;

      // The mirror row of the account's own subscription: a subscription id the account follows
      // with no row of its own here is not one this changes.
      const mirror =
        id === null
          ? null
          : await admin
              .from('subscriptions')
              .select('last_event_id')
              .eq('id', id)
              .eq('account_id', accountId)
              .maybeSingle();
      if (mirror?.error) throw new Error(`subscriptions read failed: ${mirror.error.message}`);
      const row = (mirror?.data ?? null) as { last_event_id: string | null } | null;

      const seats = await admin
        .from('seats')
        .select('status, invite_expires_at')
        .eq('account_id', accountId)
        .in('status', ['active', 'invited']);
      if (seats.error) throw new Error(`seats read failed: ${seats.error.message}`);
      const sites = await admin
        .from('sites')
        .select('id')
        .eq('account_id', accountId)
        .is('staging_of_site_id', null)
        .is('removed_at', null);
      if (sites.error) throw new Error(`sites read failed: ${sites.error.message}`);

      const held = z.array(SeatRow).parse(seats.data ?? []);
      return {
        subscription: id !== null && row !== null ? { id, lastEventId: row.last_event_id } : null,
        seatsInUse: held.filter(
          (s) =>
            s.status === 'active' ||
            s.invite_expires_at === null ||
            Date.parse(s.invite_expires_at) > now.getTime(),
        ).length,
        sitesInUse: (sites.data ?? []).length,
      };
    },
  };
}

/** The page the buy form is on. */
const BACK = '/seats';

/** What a refused form is told: the subscription's three refusals share one line. */
const FORM_NOTICE: Record<ExtrasRefusal['code'], NoticeCode | null> = {
  invalid: 'invalid',
  mixed_change: 'mixed_change',
  payment_failed: 'payment_failed',
  not_found: null,
  in_use: 'in_use',
  no_subscription: 'subscription_unchangeable',
  subscription_ending: 'subscription_unchangeable',
  subscription_not_active: 'subscription_unchangeable',
  not_agency_subscription: 'subscription_unchangeable',
  billing_unavailable: 'billing_unavailable',
};

/** A form goes back to Seats with a notice; JSON gets the quantities, or the refusal. */
export function extrasResponse(kind: RequestBody['kind'], result: ExtrasResult): Response {
  if (result.ok) {
    return kind === 'form'
      ? noticeTo(BACK, result.changed ? 'extras_changed' : 'extras_unchanged')
      : Response.json({ ...result.extras, changed: result.changed });
  }
  const notice = FORM_NOTICE[result.code];
  if (kind === 'form' && notice !== null) return noticeTo(BACK, notice);
  return refuse(result.status, result.code, 'detail' in result ? result.detail : {});
}
