import { afterEach, describe, expect, it, vi } from 'vitest';
import { FUNCTIONS, registered, type Flag } from '../../../../../scripts/golive/budget';
import { syncedFunctionCount } from '../../../../../scripts/golive/inngest-sync';
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
