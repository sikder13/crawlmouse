/**
 * The founder's notices (CC-33 D3), over injected ports: what inngest/founder.ts runs.
 *
 *   entitlementNotice  one `entitlement.changed` event: a trial started, a payment or a failed one
 *                      (founder-classify.ts); key `entitlement:<event id>`
 *   sweep              sign-ups confirmed (users of the last 7 days not yet announced, at most 200 a
 *                      run, in a rotation whose turn is the run's five-minute tick), agency accounts
 *                      created and subscriptions canceled in the last 2 hours; keys `signup:<user>`,
 *                      `agency:<account>`, `cancel:<subscription>:<canceled_at>`
 *   digest             the daily and weekly digests when due (digest-clock.ts), and the "N more"
 *                      notice for the notices held over the hour's bound
 *
 * Each instant notice is claimed in `founder_notices` first (`claim_founder_notice`): `send` mails it,
 * `held` leaves it to the next "N more" notice, `skipped` (FOUNDER_NOTIFY_TO unset) sends nothing.
 * A claim answers the decision already stored for its key, so a retried event sends what the first
 * claim decided, and the mail ledger's key, `founder_event:<key>`, stops a second send.
 *
 * The mail goes to the address `recipient()` answers, FOUNDER_NOTIFY_TO, with a null account on its
 * ledger row, so it is not in a customer's mail list (founder.test.ts, "mails a first payment …").
 * Unset or not one plain address: nothing is mailed and the run logs `founder.unconfigured` once. The
 * log lines written here carry counts, kinds and lengths.
 */
import type { AccountState } from '@crawlmouse/types/v2';
import { isPlainAddress } from '../mail/headers';
import { send, type MailDeps, type SendOutcome } from '../mail/send';
import { founderDigest } from '../mail/templates/founder-digest';
import {
  founderEvent,
  founderOverflow,
  STRIPE_INVOICE_STATUSES,
  type FounderAmount,
  type FounderEventInput,
  type FounderEventKind,
  type StripeInvoiceStatus,
} from '../mail/templates/founder-event';
import { digestDue } from './digest-clock';
import { classifyEntitlement, paymentLabel, type PaymentRecord } from './founder-classify';
import type { FounderStore, NoticeAccount } from './founder-store';

/** Instant notices of one kind of account (internal or not) mailed in an hour before the rest are held. */
export const FOUNDER_LIMIT = 20;
/** Held notices one "N more" notice lists. */
export const OVERFLOW_ROWS = 50;
/** Sign-ups the sweep reads a run, and how far back. */
export const SIGNUP_BATCH = 200;
export const SIGNUP_LOOKBACK_MS = 7 * 24 * 3_600_000;
/** The sweep's cron period (inngest/founder.ts, every five minutes): the sign-up rotation's turn. */
export const SWEEP_EVERY_MS = 5 * 60_000;
/** How far back the sweep reads agency accounts and cancellations. */
export const SWEEP_LOOKBACK_MS = 2 * 3_600_000;
/** The longest notice key: the mail ledger's 200 less `founder_event:`. */
export const KEY_MAX = 186;

/** The ids billing gives `entitlement.changed` (lib/billing/effects.ts): the name, the account, the source. */
const ENTITLEMENT_ID = /^entitlement\.changed:[0-9a-f-]{36}:.+$/;

export type FounderLogEvent =
  | 'founder.unconfigured'
  | 'founder.event_id_refused'
  | 'founder.key_refused'
  | 'founder.confirmation_unread'
  | 'founder.stripe_unread';

/**
 * Stripe could not be read for a change from past_due to a paid state (review N3): whether it is a
 * first payment is Stripe's to say, so the notice waits for a read. inngest/founder.ts runs the work in
 * one step, and a step that throws is retried, up to FOUNDER_RETRIES times, before the run fails.
 */
export class FounderStripeUnread extends Error {
  constructor() {
    super('founder: Stripe was not read for a change from past_due; the notice waits for a read');
    this.name = 'FounderStripeUnread';
  }
}

export type { PaymentRecord };
type InvoiceFacts = NonNullable<PaymentRecord['invoice']>;

/**
 * The amount a notice shows (review C3): `amount_paid` from a paid invoice, else `amount_due` with
 * the invoice's status, so an invoice Stripe has not charged yet is not shown as a payment of 0.
 */
export function amountOf(inv: InvoiceFacts): FounderAmount {
  const status = (STRIPE_INVOICE_STATUSES as readonly (string | null)[]).includes(inv.status)
    ? (inv.status as StripeInvoiceStatus)
    : null;
  return status === 'paid'
    ? { minor: inv.amountPaid, currency: inv.currency, status }
    : { minor: inv.amountDue, currency: inv.currency, status };
}

export interface FounderDeps {
  mail: MailDeps;
  store: FounderStore;
  /** Stripe's record of the followed subscription's payment; throws when Stripe cannot be read. */
  payment(subscriptionId: string): Promise<PaymentRecord>;
  /** Whether Supabase Auth shows the user's address confirmed. */
  confirmed(userId: string): Promise<boolean>;
  /** FOUNDER_NOTIFY_TO as set, unchecked. */
  to: string | null;
  now(): Date;
  log(event: FounderLogEvent, fields: Readonly<Record<string, string | number>>): void;
}

/** FOUNDER_NOTIFY_TO when it is one plain address, else null, logged once for the run. */
function recipient(d: FounderDeps): string | null {
  const to = d.to?.trim() ?? '';
  if (to !== '' && isPlainAddress(to)) return to;
  d.log('founder.unconfigured', { set: d.to === null || d.to.trim() === '' ? 0 : 1 });
  return null;
}

interface Notice {
  key: string;
  kind: FounderEventKind;
  accountId: string | null;
  account: NoticeAccount | null;
  occurredAt: string;
  plan: FounderEventInput['plan'];
  payment?: FounderEventInput['payment'];
  amount?: FounderAmount | null;
}

export type NoticeOutcome = 'held' | 'skipped' | 'key_refused' | SendOutcome;

async function notify(d: FounderDeps, to: string | null, n: Notice): Promise<NoticeOutcome> {
  if (n.key.length > KEY_MAX) {
    d.log('founder.key_refused', { kind: n.kind, length: n.key.length });
    return 'key_refused';
  }
  const internal = n.account?.internal ?? false;
  const state = await d.store.claim({
    key: n.key,
    kind: n.kind,
    accountId: n.accountId,
    internal,
    occurredAt: n.occurredAt,
    facts: { plan: n.plan, ...(n.payment === undefined ? {} : { payment: n.payment }) },
    now: d.now(),
    limit: FOUNDER_LIMIT,
    configured: to !== null,
  });
  if (state !== 'send') return state;
  // Decided `send` by an earlier claim, with the address unset since.
  if (to === null) return 'unconfigured';
  return send(d.mail, {
    kind: 'founder_event',
    to,
    idempotencyKey: `founder_event:${n.key}`,
    accountId: null,
    render: async () =>
      founderEvent({
        kind: n.kind,
        internal,
        accountId: n.accountId,
        plan: n.plan,
        payment: n.payment,
        amount: n.amount,
        host: n.account?.host ?? null,
        ownerEmail: n.account?.ownerEmail ?? null,
        occurredAt: n.occurredAt,
      }),
  });
}

export interface EntitlementEvent {
  /** The Inngest event's id, as the sender set it. */
  id: string | undefined;
  accountId: string;
  from: AccountState;
  to: AccountState;
  occurredAt: string;
}

/**
 * A payment's notice reads Stripe before its claim: the label (first, returning or neither) and the
 * amount are Stripe's. A read that fails is logged (`founder.stripe_unread`). A recovery from
 * past_due is noticed when it is a first payment, and answers `no_notice`, claiming nothing, when it
 * is not; with Stripe unread it throws FounderStripeUnread, claiming nothing, for the step to retry.
 * Any other notice is sent with what was read.
 */
export async function entitlementNotice(
  d: FounderDeps,
  ev: EntitlementEvent,
): Promise<NoticeOutcome | 'event_id_refused' | 'no_notice'> {
  if (
    ev.id === undefined ||
    !ENTITLEMENT_ID.test(ev.id) ||
    !ev.id.startsWith(`entitlement.changed:${ev.accountId}:`)
  ) {
    d.log('founder.event_id_refused', { length: ev.id?.length ?? 0 });
    return 'event_id_refused';
  }
  const c = classifyEntitlement(ev.from, ev.to);
  if (c === null) return 'no_notice';
  const account = await d.store.account(ev.accountId);
  const subscriptionId = account?.subscriptionId ?? null;
  let record: PaymentRecord | null = null;
  if (c.kind !== 'trial_started' && subscriptionId !== null) {
    try {
      record = await d.payment(subscriptionId);
    } catch {
      const recovery = c.kind === 'payment' && c.recovery;
      d.log('founder.stripe_unread', { kind: c.kind, recovery: recovery ? 1 : 0 });
      if (recovery) throw new FounderStripeUnread();
    }
  }
  const payment = c.kind === 'payment' ? paymentLabel(record) : undefined;
  if (c.kind === 'payment' && c.recovery && payment !== 'first') return 'no_notice';
  return notify(d, recipient(d), {
    key: `entitlement:${ev.id}`,
    kind: c.kind,
    accountId: ev.accountId,
    account,
    occurredAt: ev.occurredAt,
    plan: c.plan,
    payment,
    amount:
      c.kind === 'trial_started' ? undefined : record?.invoice ? amountOf(record.invoice) : null,
  });
}

export interface SweepOutcome {
  signups: Record<string, number>;
  agencies: Record<string, number>;
  cancellations: Record<string, number>;
}

const tally = (into: Record<string, number>, outcome: string) => {
  into[outcome] = (into[outcome] ?? 0) + 1;
};

/**
 * Sign-ups confirmed since the sign-up look-back (SIGNUP_BATCH a run, in the rotation), then agency accounts
 * created and subscriptions canceled since the sweep look-back, at the period's end or at once.
 */
export async function sweep(d: FounderDeps): Promise<SweepOutcome> {
  const to = recipient(d);
  const now = d.now().getTime();
  const out: SweepOutcome = { signups: {}, agencies: {}, cancellations: {} };

  const users = await d.store.unannouncedUsers(
    new Date(now - SIGNUP_LOOKBACK_MS).toISOString(),
    SIGNUP_BATCH,
    Math.floor(now / SWEEP_EVERY_MS),
  );
  for (const u of users) {
    let confirmed: boolean;
    try {
      confirmed = await d.confirmed(u.userId);
    } catch {
      d.log('founder.confirmation_unread', { count: 1 });
      tally(out.signups, 'unread');
      continue;
    }
    if (!confirmed) {
      tally(out.signups, 'unconfirmed');
      continue;
    }
    tally(
      out.signups,
      await notify(d, to, {
        key: `signup:${u.userId}`,
        kind: 'signup',
        accountId: u.accountId,
        account: u.accountId === null ? null : await d.store.account(u.accountId),
        occurredAt: u.createdAt,
        plan: null,
      }),
    );
  }

  const since = new Date(now - SWEEP_LOOKBACK_MS).toISOString();
  for (const a of await d.store.agencyAccounts(since)) {
    tally(
      out.agencies,
      await notify(d, to, {
        key: `agency:${a.accountId}`,
        kind: 'agency_created',
        accountId: a.accountId,
        account: await d.store.account(a.accountId),
        occurredAt: a.createdAt,
        plan: null,
      }),
    );
  }
  for (const c of await d.store.cancellations(since)) {
    tally(
      out.cancellations,
      await notify(d, to, {
        key: `cancel:${c.subscriptionId}:${c.canceledAt}`,
        kind: 'cancellation',
        accountId: c.accountId,
        account: await d.store.account(c.accountId),
        occurredAt: c.canceledAt,
        plan: c.plan,
      }),
    );
  }
  return out;
}

export interface DigestOutcome {
  daily: SendOutcome | 'not_due' | 'unconfigured';
  weekly: SendOutcome | 'not_due' | 'unconfigured';
  overflow: SendOutcome | 'none' | 'unconfigured';
}

/**
 * The digests due at `at`, the tick's time, and the "N more" notice when notices are held. The keys
 * are built from `at` (`digestDue`), so a retry of the tick keeps them (review C6).
 */
export async function digest(d: FounderDeps, at: Date): Promise<DigestOutcome> {
  const to = recipient(d);
  if (to === null)
    return { daily: 'unconfigured', weekly: 'unconfigured', overflow: 'unconfigured' };
  const due = digestDue(at);
  const mail = (key: string, render: () => Promise<ReturnType<typeof founderDigest>>) =>
    send(d.mail, { kind: 'founder_digest', to, idempotencyKey: key, accountId: null, render });

  const daily =
    due.daily === null
      ? 'not_due'
      : await mail(due.daily.key, async () =>
          founderDigest({
            variant: 'daily',
            date: due.daily!.date,
            counts: await d.store.digestCounts(due.daily!.from, due.daily!.to),
          }),
        );
  const weekly =
    due.weekly === null
      ? 'not_due'
      : await mail(due.weekly.key, async () =>
          founderDigest({
            variant: 'weekly',
            monday: due.weekly!.monday,
            week: await d.store.digestCounts(due.weekly!.week.from, due.weekly!.week.to),
            previous: await d.store.digestCounts(
              due.weekly!.previous.from,
              due.weekly!.previous.to,
            ),
          }),
        );
  const taken = await d.store.takeOverflow(due.overflowKey, OVERFLOW_ROWS);
  const overflow =
    taken.total === 0
      ? 'none'
      : await send(d.mail, {
          kind: 'founder_event',
          to,
          idempotencyKey: `founder_event:${due.overflowKey}`,
          accountId: null,
          render: async () => founderOverflow(taken),
        });
  return { daily, weekly, overflow };
}
