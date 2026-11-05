/**
 * The cost caps under generated schedules: page counts, browser times, cap sizes, and a budget whose
 * answers arrive late, out of order, or as throws. Kept from the round-3 correctness review, whose fuzz
 * found that a per-page refusal arriving after the last page settled stopped a check with room left;
 * the budget is now asked once per check, and these properties are what that design must hold.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fakeClient, type ReplyFixture } from './fakes.js';
import { renderCheck, RESERVE_PER_RENDER_MS, type RenderOutcome } from './run.js';
import type { DailyBudget, RenderCaps } from './budget.js';

const PAGE = 2 * RESERVE_PER_RENDER_MS;
const RUNS = 1000;

const pages = (use: number[]): ReplyFixture[] =>
  use.map((u, i) => ({
    provenance: 'generated',
    url: `https://site.example/p${i}`,
    static: { html: '<body><main><p>a b</p></main></body>', browser_ms: u / 2 },
    rendered: { html: '<body><main><p>a b c d</p></main></body>', browser_ms: u / 2 },
  }));

const later = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function run(fixtures: ReplyFixture[], caps: RenderCaps, daily: DailyBudget) {
  const check = renderCheck({
    candidates: fixtures.map((f, i) => ({
      url: f.url,
      template_key: `/t${i % 3}`,
      kind: 'content' as const,
      status_code: 200,
      is_html: true,
      pagerank_share: 0.1 + i / 100,
      fetched_under_our_robots: true,
    })),
    openFixTemplates: [],
    maxRenders: 25,
    previousStates: new Map(),
    client: fakeClient(fixtures, { delayMs: 0 }),
    admit: async () => {},
    caps,
    daily,
    sleep: async () => {},
  });
  // A check that hangs never finishes, so the guard can be generous: under a fully parallel run a
  // check of twelve pages took over 4 s, which an earlier 4 s guard reported as a hang. A failing case
  // is not shrunk (endOnFailure), so a real hang fails after one guard, not one per shrink step.
  const outcome = await Promise.race([check, later(15_000).then(() => 'hung' as const)]);
  if (outcome === 'hung') throw new Error('the check did not finish');
  return outcome satisfies RenderOutcome;
}

const use = fc.array(fc.integer({ min: 0, max: PAGE }), { minLength: 1, maxLength: 12 });

describe('the cost caps, under generated schedules', () => {
  it('end every check, answer every page, hold both caps, and ask the budget at most once each way', async () => {
    await fc.assert(
      fc.asyncProperty(
        use,
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        fc.constantFrom('yes', 'yes', 'yes', 'no', 'throw'),
        fc.constantFrom('ok', 'ok', 'ok', 'throw'),
        async (used, checkPages, dayPages, reserveDelay, settleDelay, answer, settles) => {
          const perCheckMs = checkPages * PAGE + 1000;
          const perDayMs = dayPages * PAGE + 1000;
          let day = 0;
          let maxDay = 0;
          let reserves = 0;
          let settled = 0;
          const daily: DailyBudget = {
            async reserve(ms, limitMs) {
              reserves += 1;
              await later(reserveDelay);
              if (answer === 'throw') throw new Error('store down');
              if (answer === 'no' || day + ms > limitMs) return false;
              day += ms;
              maxDay = Math.max(maxDay, day);
              return true;
            },
            async settle(reservedMs, usedMs) {
              settled += 1;
              await later(settleDelay);
              if (settles === 'throw') throw new Error('store down');
              day += usedMs - reservedMs;
            },
          };
          const out = await run(pages(used), { perCheckMs, perDayMs }, daily);
          expect(out.pages).toHaveLength(used.length);
          expect(out.pages.every((p) => p.rendered || typeof p.reason === 'string')).toBe(true);
          expect(out.browser_ms).toBeLessThanOrEqual(perCheckMs);
          expect(maxDay).toBeLessThanOrEqual(perDayMs);
          expect(reserves).toBeLessThanOrEqual(1);
          expect(settled).toBeLessThanOrEqual(reserves);
          if (out.pages.some((p) => p.rendered)) expect(settled).toBe(1);
        },
      ),
      { numRuns: RUNS, endOnFailure: true },
    );
  }, 600_000);

  it('render every page when the binding cap has room for one reservation plus all use, and none when the day lacks the allowance', async () => {
    await fc.assert(
      fc.asyncProperty(
        use,
        fc.boolean(),
        fc.integer({ min: 0, max: 4 }),
        async (used, dayBinds, delay) => {
          const sum = used.reduce((a, b) => a + b, 0);
          const tight = PAGE + sum;
          const allowance = Math.min(dayBinds ? 1e12 : tight, used.length * PAGE);
          let day = 0;
          const daily: DailyBudget = {
            async reserve(ms, limitMs) {
              await later(delay);
              if (day + ms > limitMs) return false;
              day += ms;
              return true;
            },
            async settle(reservedMs, usedMs) {
              await later(delay);
              day += usedMs - reservedMs;
            },
          };
          const caps = dayBinds
            ? { perCheckMs: 1e12, perDayMs: tight }
            : { perCheckMs: tight, perDayMs: 1e12 };
          const out = await run(pages(used), caps, daily);
          const expected = dayBinds && allowance > tight ? 'daily_cap' : 'rendered';
          expect(out.pages.map((p) => (p.rendered ? 'rendered' : p.reason))).toEqual(
            used.map(() => expected),
          );
          expect(day).toBe(expected === 'rendered' ? sum : 0);
        },
      ),
      { numRuns: RUNS, endOnFailure: true },
    );
  }, 600_000);
});
