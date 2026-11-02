import { describe, expect, it } from 'vitest';
import { effectiveTier } from '../entitlement-v2';
import {
  FREE_START,
  STALE_GRANT_TOLERANCE_MS,
  TRIAL_DAYS,
  effectKey,
  legalityViolations,
  next,
  type EntitlementEvent,
  type EntitlementSnapshot,
  type SubscriptionStatus,
} from './state-machine';

/**
 * The transition table of ARCH-2 §3.2 as amended by the owner (2026-11-01): one row per transition,
 * plus the events each state must ignore. Expected states and effects are literals, never computed
 * from the module, so this is independent truth for `next()` (OPERATING-RULES §10). Effects compare
 * as a set.
 */

const T = new Date('2026-11-01T00:00:00.000Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(T.getTime() + ms);
const LATER = at(DAY);
const A = 'sub_A';
const B = 'sub_B';

const FREE: EntitlementSnapshot = FREE_START;
const FREE_USED: EntitlementSnapshot = {
  ...FREE,
  trialUsedAt: T,
  trialVariant: 'no_card',
  lastChangeAt: T,
};
const FREE_DISPUTED: EntitlementSnapshot = { ...FREE, disputedAt: T, lastChangeAt: T };
/** Lapsed after past_due: Free, but Stripe may still collect on subscription A. */
const FREE_LAPSED: EntitlementSnapshot = { ...FREE, subscriptionId: A, lastChangeAt: T };
const TRIAL_NC: EntitlementSnapshot = {
  ...FREE,
  state: 'pro_trial',
  tier: 'pro',
  trialVariant: 'no_card',
  trialEndsAt: at(14 * DAY),
  trialUsedAt: T,
  // A no-card trial starts on our clock, which does not move the last change.
  lastChangeAt: null,
};
const TRIAL_CR: EntitlementSnapshot = {
  ...TRIAL_NC,
  trialVariant: 'card_required',
  subscriptionId: A,
  lastChangeAt: T,
};
const PRO: EntitlementSnapshot = {
  ...FREE,
  state: 'pro',
  tier: 'pro',
  subscriptionId: A,
  lastChangeAt: T,
};
const AGENCY: EntitlementSnapshot = {
  ...FREE,
  state: 'agency',
  tier: 'agency',
  extras: { seats: 2, sites: 3 },
  subscriptionId: A,
  lastChangeAt: T,
};
const AGENCY_TRIAL: EntitlementSnapshot = {
  ...FREE,
  state: 'agency_trial',
  tier: 'agency',
  trialEndsAt: at(14 * DAY),
  trialUsedAt: T,
  subscriptionId: A,
  lastChangeAt: T,
};
const PAST_DUE_PRO: EntitlementSnapshot = {
  ...PRO,
  state: 'past_due',
  pastDueTier: 'pro',
  pastDueSince: T,
};
const PAST_DUE_AGENCY: EntitlementSnapshot = {
  ...AGENCY,
  state: 'past_due',
  pastDueTier: 'agency',
  pastDueSince: T,
};

const sub = (
  status: SubscriptionStatus,
  plan: 'pro' | 'agency' = 'pro',
  more: {
    cancelAtPeriodEnd?: boolean;
    extras?: { seats: number; sites: number };
    id?: string;
    at?: Date;
  } = {},
): EntitlementEvent => ({
  type: 'subscription_updated',
  at: more.at ?? LATER,
  subscriptionId: more.id ?? A,
  status,
  plan,
  cancelAtPeriodEnd: more.cancelAtPeriodEnd ?? false,
  extras: more.extras ?? { seats: 0, sites: 0 },
});
const deleted = (id = A, when = LATER): EntitlementEvent => ({
  type: 'subscription_deleted',
  at: when,
  subscriptionId: id,
});
const failed = (id = A, when = LATER): EntitlementEvent => ({
  type: 'invoice_payment_failed',
  at: when,
  subscriptionId: id,
});
const checkout = (
  plan: 'pro' | 'agency',
  id = B,
  when = LATER,
  live: { status?: SubscriptionStatus; extras?: { seats: number; sites: number } } = {},
): EntitlementEvent => ({
  type: 'checkout_completed',
  at: when,
  plan,
  subscriptionId: id,
  subscriptionStatus: live.status ?? 'active',
  extras: live.extras ?? { seats: 0, sites: 0 },
});
const dispute = (when = LATER): EntitlementEvent => ({ type: 'dispute_created', at: when });

const TO_FREE = ['pause_others', 'relimit', 'event:entitlement.changed'];
const UP = ['relimit', 'resume', 'event:entitlement.changed'];
const CHANGED = ['event:entitlement.changed'];

interface Row {
  label: string;
  from: EntitlementSnapshot;
  event: EntitlementEvent;
  /** `ignored`, or the fields of the next snapshot that must hold, and the exact effect set. */
  expect: 'ignored' | { state: Partial<EntitlementSnapshot>; effects: string[] };
}

const ROWS: Row[] = [
  // ─── free ───
  {
    label: 'free + no-card trial starts',
    from: FREE,
    event: { type: 'trial_started', at: T, variant: 'no_card' },
    expect: {
      state: {
        state: 'pro_trial',
        tier: 'pro',
        trialVariant: 'no_card',
        trialEndsAt: at(14 * DAY),
        trialUsedAt: T,
        subscriptionId: null,
        lastChangeAt: null,
      },
      effects: [...UP, 'event:trial.started'],
    },
  },
  {
    label: 'free + card-required trial starts on Stripe’s clock and follows its subscription',
    from: FREE,
    event: {
      type: 'trial_started',
      at: T,
      variant: 'card_required',
      trialEnd: at(14 * DAY + 5),
      subscriptionId: A,
      subscriptionStatus: 'trialing',
    },
    expect: {
      state: {
        state: 'pro_trial',
        trialVariant: 'card_required',
        trialEndsAt: at(14 * DAY + 5),
        subscriptionId: A,
      },
      effects: UP,
    },
  },
  {
    label: 'free with a used trial + trial starts',
    from: FREE_USED,
    event: { type: 'trial_started', at: LATER, variant: 'no_card' },
    expect: 'ignored',
  },
  {
    label: 'free and disputed + trial starts',
    from: FREE_DISPUTED,
    event: { type: 'trial_started', at: LATER, variant: 'no_card' },
    expect: 'ignored',
  },
  {
    label: 'free with a lapsed subscription + trial starts',
    from: FREE_LAPSED,
    event: { type: 'trial_started', at: LATER, variant: 'no_card' },
    expect: 'ignored',
  },
  {
    label: 'free after a paid plan ended (never trialled) + card trial stamped before it (stale)',
    from: { ...FREE, lastChangeAt: T },
    event: {
      type: 'trial_started',
      at: at(-5000),
      variant: 'card_required',
      trialEnd: at(14 * DAY),
      subscriptionId: A,
      subscriptionStatus: 'trialing',
    },
    expect: 'ignored',
  },
  {
    label: 'free after a paid plan ended (never trialled) + agency trial stamped before it (stale)',
    from: { ...FREE, lastChangeAt: T },
    event: {
      type: 'agency_trial_started',
      at: at(-5000),
      trialEnd: at(14 * DAY),
      subscriptionId: A,
      subscriptionStatus: 'trialing',
    },
    expect: 'ignored',
  },
  {
    label: 'free + agency trial starts',
    from: FREE,
    event: {
      type: 'agency_trial_started',
      at: T,
      trialEnd: at(14 * DAY),
      subscriptionId: A,
      subscriptionStatus: 'trialing',
    },
    expect: {
      state: {
        state: 'agency_trial',
        tier: 'agency',
        trialEndsAt: at(14 * DAY),
        trialUsedAt: T,
        subscriptionId: A,
      },
      effects: UP,
    },
  },
  {
    label: 'free with a used trial + agency trial starts',
    from: FREE_USED,
    event: {
      type: 'agency_trial_started',
      at: LATER,
      trialEnd: at(15 * DAY),
      subscriptionId: A,
      subscriptionStatus: 'trialing',
    },
    expect: 'ignored',
  },
  {
    label: 'free and disputed + agency trial starts',
    from: FREE_DISPUTED,
    event: {
      type: 'agency_trial_started',
      at: LATER,
      trialEnd: at(15 * DAY),
      subscriptionId: A,
      subscriptionStatus: 'trialing',
    },
    expect: 'ignored',
  },
  {
    label: 'free + Pro checkout follows the new subscription',
    from: FREE,
    event: checkout('pro'),
    expect: {
      state: { state: 'pro', tier: 'pro', subscriptionId: B, lastChangeAt: LATER },
      effects: UP,
    },
  },
  {
    label: 'free + Agency checkout',
    from: FREE,
    event: checkout('agency'),
    expect: { state: { state: 'agency', subscriptionId: B }, effects: UP },
  },
  {
    label: 'free + active on a subscription it does not follow',
    from: FREE,
    event: sub('active'),
    expect: 'ignored',
  },
  {
    label: 'lapsed free + active on its subscription restores the plan',
    from: FREE_LAPSED,
    event: sub('active'),
    expect: { state: { state: 'pro', tier: 'pro', subscriptionId: A }, effects: UP },
  },
  {
    label: 'lapsed free and disputed + active',
    from: { ...FREE_LAPSED, disputedAt: T },
    event: sub('active'),
    expect: 'ignored',
  },
  {
    label: 'lapsed free + active stamped 2 s before the lapse (stale)',
    from: FREE_LAPSED,
    event: sub('active', 'pro', { at: at(-2000) }),
    expect: 'ignored',
  },
  {
    label: 'lapsed free + active stamped within the second of the lapse',
    from: FREE_LAPSED,
    event: sub('active', 'pro', { at: at(-500) }),
    expect: { state: { state: 'pro', lastChangeAt: T }, effects: UP },
  },
  {
    label: 'lapsed free + its subscription canceled: follows none',
    from: FREE_LAPSED,
    event: sub('canceled'),
    expect: { state: { state: 'free', subscriptionId: null }, effects: [] },
  },
  { label: 'free + subscription deleted', from: FREE, event: deleted(), expect: 'ignored' },
  {
    label: 'lapsed free + payment failed',
    from: FREE_LAPSED,
    event: failed(),
    expect: { state: { lastChangeAt: LATER }, effects: [] },
  },
  {
    label: 'free after a deletion + checkout stamped before it (stale)',
    from: FREE_USED,
    event: checkout('pro', B, at(-5000)),
    expect: 'ignored',
  },
  {
    label: 'free and disputed + checkout stamped before the dispute (stale)',
    from: FREE_DISPUTED,
    event: checkout('agency', B, at(-5000)),
    expect: 'ignored',
  },
  {
    label: 'free + dispute: marked, so no trial can start',
    from: FREE,
    event: dispute(),
    expect: { state: { state: 'free', disputedAt: LATER }, effects: ['founder_alert'] },
  },
  {
    label: 'free and disputed + a second dispute alerts again and keeps the first date',
    from: FREE_DISPUTED,
    event: dispute(),
    expect: { state: { disputedAt: T, lastChangeAt: LATER }, effects: ['founder_alert'] },
  },

  // ─── pro_trial ───
  {
    label: 'no-card trial + reminder due',
    from: TRIAL_NC,
    event: { type: 'trial_reminder_due', at: at(11 * DAY) },
    expect: { state: { state: 'pro_trial' }, effects: ['email:trial_reminder'] },
  },
  {
    label: 'card trial + our reminder',
    from: TRIAL_CR,
    event: { type: 'trial_reminder_due', at: at(11 * DAY) },
    expect: 'ignored',
  },
  {
    label: 'card trial + Stripe trial_will_end on its subscription',
    from: TRIAL_CR,
    event: { type: 'trial_will_end', at: at(11 * DAY), subscriptionId: A },
    expect: { state: { state: 'pro_trial' }, effects: ['email:trial_reminder'] },
  },
  {
    label: 'card trial + trial_will_end on another subscription',
    from: TRIAL_CR,
    event: { type: 'trial_will_end', at: at(11 * DAY), subscriptionId: B },
    expect: 'ignored',
  },
  {
    label: 'no-card trial + Stripe trial_will_end',
    from: TRIAL_NC,
    event: { type: 'trial_will_end', at: at(11 * DAY), subscriptionId: A },
    expect: 'ignored',
  },
  {
    label: 'no-card trial + expired at its end',
    from: TRIAL_NC,
    event: { type: 'trial_expired', at: at(14 * DAY) },
    expect: {
      state: { state: 'free', tier: 'free', trialEndsAt: null, trialUsedAt: T },
      effects: TO_FREE,
    },
  },
  {
    label: 'no-card trial + expired early',
    from: TRIAL_NC,
    event: { type: 'trial_expired', at: at(14 * DAY - 1) },
    expect: 'ignored',
  },
  {
    label: 'card trial + our expiry',
    from: TRIAL_CR,
    event: { type: 'trial_expired', at: at(15 * DAY) },
    expect: 'ignored',
  },
  {
    label: 'card trial + subscription active (day 15 charge)',
    from: TRIAL_CR,
    event: sub('active'),
    expect: {
      state: { state: 'pro', tier: 'pro', trialEndsAt: null, subscriptionId: A },
      effects: CHANGED,
    },
  },
  {
    label: 'no-card trial + subscription active',
    from: TRIAL_NC,
    event: sub('active'),
    expect: 'ignored',
  },
  {
    label: 'card trial + subscription still trialing',
    from: TRIAL_CR,
    event: sub('trialing'),
    expect: 'ignored',
  },
  {
    label: 'card trial + subscription deleted',
    from: TRIAL_CR,
    event: deleted(),
    expect: { state: { state: 'free', subscriptionId: null }, effects: TO_FREE },
  },
  {
    label: 'card trial + another subscription deleted',
    from: TRIAL_CR,
    event: deleted(B),
    expect: 'ignored',
  },
  {
    label: 'card trial + subscription incomplete_expired',
    from: TRIAL_CR,
    event: sub('incomplete_expired'),
    expect: { state: { state: 'free' }, effects: TO_FREE },
  },
  {
    label: 'card trial + subscription paused (trial ended without a card)',
    from: TRIAL_CR,
    event: sub('paused'),
    expect: { state: { state: 'free', subscriptionId: A }, effects: TO_FREE },
  },
  {
    label: 'no-card trial + subscription deleted',
    from: TRIAL_NC,
    event: deleted(),
    expect: 'ignored',
  },
  {
    label: 'no-card trial + Pro checkout',
    from: TRIAL_NC,
    event: checkout('pro'),
    expect: {
      state: { state: 'pro', tier: 'pro', trialEndsAt: null, subscriptionId: B },
      effects: ['event:trial.converted', ...CHANGED],
    },
  },
  {
    label: 'no-card trial + Agency checkout',
    from: TRIAL_NC,
    event: checkout('agency'),
    expect: {
      state: { state: 'agency', subscriptionId: B },
      effects: [...UP, 'event:trial.converted'],
    },
  },
  {
    label: 'card trial + checkout follows the new subscription',
    from: TRIAL_CR,
    event: checkout('pro'),
    expect: { state: { state: 'pro', subscriptionId: B }, effects: CHANGED },
  },
  {
    label: 'card trial + payment failed',
    from: TRIAL_CR,
    event: failed(),
    expect: {
      state: {
        state: 'past_due',
        tier: 'pro',
        pastDueTier: 'pro',
        pastDueSince: LATER,
        trialEndsAt: null,
      },
      effects: CHANGED,
    },
  },
  { label: 'no-card trial + payment failed', from: TRIAL_NC, event: failed(), expect: 'ignored' },
  {
    label: 'no-card trial + subscription past_due',
    from: TRIAL_NC,
    event: sub('past_due'),
    expect: 'ignored',
  },

  // ─── pro ───
  {
    label: 'pro + Portal upgrade to Agency',
    from: PRO,
    event: sub('active', 'agency'),
    expect: { state: { state: 'agency', tier: 'agency' }, effects: UP },
  },
  {
    label: 'pro + cancel at period end',
    from: PRO,
    event: sub('active', 'pro', { cancelAtPeriodEnd: true }),
    expect: 'ignored',
  },
  {
    label: 'pro + renewal with nothing changed',
    from: PRO,
    event: sub('active'),
    expect: 'ignored',
  },
  {
    label: 'pro + active stamped before the last change (stale)',
    from: PRO,
    event: sub('active', 'agency', { at: at(-5000) }),
    expect: 'ignored',
  },
  {
    label: 'pro + subscription past_due',
    from: PRO,
    event: sub('past_due'),
    expect: {
      state: { state: 'past_due', tier: 'pro', pastDueTier: 'pro', pastDueSince: LATER },
      effects: CHANGED,
    },
  },
  {
    label: 'pro + payment failed',
    from: PRO,
    event: failed(),
    expect: { state: { state: 'past_due', pastDueSince: LATER }, effects: CHANGED },
  },
  {
    label: 'pro + payment failed on another subscription',
    from: PRO,
    event: failed(B),
    expect: 'ignored',
  },
  {
    label: 'pro + subscription deleted',
    from: PRO,
    event: deleted(),
    expect: { state: { state: 'free', subscriptionId: null }, effects: TO_FREE },
  },
  { label: 'pro + another subscription deleted', from: PRO, event: deleted(B), expect: 'ignored' },
  {
    label:
      'pro + its deletion stamped long before the last change still applies (revokes are not aged)',
    from: PRO,
    event: deleted(A, at(-10 * DAY)),
    expect: { state: { state: 'free', lastChangeAt: T }, effects: TO_FREE },
  },
  {
    label: 'pro + subscription canceled',
    from: PRO,
    event: sub('canceled'),
    expect: { state: { state: 'free' }, effects: TO_FREE },
  },
  {
    label: 'pro + canceled carrying extras the plan does not sell still revokes',
    from: PRO,
    event: sub('canceled', 'pro', { extras: { seats: 2, sites: 0 } }),
    expect: { state: { state: 'free' }, effects: TO_FREE },
  },
  {
    label: 'pro + subscription paused',
    from: PRO,
    event: sub('paused'),
    expect: { state: { state: 'free', subscriptionId: A }, effects: TO_FREE },
  },
  {
    label: 'pro + dispute',
    from: PRO,
    event: dispute(),
    expect: { state: { state: 'free', disputedAt: LATER }, effects: [...TO_FREE, 'founder_alert'] },
  },
  {
    label: 'pro + Agency checkout',
    from: PRO,
    event: checkout('agency'),
    expect: { state: { state: 'agency', subscriptionId: B }, effects: UP },
  },
  {
    label: 'pro + its own checkout replayed',
    from: PRO,
    event: checkout('pro', A),
    expect: 'ignored',
  },
  {
    label: 'pro + a new Pro checkout: follows the new subscription, nothing else changes',
    from: PRO,
    event: checkout('pro'),
    expect: { state: { state: 'pro', subscriptionId: B, lastChangeAt: LATER }, effects: [] },
  },
  {
    label: 'pro + lapse sweep (not past_due)',
    from: PRO,
    event: { type: 'past_due_lapsed', at: at(30 * DAY) },
    expect: 'ignored',
  },

  // ─── agency ───
  {
    label: 'agency + downgrade to Pro',
    from: AGENCY,
    event: sub('active', 'pro'),
    expect: {
      state: { state: 'pro', tier: 'pro', extras: { seats: 0, sites: 0 } },
      effects: ['relimit', 'pause_over_limit', ...CHANGED],
    },
  },
  {
    label: 'agency + more extras',
    from: AGENCY,
    event: sub('active', 'agency', { extras: { seats: 4, sites: 25 } }),
    expect: { state: { state: 'agency', extras: { seats: 4, sites: 25 } }, effects: UP },
  },
  {
    label: 'agency + fewer extras',
    from: AGENCY,
    event: sub('active', 'agency'),
    expect: {
      state: { extras: { seats: 0, sites: 0 } },
      effects: ['relimit', 'pause_over_limit', ...CHANGED],
    },
  },
  {
    label: 'agency + fewer seats, same sites',
    from: AGENCY,
    event: sub('active', 'agency', { extras: { seats: 0, sites: 3 } }),
    expect: { state: { extras: { seats: 0, sites: 3 } }, effects: ['relimit', ...CHANGED] },
  },
  {
    label: 'agency + same extras',
    from: AGENCY,
    event: sub('active', 'agency', { extras: { seats: 2, sites: 3 } }),
    expect: 'ignored',
  },
  {
    label: 'agency + cancel at period end',
    from: AGENCY,
    event: sub('active', 'agency', { cancelAtPeriodEnd: true, extras: { seats: 2, sites: 3 } }),
    expect: 'ignored',
  },
  {
    label: 'agency + payment failed keeps the extras',
    from: AGENCY,
    event: failed(),
    expect: {
      state: {
        state: 'past_due',
        tier: 'agency',
        pastDueTier: 'agency',
        extras: { seats: 2, sites: 3 },
      },
      effects: CHANGED,
    },
  },
  {
    label: 'agency + subscription deleted',
    from: AGENCY,
    event: deleted(),
    expect: { state: { state: 'free', extras: { seats: 0, sites: 0 } }, effects: TO_FREE },
  },
  {
    label: 'agency + a Pro checkout follows the new subscription',
    from: AGENCY,
    event: checkout('pro'),
    expect: {
      state: { state: 'pro', subscriptionId: B, extras: { seats: 0, sites: 0 } },
      effects: ['relimit', 'pause_over_limit', ...CHANGED],
    },
  },

  // ─── agency_trial ───
  {
    label: 'agency trial + subscription active (day 15 charge)',
    from: AGENCY_TRIAL,
    event: sub('active', 'agency'),
    expect: { state: { state: 'agency', trialEndsAt: null }, effects: CHANGED },
  },
  {
    label: 'agency trial + Stripe trial_will_end',
    from: AGENCY_TRIAL,
    event: { type: 'trial_will_end', at: at(11 * DAY), subscriptionId: A },
    expect: { state: { state: 'agency_trial' }, effects: ['email:trial_reminder'] },
  },
  {
    label: 'agency trial + subscription deleted',
    from: AGENCY_TRIAL,
    event: deleted(),
    expect: { state: { state: 'free', trialEndsAt: null }, effects: TO_FREE },
  },
  {
    label: 'agency trial + subscription canceled',
    from: AGENCY_TRIAL,
    event: sub('canceled', 'agency'),
    expect: { state: { state: 'free' }, effects: TO_FREE },
  },
  {
    label: 'agency trial + subscription past_due (J3)',
    from: AGENCY_TRIAL,
    event: sub('past_due', 'agency'),
    expect: {
      state: { state: 'past_due', pastDueTier: 'agency', pastDueSince: LATER, trialEndsAt: null },
      effects: CHANGED,
    },
  },
  {
    label: 'agency trial + payment failed (J3)',
    from: AGENCY_TRIAL,
    event: failed(),
    expect: { state: { state: 'past_due', pastDueTier: 'agency' }, effects: CHANGED },
  },
  {
    label: 'agency trial + our expiry',
    from: AGENCY_TRIAL,
    event: { type: 'trial_expired', at: at(20 * DAY) },
    expect: 'ignored',
  },
  {
    label: 'agency trial + checkout follows the new subscription',
    from: AGENCY_TRIAL,
    event: checkout('agency'),
    expect: { state: { state: 'agency', subscriptionId: B }, effects: CHANGED },
  },

  // ─── past_due ───
  {
    label: 'past_due + invoice.paid is recorded only',
    from: PAST_DUE_PRO,
    event: { type: 'recorded_only', at: LATER, stripeType: 'invoice.paid' },
    expect: 'ignored',
  },
  {
    label: 'past_due agency + subscription active keeps the extras',
    from: PAST_DUE_AGENCY,
    event: sub('active', 'agency', { extras: { seats: 2, sites: 3 } }),
    expect: {
      state: {
        state: 'agency',
        pastDueTier: null,
        pastDueSince: null,
        extras: { seats: 2, sites: 3 },
      },
      effects: CHANGED,
    },
  },
  {
    label: 'past_due + active stamped before the failure (stale)',
    from: PAST_DUE_PRO,
    event: sub('active', 'pro', { at: at(-5 * DAY) }),
    expect: 'ignored',
  },
  {
    label: 'past_due + another failure does not restart the clock',
    from: PAST_DUE_PRO,
    event: failed(),
    expect: { state: { state: 'past_due', pastDueSince: T, lastChangeAt: LATER }, effects: [] },
  },
  {
    label: 'past_due + subscription past_due again',
    from: PAST_DUE_PRO,
    event: sub('past_due'),
    expect: { state: { lastChangeAt: LATER }, effects: [] },
  },
  {
    label: 'past_due + lapsed at 7 days keeps following its subscription',
    from: PAST_DUE_PRO,
    event: { type: 'past_due_lapsed', at: at(7 * DAY) },
    expect: {
      state: {
        state: 'free',
        tier: 'free',
        pastDueTier: null,
        pastDueSince: null,
        subscriptionId: A,
      },
      effects: TO_FREE,
    },
  },
  {
    label: 'past_due + lapsed 1 ms early',
    from: PAST_DUE_PRO,
    event: { type: 'past_due_lapsed', at: at(7 * DAY - 1) },
    expect: 'ignored',
  },
  {
    label: 'past_due + subscription deleted',
    from: PAST_DUE_PRO,
    event: deleted(),
    expect: { state: { state: 'free', subscriptionId: null }, effects: TO_FREE },
  },
  {
    label: 'past_due + subscription unpaid',
    from: PAST_DUE_PRO,
    event: sub('unpaid'),
    expect: { state: { state: 'free' }, effects: TO_FREE },
  },
  {
    label: 'past_due + dispute',
    from: PAST_DUE_AGENCY,
    event: dispute(),
    expect: {
      state: { state: 'free', disputedAt: LATER, extras: { seats: 0, sites: 0 } },
      effects: [...TO_FREE, 'founder_alert'],
    },
  },
  {
    label: 'past_due + a new checkout',
    from: PAST_DUE_PRO,
    event: checkout('pro'),
    expect: { state: { state: 'pro', subscriptionId: B, pastDueSince: null }, effects: CHANGED },
  },

  // ─── review round 3: boundaries, live status, our clock, non-terminal statuses ───
  {
    label: 'lapsed free + active stamped exactly one second before the last change (stale)',
    from: FREE_LAPSED,
    event: sub('active', 'pro', { at: at(-1000) }),
    expect: 'ignored',
  },
  {
    label: 'lapsed free + active stamped 999 ms before the last change (same Stripe second)',
    from: FREE_LAPSED,
    event: sub('active', 'pro', { at: at(-999) }),
    expect: { state: { state: 'pro' }, effects: UP },
  },
  {
    label: 'lapsed free + subscription unpaid',
    from: FREE_LAPSED,
    event: sub('unpaid'),
    expect: { state: { lastChangeAt: LATER }, effects: [] },
  },
  {
    label: 'lapsed free + subscription paused',
    from: FREE_LAPSED,
    event: sub('paused'),
    expect: { state: { lastChangeAt: LATER }, effects: [] },
  },
  {
    label: 'free + checkout whose subscription has since been canceled',
    from: FREE,
    event: checkout('pro', B, LATER, { status: 'canceled' }),
    expect: 'ignored',
  },
  {
    label: 'free + checkout whose subscription is incomplete_expired',
    from: FREE,
    event: checkout('agency', B, LATER, { status: 'incomplete_expired' }),
    expect: 'ignored',
  },
  {
    label: 'free + Agency checkout keeps the extras the subscription already carries',
    from: FREE,
    event: checkout('agency', B, LATER, { extras: { seats: 3, sites: 10 } }),
    expect: { state: { state: 'agency', extras: { seats: 3, sites: 10 } }, effects: UP },
  },
  {
    label: 'free + card trial whose subscription has since been canceled',
    from: FREE,
    event: {
      type: 'trial_started',
      at: T,
      variant: 'card_required',
      trialEnd: at(14 * DAY),
      subscriptionId: A,
      subscriptionStatus: 'canceled',
    },
    expect: 'ignored',
  },
  {
    label: 'free + agency trial whose subscription is incomplete_expired',
    from: FREE,
    event: {
      type: 'agency_trial_started',
      at: T,
      trialEnd: at(14 * DAY),
      subscriptionId: A,
      subscriptionStatus: 'incomplete_expired',
    },
    expect: 'ignored',
  },
  {
    label: 'no-card trial + a checkout stamped before the trial started still applies (our clock)',
    from: TRIAL_NC,
    event: checkout('pro', B, at(-2000)),
    expect: {
      state: { state: 'pro', subscriptionId: B, lastChangeAt: at(-2000) },
      effects: ['event:trial.converted', ...CHANGED],
    },
  },
  {
    label: 'no-card trial + its expiry does not move the last change (our clock)',
    from: TRIAL_NC,
    event: { type: 'trial_expired', at: at(14 * DAY) },
    expect: { state: { state: 'free', lastChangeAt: null }, effects: TO_FREE },
  },
  {
    label: 'past_due + the lapse sweep does not move the last change (our clock)',
    from: PAST_DUE_PRO,
    event: { type: 'past_due_lapsed', at: at(7 * DAY) },
    expect: { state: { state: 'free', lastChangeAt: T }, effects: TO_FREE },
  },
  {
    label: 'pro + subscription unpaid keeps following it',
    from: PRO,
    event: sub('unpaid'),
    expect: { state: { state: 'free', subscriptionId: A }, effects: TO_FREE },
  },
  {
    label: 'pro + subscription incomplete_expired follows none',
    from: PRO,
    event: sub('incomplete_expired'),
    expect: { state: { state: 'free', subscriptionId: null }, effects: TO_FREE },
  },
  {
    label: 'pro + subscription canceled follows none',
    from: PRO,
    event: sub('canceled'),
    expect: { state: { state: 'free', subscriptionId: null }, effects: TO_FREE },
  },
  {
    label: 'agency + more sites, same seats',
    from: AGENCY,
    event: sub('active', 'agency', { extras: { seats: 2, sites: 10 } }),
    expect: { state: { extras: { seats: 2, sites: 10 } }, effects: UP },
  },

  // ─── review round 4 ───
  {
    label: 'free + checkout on a trialing subscription grants nothing (trials start as trials)',
    from: FREE_DISPUTED,
    event: checkout('agency', B, LATER, { status: 'trialing', extras: { seats: 0, sites: 25 } }),
    expect: 'ignored',
  },
  {
    label: 'free + card trial whose subscription is already active',
    from: FREE,
    event: {
      type: 'trial_started',
      at: T,
      variant: 'card_required',
      trialEnd: at(14 * DAY),
      subscriptionId: A,
      subscriptionStatus: 'active',
    },
    expect: 'ignored',
  },
  {
    label: 'free + agency trial whose subscription is already active',
    from: FREE,
    event: {
      type: 'agency_trial_started',
      at: T,
      trialEnd: at(14 * DAY),
      subscriptionId: A,
      subscriptionStatus: 'active',
    },
    expect: 'ignored',
  },
  {
    label: 'free + card trial records its start as a Stripe change',
    from: FREE,
    event: {
      type: 'trial_started',
      at: T,
      variant: 'card_required',
      trialEnd: at(14 * DAY),
      subscriptionId: A,
      subscriptionStatus: 'trialing',
    },
    expect: { state: { state: 'pro_trial', lastChangeAt: T }, effects: UP },
  },
  {
    label: 'past_due + a failure stamped before the last change leaves no mark',
    from: PAST_DUE_PRO,
    event: failed(A, at(-DAY)),
    expect: 'ignored',
  },
  {
    label: 'a dispute carrying no subscription still applies',
    from: PRO,
    event: {
      type: 'dispute_created',
      at: LATER,
      subscriptionId: null,
    } as unknown as EntitlementEvent,
    expect: { state: { state: 'free', disputedAt: LATER }, effects: [...TO_FREE, 'founder_alert'] },
  },

  // ─── review round 5 ───
  {
    label: 'card trial + trial_will_end sends the reminder and leaves the last change alone',
    from: TRIAL_CR,
    event: { type: 'trial_will_end', at: at(11 * DAY), subscriptionId: A },
    expect: { state: { state: 'pro_trial', lastChangeAt: T }, effects: ['email:trial_reminder'] },
  },
  {
    label: 'past_due + a failure stamped exactly at the last change leaves no mark',
    from: PAST_DUE_PRO,
    event: failed(A, T),
    expect: 'ignored',
  },
  {
    label: 'free and disputed + a dispute stamped before the last change alerts without a mark',
    from: FREE_DISPUTED,
    event: dispute(at(-DAY)),
    expect: { state: { disputedAt: T, lastChangeAt: T }, effects: ['founder_alert'] },
  },

  // ─── recorded only ───
  ...(
    [
      'customer.subscription.created',
      'invoice.paid',
      'setup_intent.succeeded',
      'charge.refunded',
      'customer.updated',
    ] as const
  ).map(
    (stripeType): Row => ({
      label: `pro + ${stripeType}`,
      from: PRO,
      event: { type: 'recorded_only', at: LATER, stripeType },
      expect: 'ignored',
    }),
  ),
];

describe('next(): the transition table, row by row', () => {
  it('the fixtures above are legal states', () => {
    for (const s of [
      FREE,
      FREE_USED,
      FREE_DISPUTED,
      FREE_LAPSED,
      TRIAL_NC,
      TRIAL_CR,
      PRO,
      AGENCY,
      AGENCY_TRIAL,
      PAST_DUE_PRO,
      PAST_DUE_AGENCY,
    ]) {
      expect(legalityViolations(s), s.state).toEqual([]);
    }
  });

  for (const row of ROWS) {
    it(row.label, () => {
      const result = next(row.from, row.event);
      if (row.expect === 'ignored') {
        expect(result.outcome).toBe('ignored');
        expect(result.state).toBe(row.from);
        expect(result.effects).toEqual([]);
        return;
      }
      expect(result.outcome).toBe('applied');
      expect(result.state).toMatchObject(row.expect.state);
      expect(result.effects.map(effectKey).sort()).toEqual([...row.expect.effects].sort());
      expect(legalityViolations(result.state)).toEqual([]);
    });
  }

  it('TRIAL_DAYS is 14', () => {
    expect(TRIAL_DAYS).toBe(14);
  });
});

describe('stale-grant tolerance', () => {
  it('is one whole Stripe second', () => {
    expect(STALE_GRANT_TOLERANCE_MS).toBe(1000);
  });
});

describe('payments that arrive late behind our own clock still apply', () => {
  it('a payment stamped just before the grace window closed, delivered after the lapse sweep, restores the plan', () => {
    // past_due since T; the sweep lapses the account at T+7d; the active update was created
    // ten minutes earlier but delivered after the sweep.
    const lapsed = next(PAST_DUE_PRO, { type: 'past_due_lapsed', at: at(7 * DAY) }).state;
    const paid = next(lapsed, sub('active', 'pro', { at: at(7 * DAY - 600_000) }));
    expect(paid.outcome).toBe('applied');
    expect(paid.state.state).toBe('pro');
  });

  it('an unpaid subscription that is paid later restores the plan', () => {
    const steps: EntitlementEvent[] = [
      failed(A, at(30 * DAY)),
      sub('unpaid', 'pro', { at: at(51 * DAY) }),
      sub('active', 'pro', { at: at(60 * DAY) }),
    ];
    const end = steps.reduce((s, e) => next(s, e).state, PRO);
    expect(end).toMatchObject({ state: 'pro', subscriptionId: A });
  });
});

describe('a revoke that changes nothing still dates later grants', () => {
  it('past_due, active, past_due delivered as 1, 3, 2 leaves the account past due', () => {
    // Stripe: past_due at day 1, active at day 2, past_due at day 3; delivered out of order.
    const steps: EntitlementEvent[] = [
      sub('past_due', 'pro', { at: at(1 * DAY) }),
      sub('past_due', 'pro', { at: at(3 * DAY) }),
      sub('active', 'pro', { at: at(2 * DAY) }),
    ];
    const end = steps.reduce((s, e) => next(s, e).state, PRO);
    expect(end).toMatchObject({
      state: 'past_due',
      pastDueSince: at(1 * DAY),
      lastChangeAt: at(3 * DAY),
    });
  });
});

describe('an event that only sends an email does not date later grants', () => {
  it('a checkout stamped before a trial_will_end and delivered after it still converts the trial', () => {
    const reminded = next(TRIAL_CR, {
      type: 'trial_will_end',
      at: at(11 * DAY),
      subscriptionId: A,
    }).state;
    const converted = next(reminded, checkout('agency', B, at(10 * DAY)));
    expect(converted.outcome).toBe('applied');
    expect(converted.state).toMatchObject({ state: 'agency', subscriptionId: B });
  });
});

describe('a delayed event for a cancelled subscription', () => {
  it('cannot downgrade a customer who has since re-subscribed', () => {
    // Subscription A is cancelled; the customer re-subscribes as B; A's deleted event arrives late.
    const steps: EntitlementEvent[] = [
      checkout('pro', A, at(1 * DAY)),
      sub('canceled', 'pro', { id: A, at: at(10 * DAY) }),
      checkout('pro', B, at(11 * DAY)),
      sub('active', 'pro', { id: B, at: at(11 * DAY) }),
      deleted(A, at(10 * DAY)),
    ];
    const states = steps.reduce<EntitlementSnapshot[]>(
      (acc, e) => [...acc, next(acc[acc.length - 1]!, e).state],
      [FREE],
    );
    expect(states.map((s) => s.state)).toEqual(['free', 'pro', 'free', 'pro', 'pro', 'pro']);
    const last = states[states.length - 1]!;
    expect(last.subscriptionId).toBe(B);
    expect(effectiveTier(last, at(12 * DAY))).toBe('pro');
  });
});

/**
 * legalityViolations is otherwise only given states the machine produced, which are legal, so a rule
 * dropped from it would go unseen. Each case breaks one rule by hand.
 */
describe('legalityViolations names each broken rule', () => {
  const CASES: [label: string, snapshot: EntitlementSnapshot, message: RegExp][] = [
    ['tier does not match state', { ...PRO, tier: 'free' }, /does not match state/],
    [
      'past_due tier does not match past_due_tier',
      { ...PAST_DUE_PRO, tier: 'agency' },
      /does not match state/,
    ],
    ['trial without an end', { ...TRIAL_NC, trialEndsAt: null }, /trialEndsAt/],
    ['trial end outside a trial', { ...PRO, trialEndsAt: LATER }, /trialEndsAt/],
    ['trial without trialUsedAt', { ...AGENCY_TRIAL, trialUsedAt: null }, /trialUsedAt/],
    ['Pro trial without a variant', { ...TRIAL_NC, trialVariant: null }, /variant/],
    ['past_due without its clock', { ...PAST_DUE_PRO, pastDueSince: null }, /pastDue/],
    ['past_due tier outside past_due', { ...PRO, pastDueTier: 'pro' }, /pastDue/],
    [
      'paid with an undefined subscription',
      { ...PRO, subscriptionId: undefined as unknown as null },
      /follows a subscription/,
    ],
    [
      'an unknown trial variant',
      { ...TRIAL_NC, trialVariant: 'card_requiredX' as unknown as 'no_card' },
      /unknown trial variant/,
    ],
    ['paid without a subscription', { ...PRO, subscriptionId: null }, /follows a subscription/],
    [
      'card trial without a subscription',
      { ...TRIAL_CR, subscriptionId: null },
      /follows a subscription/,
    ],
    [
      'no-card trial with a subscription',
      { ...TRIAL_NC, subscriptionId: A },
      /follows no subscription/,
    ],
    ['extras on Pro', { ...PRO, extras: { seats: 1, sites: 0 } }, /sells no extra/],
    ['more than 25 extra sites', { ...AGENCY, extras: { seats: 0, sites: 26 } }, /extra sites/],
  ];
  for (const [label, snapshot, message] of CASES) {
    it(label, () => {
      expect(legalityViolations(snapshot).join(' | ')).toMatch(message);
    });
  }
});

describe('next() refuses malformed events instead of guessing', () => {
  it('a card-required trial whose end is not after its start', () => {
    expect(() =>
      next(FREE, {
        type: 'trial_started',
        at: T,
        variant: 'card_required',
        trialEnd: T,
        subscriptionId: A,
        subscriptionStatus: 'trialing',
      }),
    ).toThrow(RangeError);
  });

  it('an active Pro subscription carrying extras', () => {
    expect(() => next(PRO, sub('active', 'pro', { extras: { seats: 1, sites: 0 } }))).toThrow(
      RangeError,
    );
  });

  for (const id of [null, undefined, '', 'cus_123']) {
    it(`a subscription event whose id is ${JSON.stringify(id) ?? 'undefined'}, even on an account that follows none`, () => {
      const bad = id as unknown as string;
      const events: EntitlementEvent[] = [
        { type: 'subscription_deleted', at: LATER, subscriptionId: bad },
        {
          ...(sub('canceled') as Extract<EntitlementEvent, { type: 'subscription_updated' }>),
          subscriptionId: bad,
        },
        { type: 'invoice_payment_failed', at: LATER, subscriptionId: bad },
        { type: 'trial_will_end', at: LATER, subscriptionId: bad },
        {
          type: 'trial_started',
          at: LATER,
          variant: 'card_required',
          trialEnd: at(30 * DAY),
          subscriptionId: bad,
          subscriptionStatus: 'trialing',
        },
        {
          type: 'agency_trial_started',
          at: LATER,
          trialEnd: at(30 * DAY),
          subscriptionId: bad,
          subscriptionStatus: 'trialing',
        },
        {
          type: 'checkout_completed',
          at: LATER,
          plan: 'pro',
          subscriptionId: bad,
          subscriptionStatus: 'active',
          extras: { seats: 0, sites: 0 },
        },
      ];
      for (const e of events) expect(() => next(TRIAL_NC, e), e.type).toThrow(RangeError);
    });
  }

  for (const variant of [undefined, 'card_requiredX', 'CARD_REQUIRED']) {
    it(`a trial start with variant ${String(variant)}`, () => {
      const e = {
        type: 'trial_started',
        at: T,
        variant,
        trialEnd: at(29 * DAY),
        subscriptionStatus: 'active',
      } as unknown as EntitlementEvent;
      expect(() => next(FREE, e)).toThrow(RangeError);
    });
  }

  it('a subscription event with no subscriptionId key at all', () => {
    const withoutKey: Record<string, unknown> = { ...checkout('pro') };
    delete withoutKey.subscriptionId;
    expect('subscriptionId' in withoutKey).toBe(false);
    expect(() => next(FREE, withoutKey as unknown as EntitlementEvent)).toThrow(RangeError);
  });

  it('more than 25 extra sites on an active subscription', () => {
    expect(() =>
      next(AGENCY, sub('active', 'agency', { extras: { seats: 0, sites: 26 } })),
    ).toThrow(RangeError);
  });
});
