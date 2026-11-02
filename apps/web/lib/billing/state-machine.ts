/**
 * The v2 entitlement state machine (ARCH-2 §3.2): a pure `next(snapshot, event)` that returns the
 * next snapshot and the effects to carry out. It reads no clock and no database; every event carries
 * its own time. `applyEntitlementTransition` (./state-machine-apply.ts) writes the result.
 *
 * Events are normalised: CC-03 turns Stripe's webhook payloads into them (`STRIPE_EVENTS` below says
 * which Stripe event becomes which). Not imported by any live route.
 *
 * Two rules decide whether a Stripe event may change an account:
 *
 * - **Which subscription.** The account follows one subscription (`subscriptionId`). A checkout or a
 *   card trial start makes the subscription it names the current one. Every other subscription event
 *   applies only when it names the current subscription; for any other it is ignored. A dispute is
 *   the exception: it applies whatever it names.
 * - **How old.** An event that grants or restores a plan is ignored when it is older than the
 *   account's last entitlement change, by more than the second Stripe rounds `created` to. Events
 *   that take a plan away apply whatever their age.
 */
import type { AccountState } from '@crawlmouse/types/v2';
import {
  limitsFor,
  NO_EXTRAS,
  PAST_DUE_GRACE_DAYS,
  type Extras,
  type PaidTier,
  type Tier,
} from '../entitlement-v2';

export const TRIAL_DAYS = 14;

/** Stripe stamps `event.created` in whole seconds. */
export const STALE_GRANT_TOLERANCE_MS = 1000;

export type TrialVariant = 'no_card' | 'card_required';

/** Stripe's subscription statuses, verbatim. */
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

/** The account fields the machine reads and writes; the rest of `accounts` is not its business. */
export interface EntitlementSnapshot {
  state: AccountState;
  tier: Tier;
  trialVariant: TrialVariant | null;
  trialEndsAt: Date | null;
  trialUsedAt: Date | null;
  pastDueTier: PaidTier | null;
  pastDueSince: Date | null;
  disputedAt: Date | null;
  /** Paid Agency extras, from the subscription. Zero on every other tier. */
  extras: Extras;
  /** The Stripe subscription the account follows; null when it follows none. */
  subscriptionId: string | null;
  /** When the snapshot last changed; null until it first does. */
  lastChangeAt: Date | null;
}

/** What `handle_new_user` creates: a Free account that has never had a trial. */
export const FREE_START: EntitlementSnapshot = Object.freeze({
  state: 'free',
  tier: 'free',
  trialVariant: null,
  trialEndsAt: null,
  trialUsedAt: null,
  pastDueTier: null,
  pastDueSince: null,
  disputedAt: null,
  extras: NO_EXTRAS,
  subscriptionId: null,
  lastChangeAt: null,
});

export type RecordedOnlyStripeEvent =
  | 'customer.subscription.created'
  | 'invoice.paid'
  | 'setup_intent.succeeded'
  | 'charge.refunded'
  | 'customer.updated';

/**
 * `at` is Stripe's `event.created` for a Stripe event, and the scheduled time for one of ours.
 * `subscriptionId` is the Stripe subscription the event is about.
 */
export type EntitlementEvent =
  /** A Free account starts the 14-day Pro trial: at sign-up, or by one click (DECISION-LOG H5). */
  | { type: 'trial_started'; at: Date; variant: 'no_card' }
  /** As above with a card on file: Stripe's `trialing` subscription sets the end. */
  | {
      type: 'trial_started';
      at: Date;
      variant: 'card_required';
      trialEnd: Date;
      subscriptionId: string;
    }
  | { type: 'agency_trial_started'; at: Date; trialEnd: Date; subscriptionId: string }
  /** Our clock, 3 days before a no-card trial ends. */
  | { type: 'trial_reminder_due'; at: Date }
  /** `customer.subscription.trial_will_end`. */
  | { type: 'trial_will_end'; at: Date; subscriptionId: string }
  /** Our clock, at the end of a no-card trial. */
  | { type: 'trial_expired'; at: Date }
  | { type: 'checkout_completed'; at: Date; plan: PaidTier; subscriptionId: string }
  | {
      type: 'subscription_updated';
      at: Date;
      subscriptionId: string;
      status: SubscriptionStatus;
      plan: PaidTier;
      cancelAtPeriodEnd: boolean;
      extras: Extras;
    }
  | { type: 'subscription_deleted'; at: Date; subscriptionId: string }
  | { type: 'invoice_payment_failed'; at: Date; subscriptionId: string }
  /** `charge.dispute.created`: applies whatever subscription the charge belongs to. */
  | { type: 'dispute_created'; at: Date }
  /** The hourly sweep, for an account whose grace may have run out. */
  | { type: 'past_due_lapsed'; at: Date }
  | { type: 'recorded_only'; at: Date; stripeType: RecordedOnlyStripeEvent };

/** Which normalised event each Stripe event of the ARCH-2 §3.3 subscription set becomes. */
export const STRIPE_EVENTS: Readonly<Record<string, EntitlementEvent['type']>> = Object.freeze({
  'checkout.session.completed': 'checkout_completed',
  'customer.subscription.created': 'recorded_only',
  'customer.subscription.updated': 'subscription_updated',
  'customer.subscription.deleted': 'subscription_deleted',
  'customer.subscription.trial_will_end': 'trial_will_end',
  'invoice.paid': 'recorded_only',
  'invoice.payment_failed': 'invoice_payment_failed',
  'setup_intent.succeeded': 'recorded_only',
  'charge.dispute.created': 'dispute_created',
  'charge.refunded': 'recorded_only',
  'customer.updated': 'recorded_only',
});

export type Effect =
  /** Write the plan's limits; also removes the newest active seats beyond the seat limit. */
  | { kind: 'relimit' }
  /** Free again: the oldest primary site keeps a monthly check, the others pause (`trial_ended`). */
  | { kind: 'pause_others' }
  /** Fewer sites allowed: the newest primary sites beyond the limit pause (`over_limit`). */
  | { kind: 'pause_over_limit' }
  /** More sites allowed: the oldest sites up to the limit run on the tier's schedule. */
  | { kind: 'resume' }
  | { kind: 'email'; template: 'trial_reminder' }
  | { kind: 'event'; name: 'trial.started' | 'trial.converted' | 'entitlement.changed' }
  | { kind: 'founder_alert'; reason: 'dispute' };

export function effectKey(effect: Effect): string {
  switch (effect.kind) {
    case 'email':
      return `email:${effect.template}`;
    case 'event':
      return `event:${effect.name}`;
    default:
      return effect.kind;
  }
}

export type Transition =
  | { outcome: 'applied'; state: EntitlementSnapshot; effects: Effect[] }
  | { outcome: 'ignored'; state: EntitlementSnapshot; effects: []; reason: string };

const DAY_MS = 86_400_000;
const TRIAL_STATES: readonly AccountState[] = ['pro_trial', 'agency_trial'];

const TIER_OF_STATE: Record<Exclude<AccountState, 'past_due'>, Tier> = {
  free: 'free',
  pro_trial: 'pro',
  pro: 'pro',
  agency_trial: 'agency',
  agency: 'agency',
};

/** A state whose entitlement comes from a Stripe subscription. */
function followsStripe(s: Pick<EntitlementSnapshot, 'state' | 'trialVariant'>): boolean {
  if (s.state === 'pro_trial') return s.trialVariant === 'card_required';
  return s.state !== 'free';
}

/**
 * What makes a snapshot legal. The database holds the same rules as CHECK constraints on
 * `accounts`; `state-machine-apply.test.ts` shows each snapshot the machine produces is accepted
 * there.
 */
export function legalityViolations(s: EntitlementSnapshot): string[] {
  const bad: string[] = [];
  const expectedTier = s.state === 'past_due' ? s.pastDueTier : TIER_OF_STATE[s.state];
  if (s.tier !== expectedTier) bad.push(`tier ${s.tier} does not match state ${s.state}`);
  const inTrial = TRIAL_STATES.includes(s.state);
  if (inTrial !== (s.trialEndsAt !== null)) bad.push('trialEndsAt is set exactly in a trial');
  if (inTrial && s.trialUsedAt === null) bad.push('a trial records trialUsedAt');
  if (s.state === 'pro_trial' && s.trialVariant === null) bad.push('a Pro trial has a variant');
  const pastDue = s.state === 'past_due';
  if (pastDue !== (s.pastDueTier !== null) || pastDue !== (s.pastDueSince !== null)) {
    bad.push('pastDueTier and pastDueSince are set exactly in past_due');
  }
  if (followsStripe(s) && s.subscriptionId === null) bad.push(`${s.state} follows a subscription`);
  if (s.state === 'pro_trial' && s.trialVariant === 'no_card' && s.subscriptionId !== null) {
    bad.push('a no-card trial follows no subscription');
  }
  try {
    limitsFor(s.tier, s.extras);
  } catch (err) {
    bad.push((err as Error).message);
  }
  return bad;
}

const time = (d: Date | null): number | null => (d === null ? null : d.getTime());

/** Whether two snapshots differ in anything but `lastChangeAt`. */
export function sameSnapshot(a: EntitlementSnapshot, b: EntitlementSnapshot): boolean {
  return (
    a.state === b.state &&
    a.tier === b.tier &&
    a.trialVariant === b.trialVariant &&
    time(a.trialEndsAt) === time(b.trialEndsAt) &&
    time(a.trialUsedAt) === time(b.trialUsedAt) &&
    a.pastDueTier === b.pastDueTier &&
    time(a.pastDueSince) === time(b.pastDueSince) &&
    time(a.disputedAt) === time(b.disputedAt) &&
    a.extras.seats === b.extras.seats &&
    a.extras.sites === b.extras.sites &&
    a.subscriptionId === b.subscriptionId
  );
}

function ignored(state: EntitlementSnapshot, reason: string): Transition {
  return { outcome: 'ignored', state, effects: [], reason };
}

function isStaleGrant(s: EntitlementSnapshot, at: Date): boolean {
  return (
    s.lastChangeAt !== null && at.getTime() < s.lastChangeAt.getTime() - STALE_GRANT_TOLERANCE_MS
  );
}

/**
 * Builds an applied transition, deriving the effects every transition shares from what changed:
 * `relimit` when the limits differ; `pause_others` on a move to Free from a paid tier;
 * `pause_over_limit` or `resume` when the site limit falls or rises otherwise; `entitlement.changed`
 * when the state or the limits change. `extra` adds the effects specific to the event. A changed
 * snapshot records `at` as its last change, unless an earlier transition was stamped later.
 */
function applied(
  from: EntitlementSnapshot,
  to: EntitlementSnapshot,
  at: Date,
  extra: Effect[] = [],
): Transition {
  const violations = legalityViolations(to);
  if (violations.length > 0) throw new Error(`illegal transition result: ${violations.join('; ')}`);
  const before = limitsFor(from.tier, from.extras);
  const after = limitsFor(to.tier, to.extras);
  const limitsChanged =
    before.seats !== after.seats ||
    before.sites !== after.sites ||
    before.competitorsPerSite !== after.competitorsPerSite;
  const effects: Effect[] = [];
  if (limitsChanged) effects.push({ kind: 'relimit' });
  if (to.tier === 'free' && from.tier !== 'free') effects.push({ kind: 'pause_others' });
  else if (after.sites < before.sites) effects.push({ kind: 'pause_over_limit' });
  else if (after.sites > before.sites) effects.push({ kind: 'resume' });
  effects.push(...extra);
  if (to.state !== from.state || limitsChanged)
    effects.push({ kind: 'event', name: 'entitlement.changed' });
  const state = sameSnapshot(from, to)
    ? from
    : {
        ...to,
        lastChangeAt:
          from.lastChangeAt !== null && from.lastChangeAt.getTime() > at.getTime()
            ? from.lastChangeAt
            : at,
      };
  return { outcome: 'applied', state, effects };
}

/** Free. `subscriptionId` stays unless `ended` says the subscription is gone. */
function toFree(
  s: EntitlementSnapshot,
  ended: boolean,
  extra: Partial<EntitlementSnapshot> = {},
): EntitlementSnapshot {
  return {
    ...s,
    state: 'free',
    tier: 'free',
    trialEndsAt: null,
    pastDueTier: null,
    pastDueSince: null,
    extras: NO_EXTRAS,
    subscriptionId: ended ? null : s.subscriptionId,
    ...extra,
  };
}

function toPaid(
  s: EntitlementSnapshot,
  plan: PaidTier,
  extras: Extras,
  subscriptionId: string,
): EntitlementSnapshot {
  return {
    ...s,
    state: plan,
    tier: plan,
    trialEndsAt: null,
    pastDueTier: null,
    pastDueSince: null,
    extras,
    subscriptionId,
  };
}

function toPastDue(s: EntitlementSnapshot, at: Date): EntitlementSnapshot {
  if (s.tier === 'free') throw new Error('only a paid tier can fall past due');
  return { ...s, state: 'past_due', pastDueTier: s.tier, pastDueSince: at, trialEndsAt: null };
}

function sameExtras(a: Extras, b: Extras): boolean {
  return a.seats === b.seats && a.sites === b.sites;
}

/** Why a Free account may not start a trial, or null when it may. */
function trialRefusal(s: EntitlementSnapshot, at: Date): string | null {
  if (s.state !== 'free') return 'only a Free account starts a trial';
  if (s.trialUsedAt !== null) return 'the account has used its trial';
  if (s.disputedAt !== null) return 'a disputed account gets no trial';
  if (s.subscriptionId !== null) return 'the account still has a subscription';
  if (isStaleGrant(s, at)) return 'older than the last entitlement change';
  return null;
}

export function next(s: EntitlementSnapshot, e: EntitlementEvent): Transition {
  switch (e.type) {
    case 'trial_started': {
      const refusal = trialRefusal(s, e.at);
      if (refusal !== null) return ignored(s, refusal);
      const trialEndsAt =
        e.variant === 'no_card' ? new Date(e.at.getTime() + TRIAL_DAYS * DAY_MS) : e.trialEnd;
      if (trialEndsAt.getTime() <= e.at.getTime())
        throw new RangeError('a trial must end after it starts');
      const to: EntitlementSnapshot = {
        ...s,
        state: 'pro_trial',
        tier: 'pro',
        trialVariant: e.variant,
        trialEndsAt,
        trialUsedAt: e.at,
        subscriptionId: e.variant === 'card_required' ? e.subscriptionId : null,
      };
      // Only the no-card trial runs on our clock; Stripe times the card-required one.
      return applied(
        s,
        to,
        e.at,
        e.variant === 'no_card' ? [{ kind: 'event', name: 'trial.started' }] : [],
      );
    }

    case 'agency_trial_started': {
      const refusal = trialRefusal(s, e.at);
      if (refusal !== null) return ignored(s, refusal);
      if (e.trialEnd.getTime() <= e.at.getTime())
        throw new RangeError('a trial must end after it starts');
      return applied(
        s,
        {
          ...s,
          state: 'agency_trial',
          tier: 'agency',
          trialEndsAt: e.trialEnd,
          trialUsedAt: e.at,
          subscriptionId: e.subscriptionId,
        },
        e.at,
      );
    }

    case 'trial_reminder_due':
      if (s.state !== 'pro_trial' || s.trialVariant !== 'no_card')
        return ignored(s, 'not a no-card trial');
      return applied(s, s, e.at, [{ kind: 'email', template: 'trial_reminder' }]);

    case 'trial_will_end':
      if (e.subscriptionId !== s.subscriptionId) return ignored(s, 'not the current subscription');
      if (s.state !== 'agency_trial' && s.state !== 'pro_trial') return ignored(s, 'not a trial');
      return applied(s, s, e.at, [{ kind: 'email', template: 'trial_reminder' }]);

    case 'trial_expired':
      if (s.state !== 'pro_trial' || s.trialVariant !== 'no_card')
        return ignored(s, 'not a no-card trial');
      if (e.at.getTime() < s.trialEndsAt!.getTime()) return ignored(s, 'the trial has not ended');
      return applied(s, toFree(s, true), e.at);

    case 'checkout_completed': {
      if (e.subscriptionId === s.subscriptionId)
        return ignored(s, 'already the current subscription');
      if (isStaleGrant(s, e.at)) return ignored(s, 'older than the last entitlement change');
      // A completed checkout is a payment: the account follows the new subscription from here.
      const extra: Effect[] =
        s.state === 'pro_trial' && s.trialVariant === 'no_card'
          ? [{ kind: 'event', name: 'trial.converted' }]
          : [];
      return applied(s, toPaid(s, e.plan, NO_EXTRAS, e.subscriptionId), e.at, extra);
    }

    case 'subscription_updated': {
      if (e.subscriptionId !== s.subscriptionId) return ignored(s, 'not the current subscription');
      switch (e.status) {
        case 'active': {
          limitsFor(e.plan, e.extras); // throws on extras the plan does not sell
          if (isStaleGrant(s, e.at)) return ignored(s, 'older than the last entitlement change');
          if (s.state === 'free' && s.disputedAt !== null)
            return ignored(s, 'a disputed account is restored only by hand');
          if ((s.state === 'pro' || s.state === 'agency') && s.tier === e.plan) {
            if (sameExtras(s.extras, e.extras)) return ignored(s, 'no entitlement change');
          }
          return applied(s, toPaid(s, e.plan, e.extras, e.subscriptionId), e.at);
        }
        case 'past_due':
          if (s.state === 'free' || s.state === 'past_due')
            return ignored(s, `a ${s.state} account does not fall past due again`);
          return applied(s, toPastDue(s, e.at), e.at);
        case 'canceled':
        case 'unpaid':
        case 'incomplete_expired':
          return applied(s, toFree(s, true), e.at);
        case 'paused':
          // Stripe pauses a subscription whose trial ended without a payment method; it can resume.
          if (s.state === 'free') return ignored(s, 'already Free');
          return applied(s, toFree(s, false), e.at);
        case 'trialing':
        case 'incomplete':
          return ignored(s, `status ${e.status} changes no entitlement`);
      }
      throw new Error(`unknown subscription status ${String(e.status)}`);
    }

    case 'subscription_deleted':
      if (e.subscriptionId !== s.subscriptionId) return ignored(s, 'not the current subscription');
      return applied(s, toFree(s, true), e.at);

    case 'invoice_payment_failed':
      if (e.subscriptionId !== s.subscriptionId) return ignored(s, 'not the current subscription');
      if (s.state === 'free' || s.state === 'past_due')
        return ignored(s, `a ${s.state} account does not fall past due again`);
      return applied(s, toPastDue(s, e.at), e.at);

    case 'dispute_created':
      // SECURITY-DESIGN §5.4: paid entitlement goes at once, and the first mark blocks any later
      // trial. Each dispute alerts the founder: each has its own evidence deadline.
      return applied(s, toFree(s, false, { disputedAt: s.disputedAt ?? e.at }), e.at, [
        { kind: 'founder_alert', reason: 'dispute' },
      ]);

    case 'past_due_lapsed': {
      if (s.state !== 'past_due') return ignored(s, 'not past due');
      const graceEnds = s.pastDueSince!.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS;
      if (e.at.getTime() < graceEnds) return ignored(s, 'the grace window is still open');
      // The subscription is still Stripe's to retry: a later `active` on it restores the plan.
      return applied(s, toFree(s, false), e.at);
    }

    case 'recorded_only':
      return ignored(s, `${e.stripeType} is recorded, not applied`);
  }
}
