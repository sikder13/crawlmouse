/**
 * Cancel (CC-03 D8): two clicks on the same page and no retention offer. The first post says what
 * would happen and makes no Stripe call; only a post with `confirm` writes to Stripe. The state
 * change comes back through the webhook.
 *
 * An `active` or `trialing` subscription is set to cancel at the end of its period, so the plan, or the
 * trial with its card, runs to its end. A `past_due`, `unpaid` or `paused` one is cancelled at once:
 * left to its period end, a retry of its open invoice could still charge someone who pressed Cancel
 * (questions Q14).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { z } from 'zod';
import type { BillingRefusal } from './checkout-v2';
import { refuse, seeOther, type BodyKind, type RequestBody } from './request-body';
import type { SubscriptionStatus } from './state-machine';

const AT_ONCE: ReadonlySet<string> = new Set(['past_due', 'unpaid', 'paused']);
const AT_PERIOD_END: ReadonlySet<string> = new Set(['active', 'trialing']);

export interface Mirror {
  status: SubscriptionStatus;
  trialEnd: Date | null;
  currentPeriodEnd: Date | null;
}

/** The subscription the account follows, with its mirror row when the webhook has written one. */
export interface Followed {
  id: string;
  mirror: Mirror | null;
}

export interface CancelAccounts {
  /** Null when the account follows no subscription. */
  followed(accountId: string): Promise<Followed | null>;
}

/** The Stripe calls a cancellation makes. */
export interface CancelStripe {
  subscriptions: {
    retrieve(id: string): PromiseLike<Stripe.Subscription>;
    update(
      id: string,
      params: Stripe.SubscriptionUpdateParams,
      options: { idempotencyKey: string },
    ): PromiseLike<Stripe.Subscription>;
    cancel(
      id: string,
      params: Stripe.SubscriptionCancelParams,
      options: { idempotencyKey: string },
    ): PromiseLike<Stripe.Subscription>;
  };
}

export interface CancelDeps {
  accounts: CancelAccounts;
  stripe: CancelStripe;
  now: () => Date;
}

const CancelJson = z.strictObject({
  accountId: z.uuid().optional(),
  confirm: z.boolean().optional(),
});
const CancelForm = z.strictObject({
  accountId: z.uuid().optional(),
  confirm: z.literal('true').optional(),
});

export interface CancelInput {
  accountId?: string;
  /** The second click: JSON `confirm: true`, or a form's `confirm=true`. */
  confirmed: boolean;
}

export function parseCancel(body: RequestBody): CancelInput | null {
  const parsed = (body.kind === 'form' ? CancelForm : CancelJson).safeParse(body.fields);
  if (!parsed.success) return null;
  const { accountId, confirm } = parsed.data;
  return { accountId, confirmed: confirm === true || confirm === 'true' };
}

export type CancelResult =
  | { ok: true; step: 'confirm' | 'done'; endsAt: string | null }
  | BillingRefusal;

const NO_SUBSCRIPTION: BillingRefusal = { ok: false, status: 409, error: 'no_subscription' };

/** When a cancellation of a subscription in `status` ends it; null when it is already over. */
function endsAt(status: string, trialEnd: Date | null, periodEnd: Date | null, now: Date) {
  if (AT_ONCE.has(status)) return now;
  if (status === 'trialing') return trialEnd;
  if (status === 'active') return periodEnd;
  return null;
}

const iso = (d: Date | null) => (d === null ? null : d.toISOString());
const fromSeconds = (s: number | null) => (s === null ? null : new Date(s * 1000));

function periodEndOf(sub: Stripe.Subscription): Date | null {
  const ends = sub.items.data.map((i) => i.current_period_end);
  return ends.length === 0 ? null : fromSeconds(Math.min(...ends));
}

export async function cancelSubscription(
  deps: CancelDeps,
  input: { accountId: string; confirmed: boolean },
): Promise<CancelResult> {
  const followed = await deps.accounts.followed(input.accountId);
  if (followed === null) return NO_SUBSCRIPTION;
  const now = deps.now();

  if (!input.confirmed) {
    const m = followed.mirror;
    return {
      ok: true,
      step: 'confirm',
      endsAt: m === null ? null : iso(endsAt(m.status, m.trialEnd, m.currentPeriodEnd, now)),
    };
  }

  const sub = await deps.stripe.subscriptions.retrieve(followed.id);
  if (AT_ONCE.has(sub.status)) {
    await deps.stripe.subscriptions.cancel(
      followed.id,
      { prorate: false },
      { idempotencyKey: `cancel-now:${followed.id}` },
    );
    return { ok: true, step: 'done', endsAt: now.toISOString() };
  }
  if (!AT_PERIOD_END.has(sub.status)) return NO_SUBSCRIPTION;
  const updated = await deps.stripe.subscriptions.update(
    followed.id,
    { cancel_at_period_end: true },
    { idempotencyKey: `cancel:${followed.id}` },
  );
  return {
    ok: true,
    step: 'done',
    endsAt: iso(endsAt(updated.status, fromSeconds(updated.trial_end), periodEndOf(updated), now)),
  };
}

/** A form goes back to Settings › Plan on both steps; JSON gets the step and the end. */
export function cancelResponse(kind: BodyKind, origin: string, result: CancelResult): Response {
  if (!result.ok) return refuse(result.status, result.error, result.detail);
  if (kind === 'form') return seeOther(`${origin}/settings/plan?cancel=${result.step}`);
  return Response.json({ step: result.step, endsAt: result.endsAt });
}

const date = (v: string | null) => (v === null ? null : new Date(v));

/** The accounts port over the service-role client. */
export function supabaseCancelAccounts(admin: SupabaseClient): CancelAccounts {
  return {
    async followed(accountId) {
      const { data: account, error } = await admin
        .from('accounts')
        .select('current_subscription_id')
        .eq('id', accountId)
        .maybeSingle();
      if (error) throw new Error(`accounts read failed: ${error.message}`);
      if (!account) throw new Error(`account ${accountId} not found`);
      const id = (account as { current_subscription_id: string | null }).current_subscription_id;
      if (id === null) return null;
      const { data: row, error: mirrorError } = await admin
        .from('subscriptions')
        .select('status, trial_end, current_period_end')
        .eq('id', id)
        .eq('account_id', accountId)
        .maybeSingle();
      if (mirrorError) throw new Error(`subscriptions read failed: ${mirrorError.message}`);
      if (!row) return { id, mirror: null };
      const r = row as {
        status: SubscriptionStatus;
        trial_end: string | null;
        current_period_end: string | null;
      };
      return {
        id,
        mirror: {
          status: r.status,
          trialEnd: date(r.trial_end),
          currentPeriodEnd: date(r.current_period_end),
        },
      };
    },
  };
}
