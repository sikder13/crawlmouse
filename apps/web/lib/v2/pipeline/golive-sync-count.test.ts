import { afterEach, describe, expect, it, vi } from 'vitest';
import { FUNCTIONS, registered, type Flag } from '../../../../../scripts/golive/budget';
import {
  functionCountsByStep,
  syncedFunctionCount,
} from '../../../../../scripts/golive/inngest-sync';
import { STEPS, flagsAfter } from '../../../../../scripts/golive/steps';

// CC-35: the go-live checklist tells the owner how many functions Inngest must list after each step
// (scripts/golive/inngest-sync.ts, from budget.ts's hand-kept FUNCTIONS table). This holds that number
// to what the serve route registers with those flags: each function's synced configs, failure
// handlers included, as Inngest receives them on a sync.

// The billing functions load modules that import 'server-only', which throws outside Next.
vi.mock('server-only', () => ({}));

type Config = { id: string };
const configsOf = (fns: readonly unknown[]): Config[] =>
  fns.flatMap((fn) =>
    (fn as { getConfig(o: { baseUrl: URL; appPrefix: string }): Config[] }).getConfig({
      baseUrl: new URL('https://crawlmouse.com/api/webhooks/inngest'),
      appPrefix: 'crawlmouse',
    }),
  );

const FLAGS = ['V2_PIPELINE', 'V2_ACCOUNT_DOOR', 'V2_CHECKS_PUBLIC', 'V2_BILLING'] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("golive:check's Inngest functions per step", () => {
  it.each(STEPS)(
    'equals what the serve route syncs with the flags set once step %i is done',
    async (step) => {
      const on = new Set<string>(flagsAfter(step));
      for (const flag of FLAGS) vi.stubEnv(flag, on.has(flag) ? '1' : '');
      vi.resetModules();
      const { inngestFunctions } = await import('./functions');
      const synced = configsOf(inngestFunctions(process.env)).map((c) => c.id);
      // The same functions, by id, not only as many: a failure handler syncs as `<id>-failure`.
      const expected = FUNCTIONS.filter((f) =>
        registered(f, new Set<Flag>(flagsAfter(step))),
      ).flatMap((f) =>
        f.onFailure ? [`crawlmouse-${f.id}`, `crawlmouse-${f.id}-failure`] : [`crawlmouse-${f.id}`],
      );
      expect([...synced].sort()).toEqual([...expected].sort());
      expect(synced.length).toBe(syncedFunctionCount(step));
    },
    // Each case imports the serve route's whole function graph afresh; under load that took over 5 s.
    30_000,
  );
});

// CC-GL D2 put the removed-site purge in the expiry's run as a step, not a function of its own. The
// case above holds the serve route to budget.ts's table; this holds the table to the counts the
// owner's checklist printed before that change, so a purge registered as a new function (in the
// route and the table together) fails here.
// The functions added since are the trial clock, row 23's sentinel tick and watch, and row 18's
// competitor audits, all at step 4 (both flags they need are on from there), and row 17's full
// render and its failure handler, from step 2 (V2_PIPELINE).
describe('the function counts per step, as before CC-GL D2', () => {
  it('are unchanged but for the functions added since', () => {
    expect(functionCountsByStep()).toBe(
      'after step 1: 5; after step 2: 14; after step 3: 14; after step 4: 40; after step 5: 42',
    );
  });
});
