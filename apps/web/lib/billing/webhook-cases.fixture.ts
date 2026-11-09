/**
 * The v2 webhook's event × state table (spec 03, review finding 17), as data. Test support: the
 * end-to-end test (./stripe-webhook.cases.test.ts) runs the entries against PGlite through the
 * handler, and spec 03's table is to be rendered from this array, so the table names the
 * transitions the tests run (OPERATING-RULES §10).
 *
 * Each entry sets an account up through the handler (`from`, described in `SETUPS`), puts the
 * subscription in Stripe in `stripe.status` (the status Stripe returns when the event is
 * processed, and an update's payload status), delivers one event of `stripe.type` about the
 * account's own subscription (`current`) or another one of its customer (`other`), and expects the
 * account's state and tier and the handler's outcome. `reason` is the machine's, for an ignored event.
 * `cancels` names, by the same two roles, each subscription the delivery plans to cancel, and
 * `alerts` the reason of each founder alert it raises; `c` expects neither, and `writes` states them.
 * A dispute names a charge, not a subscription: its `stripe.subscription`, `status` and `plan` are
 * null, and Stripe is left as the setup left it.
 *
 * Reachable cells only. A card-required Pro trial is not reachable in CC-03: nothing starts one
 * (spec 03, Q9), so it has no column here. Our clock's events (trial reminder, expiry, the
 * past-due lapse) are not Stripe's and are not in this table.
 */
import type { AccountState } from '@crawlmouse/types/v2';
import type { PaidTier, Tier } from '../entitlement-v2';
import type { PlannedAlert } from './effects';
import type { SubscriptionStatus } from './state-machine';

export const SETUPS = {
  free: 'Free, never subscribed',
  free_kept: 'Free after Pro went unpaid: the subscription is kept',
  free_disputed: 'Free after a dispute on Pro',
  pro_trial_no_card: 'Pro trial without a card',
  pro: 'Pro',
  agency_trial: 'Agency trial',
  agency: 'Agency',
  past_due: 'Past due from Pro',
} as const;

export type Setup = keyof typeof SETUPS;

export type CaseEventType =
  | 'checkout.session.completed'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted'
  | 'customer.subscription.trial_will_end'
  | 'invoice.payment_failed'
  | 'charge.dispute.created';

/** The account's own subscription, or another one of its customer that the event is about. */
export type CaseRole = 'current' | 'other';

export interface WebhookCase {
  name: string;
  from: Setup;
  stripe: {
    type: CaseEventType;
    subscription: CaseRole | null;
    status: SubscriptionStatus | null;
    plan: PaidTier | null;
  };
  expect: {
    state: AccountState;
    tier: Tier;
    outcome: 'applied' | 'ignored' | 'recorded';
    reason?: string;
    cancels: readonly CaseRole[];
    alerts: readonly PlannedAlert['reason'][];
  };
}

const NOT_CURRENT = 'not the current subscription';
const ONLY_FREE = 'only a Free account starts a trial';

function c(
  from: Setup,
  type: CaseEventType,
  subscription: 'current' | 'other',
  status: SubscriptionStatus,
  plan: PaidTier,
  state: AccountState,
  tier: Tier,
  outcome: WebhookCase['expect']['outcome'],
  reason?: string,
): WebhookCase {
  return {
    name: `${type} (${subscription} subscription, ${status} ${plan}) from ${from}`,
    from,
    stripe: { type, subscription, status, plan },
    expect: {
      state,
      tier,
      outcome,
      ...(reason === undefined ? {} : { reason }),
      cancels: [],
      alerts: [],
    },
  };
}

/** A case whose delivery cancels `cancels` and raises `alerts`. */
function writes(
  k: WebhookCase,
  cancels: readonly CaseRole[],
  alerts: readonly PlannedAlert['reason'][] = [],
): WebhookCase {
  return { ...k, expect: { ...k.expect, cancels, alerts } };
}

/** A dispute on the account's customer's charge: it alerts, and cancels what the account follows. */
function dispute(
  from: Setup,
  state: AccountState,
  tier: Tier,
  cancels: readonly CaseRole[],
): WebhookCase {
  return {
    name: `charge.dispute.created from ${from}`,
    from,
    stripe: { type: 'charge.dispute.created', subscription: null, status: null, plan: null },
    expect: { state, tier, outcome: 'applied', cancels, alerts: ['dispute'] },
  };
}

const PAID_ORPHAN = 'orphaned_subscription';

const CHECKOUT = 'checkout.session.completed';
const UPDATED = 'customer.subscription.updated';
const DELETED = 'customer.subscription.deleted';
const TRIAL_WILL_END = 'customer.subscription.trial_will_end';
const PAYMENT_FAILED = 'invoice.payment_failed';

export const WEBHOOK_CASES: readonly WebhookCase[] = Object.freeze([
  // A paid checkout: no state guard, so it applies from each state below (a disputed Free account too).
  // The subscription it replaces is cancelled while Stripe may still charge it (trialing, active,
  // past_due): the unpaid one is kept as it is, the disputed one has been cancelled already.
  c('free', CHECKOUT, 'other', 'active', 'pro', 'pro', 'pro', 'applied'),
  c('free_kept', CHECKOUT, 'other', 'active', 'pro', 'pro', 'pro', 'applied'),
  c('free_disputed', CHECKOUT, 'other', 'active', 'pro', 'pro', 'pro', 'applied'),
  c('pro_trial_no_card', CHECKOUT, 'other', 'active', 'pro', 'pro', 'pro', 'applied'),
  writes(
    c('pro', CHECKOUT, 'other', 'active', 'agency', 'agency', 'agency', 'applied'),
    ['current'],
    [PAID_ORPHAN],
  ),
  writes(c('agency_trial', CHECKOUT, 'other', 'active', 'pro', 'pro', 'pro', 'applied'), [
    'current',
  ]),
  writes(
    c('agency', CHECKOUT, 'other', 'active', 'pro', 'pro', 'pro', 'applied'),
    ['current'],
    [PAID_ORPHAN],
  ),
  writes(
    c('past_due', CHECKOUT, 'other', 'active', 'pro', 'pro', 'pro', 'applied'),
    ['current'],
    [PAID_ORPHAN],
  ),
  c(
    'pro',
    CHECKOUT,
    'current',
    'active',
    'pro',
    'pro',
    'pro',
    'ignored',
    'already the current subscription',
  ),

  // An agency trial checkout: the subscription is trialing on the Agency price. One that does not
  // start the trial is cancelled, and a trial has charged nothing, so there is no alert.
  c('free', CHECKOUT, 'other', 'trialing', 'agency', 'agency_trial', 'agency', 'applied'),
  writes(
    c(
      'free_kept',
      CHECKOUT,
      'other',
      'trialing',
      'agency',
      'free',
      'free',
      'ignored',
      'the account still has a subscription',
    ),
    ['other'],
  ),
  writes(
    c(
      'free_disputed',
      CHECKOUT,
      'other',
      'trialing',
      'agency',
      'free',
      'free',
      'ignored',
      'a disputed account gets no trial',
    ),
    ['other'],
  ),
  writes(
    c(
      'pro_trial_no_card',
      CHECKOUT,
      'other',
      'trialing',
      'agency',
      'pro_trial',
      'pro',
      'ignored',
      ONLY_FREE,
    ),
    ['other'],
  ),
  writes(c('pro', CHECKOUT, 'other', 'trialing', 'agency', 'pro', 'pro', 'ignored', ONLY_FREE), [
    'other',
  ]),
  writes(
    c(
      'agency_trial',
      CHECKOUT,
      'other',
      'trialing',
      'agency',
      'agency_trial',
      'agency',
      'ignored',
      ONLY_FREE,
    ),
    ['other'],
  ),
  writes(
    c('agency', CHECKOUT, 'other', 'trialing', 'agency', 'agency', 'agency', 'ignored', ONLY_FREE),
    ['other'],
  ),
  writes(
    c('past_due', CHECKOUT, 'other', 'trialing', 'agency', 'past_due', 'pro', 'ignored', ONLY_FREE),
    ['other'],
  ),

  c('free', UPDATED, 'other', 'active', 'pro', 'free', 'free', 'ignored', NOT_CURRENT),
  c('free_kept', UPDATED, 'current', 'active', 'pro', 'pro', 'pro', 'applied'),
  c(
    'free_disputed',
    UPDATED,
    'current',
    'active',
    'pro',
    'free',
    'free',
    'ignored',
    'a disputed account is restored only by hand',
  ),
  c(
    'pro_trial_no_card',
    UPDATED,
    'other',
    'active',
    'pro',
    'pro_trial',
    'pro',
    'ignored',
    NOT_CURRENT,
  ),
  c('pro', UPDATED, 'current', 'active', 'pro', 'pro', 'pro', 'ignored', 'no entitlement change'),
  c('agency_trial', UPDATED, 'current', 'active', 'agency', 'agency', 'agency', 'applied'),
  c(
    'agency',
    UPDATED,
    'current',
    'active',
    'agency',
    'agency',
    'agency',
    'ignored',
    'no entitlement change',
  ),
  c('past_due', UPDATED, 'current', 'active', 'pro', 'pro', 'pro', 'applied'),

  // A revoke on an account already Free or past due records when Stripe made it (applied, no change).
  c('free', UPDATED, 'other', 'past_due', 'pro', 'free', 'free', 'ignored', NOT_CURRENT),
  c('free_kept', UPDATED, 'current', 'past_due', 'pro', 'free', 'free', 'applied'),
  c('free_disputed', UPDATED, 'current', 'past_due', 'pro', 'free', 'free', 'applied'),
  c(
    'pro_trial_no_card',
    UPDATED,
    'other',
    'past_due',
    'pro',
    'pro_trial',
    'pro',
    'ignored',
    NOT_CURRENT,
  ),
  c('pro', UPDATED, 'current', 'past_due', 'pro', 'past_due', 'pro', 'applied'),
  c('agency_trial', UPDATED, 'current', 'past_due', 'agency', 'past_due', 'agency', 'applied'),
  c('agency', UPDATED, 'current', 'past_due', 'agency', 'past_due', 'agency', 'applied'),
  c('past_due', UPDATED, 'current', 'past_due', 'pro', 'past_due', 'pro', 'applied'),

  c('free', UPDATED, 'other', 'canceled', 'pro', 'free', 'free', 'ignored', NOT_CURRENT),
  c('free_kept', UPDATED, 'current', 'canceled', 'pro', 'free', 'free', 'applied'),
  c('free_disputed', UPDATED, 'current', 'canceled', 'pro', 'free', 'free', 'applied'),
  c(
    'pro_trial_no_card',
    UPDATED,
    'other',
    'canceled',
    'pro',
    'pro_trial',
    'pro',
    'ignored',
    NOT_CURRENT,
  ),
  c('pro', UPDATED, 'current', 'canceled', 'pro', 'free', 'free', 'applied'),
  c('agency_trial', UPDATED, 'current', 'canceled', 'agency', 'free', 'free', 'applied'),
  c('agency', UPDATED, 'current', 'canceled', 'agency', 'free', 'free', 'applied'),
  c('past_due', UPDATED, 'current', 'canceled', 'pro', 'free', 'free', 'applied'),
  c('pro', UPDATED, 'current', 'incomplete_expired', 'pro', 'free', 'free', 'applied'),
  c('free_kept', UPDATED, 'current', 'incomplete_expired', 'pro', 'free', 'free', 'applied'),

  c('free', UPDATED, 'other', 'unpaid', 'pro', 'free', 'free', 'ignored', NOT_CURRENT),
  c('free_kept', UPDATED, 'current', 'unpaid', 'pro', 'free', 'free', 'applied'),
  c('free_disputed', UPDATED, 'current', 'unpaid', 'pro', 'free', 'free', 'applied'),
  c(
    'pro_trial_no_card',
    UPDATED,
    'other',
    'unpaid',
    'pro',
    'pro_trial',
    'pro',
    'ignored',
    NOT_CURRENT,
  ),
  c('pro', UPDATED, 'current', 'unpaid', 'pro', 'free', 'free', 'applied'),
  c('agency_trial', UPDATED, 'current', 'unpaid', 'agency', 'free', 'free', 'applied'),
  c('agency', UPDATED, 'current', 'unpaid', 'agency', 'free', 'free', 'applied'),
  c('past_due', UPDATED, 'current', 'unpaid', 'pro', 'free', 'free', 'applied'),
  c('pro', UPDATED, 'current', 'paused', 'pro', 'free', 'free', 'applied'),
  c('agency', UPDATED, 'current', 'paused', 'agency', 'free', 'free', 'applied'),
  c('free_kept', UPDATED, 'current', 'paused', 'pro', 'free', 'free', 'applied'),

  c(
    'agency_trial',
    UPDATED,
    'current',
    'trialing',
    'agency',
    'agency_trial',
    'agency',
    'ignored',
    'status trialing changes no entitlement',
  ),
  c('free', UPDATED, 'other', 'trialing', 'agency', 'free', 'free', 'ignored', NOT_CURRENT),
  c(
    'pro',
    UPDATED,
    'current',
    'incomplete',
    'pro',
    'pro',
    'pro',
    'ignored',
    'status incomplete changes no entitlement',
  ),

  c('free', DELETED, 'other', 'canceled', 'pro', 'free', 'free', 'ignored', NOT_CURRENT),
  c('free_kept', DELETED, 'current', 'canceled', 'pro', 'free', 'free', 'applied'),
  c('free_disputed', DELETED, 'current', 'canceled', 'pro', 'free', 'free', 'applied'),
  c(
    'pro_trial_no_card',
    DELETED,
    'other',
    'canceled',
    'pro',
    'pro_trial',
    'pro',
    'ignored',
    NOT_CURRENT,
  ),
  c('pro', DELETED, 'current', 'canceled', 'pro', 'free', 'free', 'applied'),
  c('agency_trial', DELETED, 'current', 'canceled', 'agency', 'free', 'free', 'applied'),
  c('agency', DELETED, 'current', 'canceled', 'agency', 'free', 'free', 'applied'),
  c('past_due', DELETED, 'current', 'canceled', 'pro', 'free', 'free', 'applied'),

  c('free', TRIAL_WILL_END, 'other', 'trialing', 'agency', 'free', 'free', 'ignored', NOT_CURRENT),
  c(
    'free_kept',
    TRIAL_WILL_END,
    'current',
    'unpaid',
    'pro',
    'free',
    'free',
    'ignored',
    'not a trial',
  ),
  c(
    'free_disputed',
    TRIAL_WILL_END,
    'current',
    'canceled',
    'pro',
    'free',
    'free',
    'ignored',
    'not a trial',
  ),
  c(
    'pro_trial_no_card',
    TRIAL_WILL_END,
    'other',
    'trialing',
    'agency',
    'pro_trial',
    'pro',
    'ignored',
    NOT_CURRENT,
  ),
  c('pro', TRIAL_WILL_END, 'current', 'active', 'pro', 'pro', 'pro', 'ignored', 'not a trial'),
  c(
    'agency_trial',
    TRIAL_WILL_END,
    'current',
    'trialing',
    'agency',
    'agency_trial',
    'agency',
    'applied',
  ),
  c(
    'agency',
    TRIAL_WILL_END,
    'current',
    'active',
    'agency',
    'agency',
    'agency',
    'ignored',
    'not a trial',
  ),
  c(
    'past_due',
    TRIAL_WILL_END,
    'current',
    'past_due',
    'pro',
    'past_due',
    'pro',
    'ignored',
    'not a trial',
  ),

  c('free', PAYMENT_FAILED, 'other', 'past_due', 'pro', 'free', 'free', 'ignored', NOT_CURRENT),
  c('free_kept', PAYMENT_FAILED, 'current', 'past_due', 'pro', 'free', 'free', 'applied'),
  c('free_disputed', PAYMENT_FAILED, 'current', 'past_due', 'pro', 'free', 'free', 'applied'),
  c(
    'pro_trial_no_card',
    PAYMENT_FAILED,
    'other',
    'past_due',
    'pro',
    'pro_trial',
    'pro',
    'ignored',
    NOT_CURRENT,
  ),
  c('pro', PAYMENT_FAILED, 'current', 'past_due', 'pro', 'past_due', 'pro', 'applied'),
  c(
    'agency_trial',
    PAYMENT_FAILED,
    'current',
    'past_due',
    'agency',
    'past_due',
    'agency',
    'applied',
  ),
  c('agency', PAYMENT_FAILED, 'current', 'past_due', 'agency', 'past_due', 'agency', 'applied'),
  c('past_due', PAYMENT_FAILED, 'current', 'past_due', 'pro', 'past_due', 'pro', 'applied'),

  // A dispute applies whatever subscription the charge was for, and cancels the followed one: the
  // kept unpaid one and the already disputed one too (the sink skips one Stripe shows ended). Free
  // and the no-card trial follow none.
  dispute('free', 'free', 'free', []),
  dispute('free_kept', 'free', 'free', ['current']),
  dispute('free_disputed', 'free', 'free', ['current']),
  dispute('pro_trial_no_card', 'free', 'free', []),
  dispute('pro', 'free', 'free', ['current']),
  dispute('agency_trial', 'free', 'free', ['current']),
  dispute('agency', 'free', 'free', ['current']),
  dispute('past_due', 'free', 'free', ['current']),
]);
