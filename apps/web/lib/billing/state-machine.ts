/**
 * The v2 entitlement state machine (ARCH-2 §3.2): a pure `next(snapshot, event)` that returns the
 * next snapshot and the effects to carry out. It reads no clock and no database; every event carries
 * its own time. `applyEntitlementTransition` (./state-machine-apply.ts) writes the result.
 *
 * Events are normalised: CC-03 turns Stripe's webhook payloads into them (`STRIPE_EVENTS` below says
 * which Stripe event becomes which). Not imported by any live route.
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
});

export type RecordedOnlyStripeEvent =
  | 'customer.subscription.created'
  | 'setup_intent.succeeded'
  | 'charge.refunded'
  | 'customer.updated';

export type EntitlementEvent =
  /** A Free account starts the 14-day Pro trial: at sign-up, or by one click (DECISION-LOG H5). */
  | { type: 'trial_started'; at: Date; variant: 'no_card' }
  /** As above with a card on file: Stripe's `trialing` subscription sets the end. */
  | { type: 'trial_started'; at: Date; variant: 'card_required'; trialEnd: Date }
  | { type: 'agency_trial_started'; at: Date; trialEnd: Date }
  /** Our clock, 3 days before a no-card trial ends. */
  | { type: 'trial_reminder_due'; at: Date }
  /** `customer.subscription.trial_will_end`. */
  | { type: 'trial_will_end'; at: Date }
  /** Our clock, at the end of a no-card trial. */
  | { type: 'trial_expired'; at: Date }
  | { type: 'checkout_completed'; at: Date; plan: PaidTier }
  | {
      type: 'subscription_updated';
      at: Date;
      status: SubscriptionStatus;
      plan: PaidTier;
      cancelAtPeriodEnd: boolean;
      extras: Extras;
    }
  | { type: 'subscription_deleted'; at: Date }
  | { type: 'invoice_paid'; at: Date }
  | { type: 'invoice_payment_failed'; at: Date }
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
  'invoice.paid': 'invoice_paid',
  'invoice.payment_failed': 'invoice_payment_failed',
  'setup_intent.succeeded': 'recorded_only',
  'charge.dispute.created': 'dispute_created',
  'charge.refunded': 'recorded_only',
  'customer.updated': 'recorded_only',
});

export type Effect =
  /** Write the plan's limits; also removes the newest seats beyond the seat limit. */
  | { kind: 'relimit' }
  /** Free again: the oldest primary site keeps a monthly check, the others pause (`trial_ended`). */
  | { kind: 'pause_others' }
  /** Fewer sites allowed: the newest primary sites beyond the limit pause (`over_limit`). */
  | { kind: 'pause_over_limit' }
  /** More sites allowed: sites paused for `trial_ended` or `over_limit` resume, up to the limit. */
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

/**
 * What makes a snapshot legal. The database holds the same rules as CHECK constraints on
 * `accounts`; `apply-entitlement-transition.test.ts` shows each snapshot the machine produces is
 * accepted there.
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
  try {
    limitsFor(s.tier, s.extras);
  } catch (err) {
    bad.push((err as Error).message);
  }
  return bad;
}

function ignored(state: EntitlementSnapshot, reason: string): Transition {
  return { outcome: 'ignored', state, effects: [], reason };
}

/**
 * Builds an applied transition, deriving the effects every transition shares from what changed:
 * `relimit` when the limits differ; `pause_others` on a move to Free from a paid tier;
 * `pause_over_limit` or `resume` when the site limit falls or rises otherwise; `entitlement.changed`
 * when the state or the limits change. `extra` adds the effects specific to the event.
 */
function applied(
  from: EntitlementSnapshot,
  to: EntitlementSnapshot,
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
  return { outcome: 'applied', state: to, effects };
}

function toFree(
  s: EntitlementSnapshot,
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
    ...extra,
  };
}

function toPaid(s: EntitlementSnapshot, plan: PaidTier, extras: Extras): EntitlementSnapshot {
  return {
    ...s,
    state: plan,
    tier: plan,
    trialEndsAt: null,
    pastDueTier: null,
    pastDueSince: null,
    extras,
  };
}

function toPastDue(s: EntitlementSnapshot, at: Date): EntitlementSnapshot {
  if (s.tier === 'free') throw new Error('only a paid tier can fall past due');
  return { ...s, state: 'past_due', pastDueTier: s.tier, pastDueSince: at, trialEndsAt: null };
}

/** An account whose entitlement Stripe drives: paid, past due, or on a trial with a card on file. */
function onStripe(s: EntitlementSnapshot): boolean {
  switch (s.state) {
    case 'pro':
    case 'agency':
    case 'agency_trial':
    case 'past_due':
      return true;
    case 'pro_trial':
      return s.trialVariant === 'card_required';
    case 'free':
      return false;
  }
}

function sameExtras(a: Extras, b: Extras): boolean {
  return a.seats === b.seats && a.sites === b.sites;
}

export function next(s: EntitlementSnapshot, e: EntitlementEvent): Transition {
  switch (e.type) {
    case 'trial_started': {
      if (s.state !== 'free') return ignored(s, 'only a Free account starts a trial');
      if (s.trialUsedAt !== null) return ignored(s, 'the account has used its trial');
      if (s.disputedAt !== null) return ignored(s, 'a disputed account gets no trial');
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
      };
      // Only the no-card trial runs on our clock; Stripe times the card-required one.
      return applied(
        s,
        to,
        e.variant === 'no_card' ? [{ kind: 'event', name: 'trial.started' }] : [],
      );
    }

    case 'agency_trial_started': {
      if (s.state !== 'free') return ignored(s, 'only a Free account starts a trial');
      if (s.trialUsedAt !== null) return ignored(s, 'the account has used its trial');
      if (s.disputedAt !== null) return ignored(s, 'a disputed account gets no trial');
      if (e.trialEnd.getTime() <= e.at.getTime())
        throw new RangeError('a trial must end after it starts');
      return applied(s, {
        ...s,
        state: 'agency_trial',
        tier: 'agency',
        trialEndsAt: e.trialEnd,
        trialUsedAt: e.at,
      });
    }

    case 'trial_reminder_due':
      if (s.state !== 'pro_trial' || s.trialVariant !== 'no_card')
        return ignored(s, 'not a no-card trial');
      return applied(s, s, [{ kind: 'email', template: 'trial_reminder' }]);

    case 'trial_will_end':
      if (
        !(
          s.state === 'agency_trial' ||
          (s.state === 'pro_trial' && s.trialVariant === 'card_required')
        )
      ) {
        return ignored(s, 'not a trial on Stripe’s clock');
      }
      return applied(s, s, [{ kind: 'email', template: 'trial_reminder' }]);

    case 'trial_expired':
      if (s.state !== 'pro_trial' || s.trialVariant !== 'no_card')
        return ignored(s, 'not a no-card trial');
      if (e.at.getTime() < s.trialEndsAt!.getTime()) return ignored(s, 'the trial has not ended');
      return applied(s, toFree(s));

    case 'checkout_completed': {
      if (s.state === 'free') return applied(s, toPaid(s, e.plan, NO_EXTRAS));
      if (s.state === 'pro_trial') {
        const extra: Effect[] =
          s.trialVariant === 'no_card' ? [{ kind: 'event', name: 'trial.converted' }] : [];
        return applied(s, toPaid(s, e.plan, NO_EXTRAS), extra);
      }
      if (s.state === 'pro' && e.plan === 'agency')
        return applied(s, toPaid(s, 'agency', NO_EXTRAS));
      return ignored(s, `a checkout does not change a ${s.state} account`);
    }

    case 'subscription_updated': {
      limitsFor(e.plan, e.extras); // throws on extras the plan does not sell
      if (!onStripe(s)) return ignored(s, 'the account has no Stripe subscription to follow');
      switch (e.status) {
        case 'active': {
          if (s.state === 'pro' || s.state === 'agency') {
            if (s.tier === e.plan && sameExtras(s.extras, e.extras))
              return ignored(s, 'no entitlement change');
          }
          return applied(s, toPaid(s, e.plan, e.extras));
        }
        case 'past_due':
          if (s.state === 'past_due')
            return ignored(s, 'already past due; the grace clock does not restart');
          return applied(s, toPastDue(s, e.at));
        case 'canceled':
        case 'unpaid':
        case 'incomplete_expired':
          return applied(s, toFree(s));
        case 'trialing':
        case 'incomplete':
        case 'paused':
          return ignored(s, `status ${e.status} changes no entitlement`);
      }
      throw new Error(`unknown subscription status ${String(e.status)}`);
    }

    case 'subscription_deleted':
      if (!onStripe(s)) return ignored(s, 'the account has no Stripe subscription to follow');
      return applied(s, toFree(s));

    case 'invoice_paid':
      if (s.state !== 'past_due') return ignored(s, 'nothing is owed');
      return applied(s, toPaid(s, s.pastDueTier!, s.extras));

    case 'invoice_payment_failed':
      if (!onStripe(s)) return ignored(s, 'the account has no Stripe subscription to follow');
      if (s.state === 'past_due')
        return ignored(s, 'already past due; the grace clock does not restart');
      return applied(s, toPastDue(s, e.at));

    case 'dispute_created':
      // SECURITY-DESIGN §5.4: paid entitlement goes at once, and the mark blocks any later trial.
      if (s.disputedAt !== null && s.state === 'free') return ignored(s, 'already marked disputed');
      return applied(s, toFree(s, { disputedAt: s.disputedAt ?? e.at }), [
        { kind: 'founder_alert', reason: 'dispute' },
      ]);

    case 'past_due_lapsed': {
      if (s.state !== 'past_due') return ignored(s, 'not past due');
      const graceEnds = s.pastDueSince!.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS;
      if (e.at.getTime() < graceEnds) return ignored(s, 'the grace window is still open');
      return applied(s, toFree(s));
    }

    case 'recorded_only':
      return ignored(s, `${e.stripeType} is recorded, not applied`);
  }
}
