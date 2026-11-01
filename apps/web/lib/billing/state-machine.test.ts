import { describe, expect, it } from 'vitest';
import {
  FREE_START,
  TRIAL_DAYS,
  effectKey,
  legalityViolations,
  next,
  type EntitlementEvent,
  type EntitlementSnapshot,
} from './state-machine';

/**
 * The transition table of ARCH-2 §3.2, typed out by hand: one row per transition, plus the events
 * each state must ignore. Expected states and effects are literals, never computed from the module,
 * so this is independent truth for `next()` (OPERATING-RULES §10). Effects compare as a set.
 */

const T = new Date('2026-11-01T00:00:00.000Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(T.getTime() + ms);
const LATER = at(DAY);

const FREE: EntitlementSnapshot = FREE_START;
const FREE_USED: EntitlementSnapshot = { ...FREE, trialUsedAt: T, trialVariant: 'no_card' };
const FREE_DISPUTED: EntitlementSnapshot = { ...FREE, disputedAt: T };
const TRIAL_NC: EntitlementSnapshot = {
  ...FREE,
  state: 'pro_trial',
  tier: 'pro',
  trialVariant: 'no_card',
  trialEndsAt: at(14 * DAY),
  trialUsedAt: T,
};
const TRIAL_CR: EntitlementSnapshot = { ...TRIAL_NC, trialVariant: 'card_required' };
const PRO: EntitlementSnapshot = { ...FREE, state: 'pro', tier: 'pro' };
const AGENCY: EntitlementSnapshot = { ...FREE, state: 'agency', tier: 'agency', extras: { seats: 2, sites: 3 } };
const AGENCY_TRIAL: EntitlementSnapshot = {
  ...FREE,
  state: 'agency_trial',
  tier: 'agency',
  trialEndsAt: at(14 * DAY),
  trialUsedAt: T,
};
const PAST_DUE_PRO: EntitlementSnapshot = { ...PRO, state: 'past_due', pastDueTier: 'pro', pastDueSince: T };
const PAST_DUE_AGENCY: EntitlementSnapshot = { ...AGENCY, state: 'past_due', pastDueTier: 'agency', pastDueSince: T };

const sub = (
  status: Extract<EntitlementEvent, { type: 'subscription_updated' }>['status'],
  plan: 'pro' | 'agency' = 'pro',
  more: { cancelAtPeriodEnd?: boolean; extras?: { seats: number; sites: number } } = {},
): EntitlementEvent => ({
  type: 'subscription_updated',
  at: LATER,
  status,
  plan,
  cancelAtPeriodEnd: more.cancelAtPeriodEnd ?? false,
  extras: more.extras ?? { seats: 0, sites: 0 },
});

const TO_FREE = ['pause_others', 'relimit', 'event:entitlement.changed'];

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
      state: { state: 'pro_trial', tier: 'pro', trialVariant: 'no_card', trialEndsAt: at(14 * DAY), trialUsedAt: T },
      effects: ['relimit', 'resume', 'event:trial.started', 'event:entitlement.changed'],
    },
  },
  {
    label: 'free + card-required trial starts on Stripe’s clock',
    from: FREE,
    event: { type: 'trial_started', at: T, variant: 'card_required', trialEnd: at(14 * DAY + 5) },
    expect: {
      state: { state: 'pro_trial', trialVariant: 'card_required', trialEndsAt: at(14 * DAY + 5), trialUsedAt: T },
      effects: ['relimit', 'resume', 'event:entitlement.changed'],
    },
  },
  { label: 'free with a used trial + trial starts', from: FREE_USED, event: { type: 'trial_started', at: T, variant: 'no_card' }, expect: 'ignored' },
  { label: 'free and disputed + trial starts', from: FREE_DISPUTED, event: { type: 'trial_started', at: T, variant: 'no_card' }, expect: 'ignored' },
  {
    label: 'free + agency trial starts',
    from: FREE,
    event: { type: 'agency_trial_started', at: T, trialEnd: at(14 * DAY) },
    expect: {
      state: { state: 'agency_trial', tier: 'agency', trialEndsAt: at(14 * DAY), trialUsedAt: T },
      effects: ['relimit', 'resume', 'event:entitlement.changed'],
    },
  },
  {
    label: 'free + Pro checkout',
    from: FREE,
    event: { type: 'checkout_completed', at: LATER, plan: 'pro' },
    expect: { state: { state: 'pro', tier: 'pro' }, effects: ['relimit', 'resume', 'event:entitlement.changed'] },
  },
  {
    label: 'free + Agency checkout',
    from: FREE,
    event: { type: 'checkout_completed', at: LATER, plan: 'agency' },
    expect: { state: { state: 'agency', tier: 'agency' }, effects: ['relimit', 'resume', 'event:entitlement.changed'] },
  },
  { label: 'free + subscription active (only a checkout grants from free)', from: FREE, event: sub('active'), expect: 'ignored' },
  { label: 'free + subscription deleted', from: FREE, event: { type: 'subscription_deleted', at: LATER }, expect: 'ignored' },
  { label: 'free + invoice paid', from: FREE, event: { type: 'invoice_paid', at: LATER }, expect: 'ignored' },
  {
    label: 'free + dispute: marked, so no trial can start',
    from: FREE,
    event: { type: 'dispute_created', at: LATER },
    expect: { state: { state: 'free', disputedAt: LATER }, effects: ['founder_alert'] },
  },

  // ─── pro_trial ───
  {
    label: 'no-card trial + reminder due',
    from: TRIAL_NC,
    event: { type: 'trial_reminder_due', at: at(11 * DAY) },
    expect: { state: { state: 'pro_trial' }, effects: ['email:trial_reminder'] },
  },
  { label: 'card trial + our reminder', from: TRIAL_CR, event: { type: 'trial_reminder_due', at: at(11 * DAY) }, expect: 'ignored' },
  {
    label: 'card trial + Stripe trial_will_end',
    from: TRIAL_CR,
    event: { type: 'trial_will_end', at: at(11 * DAY) },
    expect: { state: { state: 'pro_trial' }, effects: ['email:trial_reminder'] },
  },
  { label: 'no-card trial + Stripe trial_will_end', from: TRIAL_NC, event: { type: 'trial_will_end', at: at(11 * DAY) }, expect: 'ignored' },
  {
    label: 'no-card trial + expired at its end',
    from: TRIAL_NC,
    event: { type: 'trial_expired', at: at(14 * DAY) },
    expect: { state: { state: 'free', tier: 'free', trialEndsAt: null, trialUsedAt: T }, effects: TO_FREE },
  },
  { label: 'no-card trial + expired early', from: TRIAL_NC, event: { type: 'trial_expired', at: at(14 * DAY - 1) }, expect: 'ignored' },
  { label: 'card trial + our expiry', from: TRIAL_CR, event: { type: 'trial_expired', at: at(15 * DAY) }, expect: 'ignored' },
  {
    label: 'card trial + subscription active (day 15 charge)',
    from: TRIAL_CR,
    event: sub('active'),
    expect: { state: { state: 'pro', tier: 'pro', trialEndsAt: null }, effects: ['event:entitlement.changed'] },
  },
  { label: 'no-card trial + subscription active', from: TRIAL_NC, event: sub('active'), expect: 'ignored' },
  { label: 'card trial + subscription still trialing', from: TRIAL_CR, event: sub('trialing'), expect: 'ignored' },
  {
    label: 'card trial + subscription deleted',
    from: TRIAL_CR,
    event: { type: 'subscription_deleted', at: LATER },
    expect: { state: { state: 'free' }, effects: TO_FREE },
  },
  {
    label: 'card trial + subscription incomplete_expired',
    from: TRIAL_CR,
    event: sub('incomplete_expired'),
    expect: { state: { state: 'free' }, effects: TO_FREE },
  },
  { label: 'no-card trial + subscription deleted', from: TRIAL_NC, event: { type: 'subscription_deleted', at: LATER }, expect: 'ignored' },
  {
    label: 'no-card trial + Pro checkout',
    from: TRIAL_NC,
    event: { type: 'checkout_completed', at: LATER, plan: 'pro' },
    expect: {
      state: { state: 'pro', tier: 'pro', trialEndsAt: null },
      effects: ['event:trial.converted', 'event:entitlement.changed'],
    },
  },
  {
    label: 'no-card trial + Agency checkout',
    from: TRIAL_NC,
    event: { type: 'checkout_completed', at: LATER, plan: 'agency' },
    expect: {
      state: { state: 'agency', tier: 'agency', trialEndsAt: null },
      effects: ['relimit', 'resume', 'event:trial.converted', 'event:entitlement.changed'],
    },
  },
  {
    label: 'card trial + payment failed',
    from: TRIAL_CR,
    event: { type: 'invoice_payment_failed', at: LATER },
    expect: {
      state: { state: 'past_due', tier: 'pro', pastDueTier: 'pro', pastDueSince: LATER, trialEndsAt: null },
      effects: ['event:entitlement.changed'],
    },
  },
  { label: 'no-card trial + subscription past_due', from: TRIAL_NC, event: sub('past_due'), expect: 'ignored' },
  { label: 'no-card trial + payment failed', from: TRIAL_NC, event: { type: 'invoice_payment_failed', at: LATER }, expect: 'ignored' },

  // ─── pro ───
  {
    label: 'pro + Portal upgrade to Agency',
    from: PRO,
    event: sub('active', 'agency'),
    expect: { state: { state: 'agency', tier: 'agency' }, effects: ['relimit', 'resume', 'event:entitlement.changed'] },
  },
  { label: 'pro + cancel at period end', from: PRO, event: sub('active', 'pro', { cancelAtPeriodEnd: true }), expect: 'ignored' },
  { label: 'pro + renewal with nothing changed', from: PRO, event: sub('active'), expect: 'ignored' },
  {
    label: 'pro + subscription past_due',
    from: PRO,
    event: sub('past_due'),
    expect: { state: { state: 'past_due', tier: 'pro', pastDueTier: 'pro', pastDueSince: LATER }, effects: ['event:entitlement.changed'] },
  },
  {
    label: 'pro + payment failed',
    from: PRO,
    event: { type: 'invoice_payment_failed', at: LATER },
    expect: { state: { state: 'past_due', pastDueTier: 'pro', pastDueSince: LATER }, effects: ['event:entitlement.changed'] },
  },
  { label: 'pro + subscription deleted', from: PRO, event: { type: 'subscription_deleted', at: LATER }, expect: { state: { state: 'free' }, effects: TO_FREE } },
  { label: 'pro + subscription canceled', from: PRO, event: sub('canceled'), expect: { state: { state: 'free' }, effects: TO_FREE } },
  {
    label: 'pro + dispute',
    from: PRO,
    event: { type: 'dispute_created', at: LATER },
    expect: { state: { state: 'free', disputedAt: LATER }, effects: [...TO_FREE, 'founder_alert'] },
  },
  {
    label: 'pro + Agency checkout',
    from: PRO,
    event: { type: 'checkout_completed', at: LATER, plan: 'agency' },
    expect: { state: { state: 'agency' }, effects: ['relimit', 'resume', 'event:entitlement.changed'] },
  },
  { label: 'pro + Pro checkout', from: PRO, event: { type: 'checkout_completed', at: LATER, plan: 'pro' }, expect: 'ignored' },
  { label: 'pro + invoice paid (renewal)', from: PRO, event: { type: 'invoice_paid', at: LATER }, expect: 'ignored' },

  // ─── agency ───
  {
    label: 'agency + downgrade to Pro',
    from: AGENCY,
    event: sub('active', 'pro'),
    expect: {
      state: { state: 'pro', tier: 'pro', extras: { seats: 0, sites: 0 } },
      effects: ['relimit', 'pause_over_limit', 'event:entitlement.changed'],
    },
  },
  {
    label: 'agency + more extras',
    from: AGENCY,
    event: sub('active', 'agency', { extras: { seats: 4, sites: 25 } }),
    expect: { state: { state: 'agency', extras: { seats: 4, sites: 25 } }, effects: ['relimit', 'resume', 'event:entitlement.changed'] },
  },
  {
    label: 'agency + fewer extras',
    from: AGENCY,
    event: sub('active', 'agency'),
    expect: {
      state: { state: 'agency', extras: { seats: 0, sites: 0 } },
      effects: ['relimit', 'pause_over_limit', 'event:entitlement.changed'],
    },
  },
  {
    label: 'agency + fewer seats, same sites',
    from: AGENCY,
    event: sub('active', 'agency', { extras: { seats: 0, sites: 3 } }),
    expect: { state: { extras: { seats: 0, sites: 3 } }, effects: ['relimit', 'event:entitlement.changed'] },
  },
  { label: 'agency + same extras', from: AGENCY, event: sub('active', 'agency', { extras: { seats: 2, sites: 3 } }), expect: 'ignored' },
  {
    label: 'agency + cancel at period end',
    from: AGENCY,
    event: sub('active', 'agency', { cancelAtPeriodEnd: true, extras: { seats: 2, sites: 3 } }),
    expect: 'ignored',
  },
  {
    label: 'agency + payment failed keeps the extras',
    from: AGENCY,
    event: { type: 'invoice_payment_failed', at: LATER },
    expect: {
      state: { state: 'past_due', tier: 'agency', pastDueTier: 'agency', extras: { seats: 2, sites: 3 } },
      effects: ['event:entitlement.changed'],
    },
  },
  {
    label: 'agency + subscription deleted',
    from: AGENCY,
    event: { type: 'subscription_deleted', at: LATER },
    expect: { state: { state: 'free', extras: { seats: 0, sites: 0 } }, effects: TO_FREE },
  },
  { label: 'agency + Pro checkout', from: AGENCY, event: { type: 'checkout_completed', at: LATER, plan: 'pro' }, expect: 'ignored' },

  // ─── agency_trial ───
  {
    label: 'agency trial + subscription active (day 15 charge)',
    from: AGENCY_TRIAL,
    event: sub('active', 'agency'),
    expect: { state: { state: 'agency', trialEndsAt: null }, effects: ['event:entitlement.changed'] },
  },
  {
    label: 'agency trial + Stripe trial_will_end',
    from: AGENCY_TRIAL,
    event: { type: 'trial_will_end', at: at(11 * DAY) },
    expect: { state: { state: 'agency_trial' }, effects: ['email:trial_reminder'] },
  },
  {
    label: 'agency trial + subscription deleted',
    from: AGENCY_TRIAL,
    event: { type: 'subscription_deleted', at: LATER },
    expect: { state: { state: 'free', trialEndsAt: null }, effects: TO_FREE },
  },
  { label: 'agency trial + subscription canceled', from: AGENCY_TRIAL, event: sub('canceled', 'agency'), expect: { state: { state: 'free' }, effects: TO_FREE } },
  {
    label: 'agency trial + subscription past_due (J3)',
    from: AGENCY_TRIAL,
    event: sub('past_due', 'agency'),
    expect: { state: { state: 'past_due', pastDueTier: 'agency', pastDueSince: LATER, trialEndsAt: null }, effects: ['event:entitlement.changed'] },
  },
  {
    label: 'agency trial + payment failed (J3)',
    from: AGENCY_TRIAL,
    event: { type: 'invoice_payment_failed', at: LATER },
    expect: { state: { state: 'past_due', pastDueTier: 'agency' }, effects: ['event:entitlement.changed'] },
  },
  { label: 'agency trial + our expiry', from: AGENCY_TRIAL, event: { type: 'trial_expired', at: at(20 * DAY) }, expect: 'ignored' },
  { label: 'agency trial + checkout', from: AGENCY_TRIAL, event: { type: 'checkout_completed', at: LATER, plan: 'agency' }, expect: 'ignored' },

  // ─── past_due ───
  {
    label: 'past_due + invoice paid',
    from: PAST_DUE_PRO,
    event: { type: 'invoice_paid', at: LATER },
    expect: { state: { state: 'pro', tier: 'pro', pastDueTier: null, pastDueSince: null }, effects: ['event:entitlement.changed'] },
  },
  {
    label: 'past_due + subscription active',
    from: PAST_DUE_AGENCY,
    event: sub('active', 'agency', { extras: { seats: 2, sites: 3 } }),
    expect: { state: { state: 'agency', pastDueSince: null }, effects: ['event:entitlement.changed'] },
  },
  { label: 'past_due + another failure does not restart the clock', from: PAST_DUE_PRO, event: { type: 'invoice_payment_failed', at: LATER }, expect: 'ignored' },
  { label: 'past_due + subscription past_due again', from: PAST_DUE_PRO, event: sub('past_due'), expect: 'ignored' },
  {
    label: 'past_due + lapsed at 7 days',
    from: PAST_DUE_PRO,
    event: { type: 'past_due_lapsed', at: at(7 * DAY) },
    expect: { state: { state: 'free', tier: 'free', pastDueTier: null, pastDueSince: null }, effects: TO_FREE },
  },
  { label: 'past_due + lapsed 1 ms early', from: PAST_DUE_PRO, event: { type: 'past_due_lapsed', at: at(7 * DAY - 1) }, expect: 'ignored' },
  { label: 'past_due + subscription deleted', from: PAST_DUE_PRO, event: { type: 'subscription_deleted', at: LATER }, expect: { state: { state: 'free' }, effects: TO_FREE } },
  { label: 'past_due + subscription unpaid', from: PAST_DUE_PRO, event: sub('unpaid'), expect: { state: { state: 'free' }, effects: TO_FREE } },
  {
    label: 'past_due + dispute',
    from: PAST_DUE_AGENCY,
    event: { type: 'dispute_created', at: LATER },
    expect: { state: { state: 'free', disputedAt: LATER, extras: { seats: 0, sites: 0 } }, effects: [...TO_FREE, 'founder_alert'] },
  },
  { label: 'pro + lapse sweep (not past_due)', from: PRO, event: { type: 'past_due_lapsed', at: at(30 * DAY) }, expect: 'ignored' },

  // ─── recorded only ───
  ...(['customer.subscription.created', 'setup_intent.succeeded', 'charge.refunded', 'customer.updated'] as const).map(
    (stripeType): Row => ({ label: `pro + ${stripeType}`, from: PRO, event: { type: 'recorded_only', at: LATER, stripeType }, expect: 'ignored' }),
  ),
];

describe('next(): the ARCH-2 §3.2 transition table, row by row', () => {
  it('the fixtures above are legal states', () => {
    for (const s of [FREE, FREE_USED, FREE_DISPUTED, TRIAL_NC, TRIAL_CR, PRO, AGENCY, AGENCY_TRIAL, PAST_DUE_PRO, PAST_DUE_AGENCY]) {
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

describe('next() refuses malformed events instead of guessing', () => {
  it('a card-required trial whose end is not after its start', () => {
    expect(() => next(FREE, { type: 'trial_started', at: T, variant: 'card_required', trialEnd: T })).toThrow(RangeError);
  });

  it('extras on a Pro subscription', () => {
    expect(() => next(PRO, sub('active', 'pro', { extras: { seats: 1, sites: 0 } }))).toThrow(RangeError);
  });

  it('more than 25 extra sites', () => {
    expect(() => next(AGENCY, sub('active', 'agency', { extras: { seats: 0, sites: 26 } }))).toThrow(RangeError);
  });
});
