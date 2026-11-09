import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// Vitest does not read tsconfig `paths`, through which Next resolves the worker package: map each
// alias to the file it names, so the route and this test share one instance of each module.
vi.mock('@crawlmouse/inngest', () => import('../../../../inngest/client'));
vi.mock('@crawlmouse/inngest/audit', () => import('../../../../inngest/audit'));
vi.mock('@crawlmouse/inngest/billing', () => import('../../../../inngest/billing'));

// The serve route hands its list to `serve`; capture it rather than serve anything.
const served = vi.hoisted(() => ({ functions: null as unknown[] | null }));
vi.mock('inngest/next', () => ({
  serve: (opts: { functions: unknown[] }) => {
    served.functions = opts.functions;
    return { GET: () => {}, POST: () => {}, PUT: () => {} };
  },
}));

// Records the service-role clients made, to show when the clock's dependencies are built.
const clients = vi.hoisted(() => ({ made: [] as unknown[][] }));
vi.mock('@supabase/supabase-js', async (original) => {
  const actual = await original<typeof import('@supabase/supabase-js')>();
  return {
    ...actual,
    createClient: (...args: Parameters<typeof actual.createClient>) => {
      clients.made.push(args);
      return actual.createClient(...args);
    },
  };
});

type Config = {
  id: string;
  triggers: unknown[];
  concurrency?: { limit: number };
  idempotency?: string;
  cancel?: unknown[];
};
const configsOf = (fns: readonly unknown[]): Config[] =>
  fns.flatMap((fn) =>
    (fn as { getConfig(o: { baseUrl: URL; appPrefix: string }): Config[] }).getConfig({
      baseUrl: new URL('https://crawlmouse.com/api/webhooks/inngest'),
      appPrefix: 'crawlmouse',
    }),
  );

afterEach(() => {
  vi.unstubAllEnvs();
  served.functions = null;
  clients.made = [];
});

describe('billingFunctions (CC-03 D9)', () => {
  it('is empty unless V2_BILLING is 1', async () => {
    const { billingFunctions } = await import('./inngest-functions');
    for (const env of [{}, { V2_BILLING: '0' }, { V2_BILLING: 'true' }, { V2_BILLING: '' }]) {
      expect(billingFunctions(env)).toEqual([]);
    }
  });

  it('with V2_BILLING=1 holds trialLifecycleFn and pastDueSweepFn, as configured', async () => {
    const { billingFunctions } = await import('./inngest-functions');
    expect(configsOf(billingFunctions({ V2_BILLING: '1' }))).toEqual([
      expect.objectContaining({
        id: 'crawlmouse-crawlmouse.trial.lifecycle',
        triggers: [{ event: 'trial.started' }],
        idempotency: 'event.data.accountId',
        cancel: [{ event: 'trial.converted', if: 'event.data.accountId == async.data.accountId' }],
        concurrency: { limit: 2 },
      }),
      expect.objectContaining({
        id: 'crawlmouse-crawlmouse.billing.past-due-sweep',
        triggers: [{ cron: '0 * * * *' }],
        concurrency: { limit: 1 },
      }),
    ]);
  });

  it('every concurrency limit it declares is within the Inngest plan cap of 5', async () => {
    const { billingFunctions } = await import('./inngest-functions');
    const configs = configsOf(billingFunctions({ V2_BILLING: '1' }));
    expect(configs.map((c) => c.concurrency?.limit)).toEqual([2, 1]);
    for (const c of configs) expect(c.concurrency!.limit).toBeLessThanOrEqual(5);
  });

  it('builds the clock’s client when a step runs, not when the list is made', async () => {
    const { billingFunctions } = await import('./inngest-functions');
    const [, sweep] = billingFunctions({
      V2_BILLING: '1',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-placeholder',
    });
    expect(clients.made).toEqual([]);
    // Run the sweep's first step, then stop.
    const stop = new Error('stop after the first step');
    const step = {
      run: async (id: string, fn: () => unknown) => {
        if (id !== 'now') throw stop;
        return fn();
      },
    };
    await expect(
      (sweep as unknown as { fn: (ctx: unknown) => Promise<unknown> }).fn({ step }),
    ).rejects.toBe(stop);
    expect(clients.made).toEqual([
      [
        'https://project.supabase.co',
        'service-role-placeholder',
        { auth: { persistSession: false } },
      ],
    ]);
  });
});

describe('the Inngest serve route’s function list', () => {
  async function routeList(flag: string | undefined) {
    vi.stubEnv('V2_BILLING', flag);
    vi.resetModules();
    await import('../../app/api/webhooks/inngest/route');
    // Through the aliases the route imports: resetModules keeps a mocked module's first instance.
    const { auditFn } = await import('@crawlmouse/inngest/audit');
    const billing = await import('@crawlmouse/inngest/billing');
    return {
      functions: served.functions!,
      v1: [
        auditFn,
        billing.reconcileBillingFn,
        billing.reconcileBillingManualFn,
        billing.cleanupExpiredAuditsFn,
      ],
    };
  }

  it('with V2_BILLING unset is v1’s four functions, the same objects, in today’s order', async () => {
    const { functions, v1 } = await routeList(undefined);
    expect(functions).toHaveLength(4);
    v1.forEach((fn, i) => expect(functions[i]).toBe(fn));
  });

  it('with V2_BILLING=1 is v1’s four, unchanged and first, then the two billing functions', async () => {
    const { functions, v1 } = await routeList('1');
    expect(functions).toHaveLength(6);
    v1.forEach((fn, i) => expect(functions[i]).toBe(fn));
    expect(configsOf(functions.slice(4)).map((c) => c.id)).toEqual([
      'crawlmouse-crawlmouse.trial.lifecycle',
      'crawlmouse-crawlmouse.billing.past-due-sweep',
    ]);
  });
});
