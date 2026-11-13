import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe("golive:check's Inngest function count per step", () => {
  it.each(STEPS)(
    'equals what the serve route syncs with the flags set once step %i is done',
    async (step) => {
      const on = new Set<string>(flagsAfter(step));
      for (const flag of FLAGS) vi.stubEnv(flag, on.has(flag) ? '1' : '');
      vi.resetModules();
      const { inngestFunctions } = await import('./functions');
      expect(configsOf(inngestFunctions(process.env)).length).toBe(syncedFunctionCount(step));
    },
  );
});
