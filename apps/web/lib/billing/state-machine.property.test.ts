import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { effectiveTier, type Extras } from '../entitlement-v2';
import {
  FREE_START,
  legalityViolations,
  next,
  type EntitlementEvent,
  type EntitlementSnapshot,
  type SubscriptionStatus,
} from './state-machine';
import { planSites, type PlannedSite, type SiteChange } from './state-machine-sites';

/**
 * Properties of the machine over generated event sequences (fast-check). Every sequence starts from
 * the state `handle_new_user` creates, so every snapshot visited is one the product can reach.
 */

const T0 = Date.parse('2026-11-01T00:00:00.000Z');
const DAY = 86_400_000;

const STATUSES: SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
];

const plan = fc.constantFrom('pro' as const, 'agency' as const);
const agencyExtras: fc.Arbitrary<Extras> = fc.record({
  seats: fc.integer({ min: 0, max: 20 }),
  sites: fc.integer({ min: 0, max: 25 }),
});

/** An event shape without its time; the sequence generator assigns increasing times. */
type Draft = (at: Date) => EntitlementEvent;

const subscriptionUpdated = fc
  .tuple(fc.constantFrom(...STATUSES), plan, fc.boolean(), agencyExtras)
  .map(
    ([status, p, cancelAtPeriodEnd, extras]): Draft =>
      (at) => ({
        type: 'subscription_updated',
        at,
        status,
        plan: p,
        cancelAtPeriodEnd,
        extras: p === 'agency' ? extras : { seats: 0, sites: 0 },
      }),
  );

const noCardDrafts: fc.Arbitrary<Draft>[] = [
  fc.constant((at: Date) => ({ type: 'trial_started', at, variant: 'no_card' }) as const),
  fc.constant((at: Date) => ({ type: 'trial_reminder_due', at }) as const),
  fc.constant((at: Date) => ({ type: 'trial_will_end', at }) as const),
  fc.constant((at: Date) => ({ type: 'trial_expired', at }) as const),
  subscriptionUpdated,
  fc.constant((at: Date) => ({ type: 'subscription_deleted', at }) as const),
  fc.constant((at: Date) => ({ type: 'invoice_paid', at }) as const),
  fc.constant((at: Date) => ({ type: 'invoice_payment_failed', at }) as const),
  fc.constant((at: Date) => ({ type: 'dispute_created', at }) as const),
  fc.constant((at: Date) => ({ type: 'past_due_lapsed', at }) as const),
  fc.constant(
    (at: Date) => ({ type: 'recorded_only', at, stripeType: 'charge.refunded' }) as const,
  ),
];

/** The events that put a card behind an account: a paid checkout and the two card trials. */
const cardDrafts: fc.Arbitrary<Draft>[] = [
  plan.map(
    (p): Draft =>
      (at) => ({ type: 'checkout_completed', at, plan: p }),
  ),
  fc.integer({ min: 1, max: 30 * DAY }).map(
    (len): Draft =>
      (at) => ({
        type: 'trial_started',
        at,
        variant: 'card_required',
        trialEnd: new Date(at.getTime() + len),
      }),
  ),
  fc.integer({ min: 1, max: 30 * DAY }).map(
    (len): Draft =>
      (at) => ({
        type: 'agency_trial_started',
        at,
        trialEnd: new Date(at.getTime() + len),
      }),
  ),
];

/** A sequence of events, each 0 to 20 days after the one before. */
function sequence(drafts: fc.Arbitrary<Draft>[], maxLength = 40): fc.Arbitrary<EntitlementEvent[]> {
  return fc
    .array(fc.tuple(fc.oneof(...drafts), fc.integer({ min: 0, max: 20 * DAY })), { maxLength })
    .map((steps) => {
      let t = T0;
      return steps.map(([draft, gap]) => {
        t += gap;
        return draft(new Date(t));
      });
    });
}

const anySequence = sequence([...noCardDrafts, ...cardDrafts]);

/** Every snapshot visited, paired with the event that led to it. */
function run(
  events: EntitlementEvent[],
): { before: EntitlementSnapshot; event: EntitlementEvent; after: EntitlementSnapshot }[] {
  const steps = [];
  let s: EntitlementSnapshot = FREE_START;
  for (const event of events) {
    const after = next(s, event).state;
    steps.push({ before: s, event, after });
    s = after;
  }
  return steps;
}

describe('entitlement state machine properties', () => {
  it('any sequence of events lands in a legal state at every step', () => {
    const reached = new Set<string>();
    fc.assert(
      fc.property(anySequence, (events) => {
        for (const { after } of run(events)) {
          expect(legalityViolations(after)).toEqual([]);
          reached.add(after.state);
        }
      }),
      { numRuns: 500 },
    );
    expect([...reached].sort(), 'the generator did not visit every state').toEqual([
      'agency',
      'agency_trial',
      'free',
      'past_due',
      'pro',
      'pro_trial',
    ]);
  });

  it('without a card, an account never reaches a paid or past-due state', () => {
    let trials = 0;
    fc.assert(
      fc.property(sequence(noCardDrafts), (events) => {
        for (const { after } of run(events)) {
          expect(['free', 'pro_trial']).toContain(after.state);
          if (after.state === 'pro_trial') trials++;
        }
      }),
      { numRuns: 500 },
    );
    expect(trials, 'the generator never reached a trial').toBeGreaterThan(0);
  });

  it('a no-card trial reaches pro only through a paid checkout', () => {
    let leftTrial = 0;
    fc.assert(
      fc.property(anySequence, (events) => {
        for (const { before, event, after } of run(events)) {
          if (before.state !== 'pro_trial' || before.trialVariant !== 'no_card') continue;
          if (after.state !== 'pro_trial') leftTrial++;
          if (after.state === 'pro') expect(event.type).toBe('checkout_completed');
        }
      }),
      { numRuns: 500 },
    );
    expect(leftTrial, 'the generator never moved a no-card trial anywhere').toBeGreaterThan(0);
  });

  it('cancel-at-period-end changes nothing: same transition with the flag on or off, and never a pause', () => {
    let paid = 0;
    fc.assert(
      fc.property(anySequence, subscriptionUpdated, (events, draft) => {
        const steps = run(events);
        const s = steps.length > 0 ? steps[steps.length - 1]!.after : FREE_START;
        const e = draft(new Date(T0 + 400 * DAY));
        if (e.type !== 'subscription_updated') throw new Error('generator');
        const on = next(s, { ...e, cancelAtPeriodEnd: true });
        const off = next(s, { ...e, cancelAtPeriodEnd: false });
        expect(on).toEqual(off);
        // The pure cancellation: a paid account told only that it will cancel later.
        if (s.state === 'pro' || s.state === 'agency') {
          paid++;
          const cancelOnly = next(s, {
            ...e,
            status: 'active',
            plan: s.tier as 'pro' | 'agency',
            extras: s.extras,
            cancelAtPeriodEnd: true,
          });
          expect(cancelOnly.outcome).toBe('ignored');
          expect(cancelOnly.effects.map((x) => x.kind)).not.toContain('pause_others');
        }
      }),
      { numRuns: 500 },
    );
    expect(paid, 'the generator never reached a paid account').toBeGreaterThan(0);
  });

  it('past_due keeps its tier for 7 days from the first failure, then is Free', () => {
    let pastDue = 0;
    let stayed = 0;
    fc.assert(
      fc.property(anySequence, fc.integer({ min: 0, max: 30 * DAY }), (events, offset) => {
        for (const { before, after } of run(events)) {
          if (after.state !== 'past_due') continue;
          // Staying past due never moves the clock.
          pastDue++;
          if (before.state === 'past_due') {
            stayed++;
            expect(after.pastDueSince).toEqual(before.pastDueSince);
          }
          const since = after.pastDueSince!.getTime();
          const when = new Date(since + offset);
          expect(effectiveTier(after, when)).toBe(offset < 7 * DAY ? after.pastDueTier : 'free');
          const lapse = next(after, { type: 'past_due_lapsed', at: when });
          expect(lapse.state.state).toBe(offset < 7 * DAY ? 'past_due' : 'free');
        }
      }),
      { numRuns: 300 },
    );
    expect(pastDue, 'the generator never reached past_due').toBeGreaterThan(0);
    expect(stayed, 'no event ever arrived while already past due').toBeGreaterThan(0);
  });
});

// ─── Site effects ──────────────────────────────────────────────────────────────────────────────────

const site = (i: number, overrides: Partial<PlannedSite> = {}): PlannedSite => ({
  id: `site-${String(i).padStart(2, '0')}`,
  createdAt: new Date(T0 + i * DAY),
  schedule: 'weekly',
  pausedReason: null,
  ...overrides,
});

function applyChanges(sites: PlannedSite[], changes: SiteChange[]): PlannedSite[] {
  const byId = new Map(changes.map((c) => [c.id, c]));
  return sites.map((s) => {
    const c = byId.get(s.id);
    return c ? { ...s, schedule: c.schedule, pausedReason: c.pausedReason } : s;
  });
}

/** 1 to 30 running weekly sites, created on distinct days, in shuffled order. */
const runningSites = fc.integer({ min: 1, max: 30 }).chain((n) =>
  fc.shuffledSubarray(
    Array.from({ length: n }, (_, i) => site(i)),
    { minLength: n, maxLength: n },
  ),
);

describe('site effects of a transition', () => {
  it('pause_others: the first site keeps its monthly check and the others pause, for 1 to 30 sites', () => {
    fc.assert(
      fc.property(runningSites, (sites) => {
        const after = applyChanges(sites, planSites('pause_others', sites, 'free', 1));
        const oldest = [...after].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]!;
        expect(oldest).toMatchObject({ schedule: 'monthly', pausedReason: null });
        for (const s of after.filter((x) => x.id !== oldest.id)) {
          expect(s).toMatchObject({ schedule: null, pausedReason: 'trial_ended' });
        }
      }),
    );
  });

  it('pause_others leaves a site the user paused alone, and still excepts only the oldest (ARCH-2 §3.2)', () => {
    const sites = [site(0, { schedule: null, pausedReason: 'user' }), site(1), site(2)];
    expect(planSites('pause_others', sites, 'free', 1)).toEqual([
      { id: 'site-01', schedule: null, pausedReason: 'trial_ended' },
      { id: 'site-02', schedule: null, pausedReason: 'trial_ended' },
    ]);
  });

  it('resume after pause_others runs the oldest sites up to the new limit', () => {
    fc.assert(
      fc.property(
        runningSites,
        fc.constantFrom(['pro', 5] as const, ['agency', 25] as const),
        (sites, [tier, limit]) => {
          const paused = applyChanges(sites, planSites('pause_others', sites, 'free', 1));
          const resumed = applyChanges(paused, planSites('resume', paused, tier, limit));
          const running = resumed.filter((s) => s.schedule !== null);
          expect(running).toHaveLength(Math.min(sites.length, limit));
          // The first site stays on its monthly check; resume only touches paused sites.
          expect(running.filter((s) => s.schedule === 'monthly')).toHaveLength(1);
        },
      ),
    );
  });

  it('pause_over_limit pauses the newest running sites beyond the limit', () => {
    fc.assert(
      fc.property(runningSites, fc.integer({ min: 1, max: 30 }), (sites, limit) => {
        const after = applyChanges(sites, planSites('pause_over_limit', sites, 'pro', limit));
        const ordered = [...after].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        ordered.forEach((s, i) => {
          if (i < limit) expect(s).toMatchObject({ schedule: 'weekly', pausedReason: null });
          else expect(s).toMatchObject({ schedule: null, pausedReason: 'over_limit' });
        });
      }),
    );
  });
});
