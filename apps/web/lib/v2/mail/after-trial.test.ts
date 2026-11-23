/**
 * The reminder's sentence on what stays, in the four shapes the CTO approved (2026-11-22), and against
 * `planSites`, the rule the database's own test holds to: the sentence cannot say a site stays or
 * pauses that the move to Free treats otherwise.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planSites, type PausedReason } from '../../billing/state-machine-sites';
import { afterTrial, afterTrialSentence, type TrialSite } from './after-trial';

let n = 0;
const site = (over: Partial<TrialSite> = {}): TrialSite => {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    host: `s${n}.example.com`,
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, n)),
    pausedReason: null,
    stagingOfSiteId: null,
    ...over,
  };
};
const say = (sites: TrialSite[]) => afterTrialSentence(afterTrial(sites));
const KEEPS = 'example.com stays, with a monthly check and three fixes per audit.';
const oldest = (over: Partial<TrialSite> = {}) =>
  site({ host: 'example.com', createdAt: new Date('2026-01-01T00:00:00Z'), ...over });

describe('the four approved shapes', () => {
  it('a. several sites', () => {
    expect(say([site(), site(), oldest(), site(), site(), site()])).toBe(
      `${KEEPS} Your other 5 sites pause, with their history kept.`,
    );
  });

  it('b. one site', () => {
    expect(say([oldest()])).toBe(KEEPS);
  });

  it('c. the oldest site paused by the person', () => {
    expect(say([oldest({ pausedReason: 'user' }), site(), site()])).toBe(
      'example.com stays paused, as you left it, so no site keeps a scheduled check. Your other 2 sites pause, with their history kept.',
    );
  });

  it('d. no sites', () => {
    expect(say([])).toBe(
      'This account has no sites yet. Free covers one site, with a monthly check and three fixes per audit.',
    );
  });
});

describe('the counts', () => {
  it('a site the person already paused is not said to pause', () => {
    expect(say([oldest(), site(), site({ pausedReason: 'user' })])).toBe(
      `${KEEPS} Your other site pauses, with its history kept.`,
    );
  });

  it('names a staging copy beside the other sites', () => {
    const a = oldest();
    expect(say([a, site(), site({ stagingOfSiteId: a.id })])).toBe(
      `${KEEPS} Your other site and 1 staging copy pause, with their history kept.`,
    );
  });

  it('names a staging copy alone, and leaves out one already paused', () => {
    const a = oldest();
    expect(say([a, site({ stagingOfSiteId: a.id })])).toBe(
      `${KEEPS} Your staging copy pauses, with its history kept.`,
    );
    expect(say([a, site({ stagingOfSiteId: a.id, pausedReason: 'user' })])).toBe(KEEPS);
  });
});

describe('the seats the move to Free removes', () => {
  it('says nothing with no other seat', () => {
    expect(afterTrialSentence(afterTrial([oldest()], 0))).toBe(KEEPS);
  });

  it('names one person, and several', () => {
    expect(afterTrialSentence(afterTrial([oldest()], 1))).toBe(
      `${KEEPS} The 1 other person with a seat on this account loses access.`,
    );
    expect(afterTrialSentence(afterTrial([], 2))).toContain(
      'The 2 other people with seats on this account lose access.',
    );
  });
});

describe('against the rule the database applies', () => {
  const reasons: (PausedReason | null)[] = [null, null, 'user', 'over_limit'];

  it('names the site planSites keeps, and counts the running sites it pauses', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ minute: fc.nat(5), reason: fc.constantFrom(...reasons) }), {
          minLength: 1,
          maxLength: 8,
        }),
        (rows) => {
          const sites = rows.map((r, i) =>
            site({
              id: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`,
              host: `h${i}.example.com`,
              createdAt: new Date(Date.UTC(2026, 0, 1, 0, r.minute)),
              pausedReason: r.reason,
            }),
          );
          const planned = sites.map((s) => ({
            id: s.id,
            createdAt: s.createdAt,
            schedule: s.pausedReason === null ? ('weekly' as const) : null,
            pausedReason: s.pausedReason as PausedReason | null,
          }));
          const changes = new Map(
            planSites('pause_others', planned, 'free', 1).map((c) => [c.id, c]),
          );
          const after = afterTrial(sites);
          const keeper = sites.find((s) => s.host === after.kept!.host)!;
          // The kept site is never paused by the move; a site its owner paused is left alone.
          const change = changes.get(keeper.id);
          expect(change ? change.pausedReason : keeper.pausedReason).toBe(
            after.kept!.paused ? 'user' : null,
          );
          const newlyPaused = sites.filter(
            (s) => s.pausedReason === null && changes.get(s.id)?.pausedReason === 'trial_ended',
          );
          expect(after.othersPausing).toBe(newlyPaused.length);
        },
      ),
    );
  });
});
