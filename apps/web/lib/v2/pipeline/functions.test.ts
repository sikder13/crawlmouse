import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { NonRetriableError } from 'inngest';
import { GRADE_VERSION, safeFetch } from '@crawlmouse/engine/v2/pipeline';
import { auditFn } from '../../../../../inngest/audit';
import {
  cleanupExpiredAuditsFn,
  reconcileBillingFn,
  reconcileBillingManualFn,
} from '../../../../../inngest/billing';
import { CHECK_CANCELLED_FN_ID, CHECK_FN_ID, type RunSoFar } from '../../../../../inngest/check';
import { CHECK_EXPIRY_FN_ID } from '../../../../../inngest/check-expiry';
import { CHECK_REAPER_FN_ID } from '../../../../../inngest/check-reaper';
import { inngest } from '../../../../../inngest/client';
import type { CheckRequested } from '../../../../../inngest/check-events';
import { PLAN_CONCURRENCY_CAP } from '../../../../../inngest/concurrency';
import { SCHEDULE_TICK_FN_ID } from '../../../../../inngest/schedule';
import { recordedInput } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { workerClientFromEnv } from '../../worker-client/client';
import { CRAWL_USER_AGENT } from './discover';
import { getJson } from './evidence';
import type { ExpireDeps } from './expire';
import {
  checkStepsFromEnv,
  inngestFunctions,
  stepDeps,
  type StepStores,
  type Wiring,
} from './functions';
import type { KeepStore } from './keep-store';
import { homepageOf } from './request';
import { NO_DAILY_BUDGET } from './steps';
import type { PipelineStore } from './store';
import { memoryStore, queuedCheck } from './test-support/fakes';
import { memoryEvidenceStore } from './test-support/memory-evidence';

// The billing functions (CC-03) load modules that import 'server-only', which throws outside Next.
vi.mock('server-only', () => ({}));

const unused = (what: string) => (): never => {
  throw new Error(`${what} is not called in this test`);
};
/** A wiring whose members throw: a test replaces the ones it reaches. */
const UNUSED_WIRING: Wiring = {
  store: unused('wiring.store'),
  stores: unused('wiring.stores'),
  expiry: unused('wiring.expiry'),
};

type Config = { id: string; concurrency?: number | { limit: number } | { limit: number }[] };
const configsOf = (fns: readonly unknown[]): Config[] =>
  fns.flatMap((fn) =>
    (fn as { getConfig(o: { baseUrl: URL; appPrefix: string }): Config[] }).getConfig({
      baseUrl: new URL('https://crawlmouse.com/api/webhooks/inngest'),
      appPrefix: 'crawlmouse',
    }),
  );

/**
 * v1's four functions as Inngest syncs them, with INNGEST_AUDIT_CONCURRENCY unset: recorded from
 * the contracts commit (ecee3c9c, before CC-20b's changes) and equal at this branch's head.
 */
const V1_CONFIGS = [
  [
    {
      id: 'crawlmouse-crawlmouse.audit',
      name: 'crawlmouse.audit',
      triggers: [
        {
          event: 'audit.requested',
        },
      ],
      steps: {
        step: {
          id: 'step',
          name: 'step',
          runtime: {
            type: 'http',
            url: 'https://crawlmouse.com/api/webhooks/inngest?fnId=crawlmouse-crawlmouse.audit&stepId=step',
          },
          retries: {
            attempts: 1,
          },
        },
      },
      concurrency: {
        limit: 5,
      },
      cancel: [
        {
          event: 'audit.cancel.requested',
          if: 'event.data.auditId == async.data.auditId',
        },
      ],
    },
    {
      id: 'crawlmouse-crawlmouse.audit-failure',
      name: 'crawlmouse.audit (failure)',
      triggers: [
        {
          event: 'inngest/function.failed',
          expression: "event.data.function_id == 'crawlmouse-crawlmouse.audit'",
        },
      ],
      steps: {
        step: {
          id: 'step',
          name: 'step',
          runtime: {
            type: 'http',
            url: 'https://crawlmouse.com/api/webhooks/inngest?fnId=crawlmouse-crawlmouse.audit-failure&stepId=step',
          },
          retries: {
            attempts: 1,
          },
        },
      },
    },
  ],
  [
    {
      id: 'crawlmouse-crawlmouse.stripe-reconcile',
      name: 'crawlmouse.stripe-reconcile',
      triggers: [
        {
          cron: '0 3 * * *',
        },
      ],
      steps: {
        step: {
          id: 'step',
          name: 'step',
          runtime: {
            type: 'http',
            url: 'https://crawlmouse.com/api/webhooks/inngest?fnId=crawlmouse-crawlmouse.stripe-reconcile&stepId=step',
          },
        },
      },
    },
  ],
  [
    {
      id: 'crawlmouse-crawlmouse.stripe-reconcile-manual',
      name: 'crawlmouse.stripe-reconcile-manual',
      triggers: [
        {
          event: 'billing.reconcile.requested',
        },
      ],
      steps: {
        step: {
          id: 'step',
          name: 'step',
          runtime: {
            type: 'http',
            url: 'https://crawlmouse.com/api/webhooks/inngest?fnId=crawlmouse-crawlmouse.stripe-reconcile-manual&stepId=step',
          },
        },
      },
    },
  ],
  [
    {
      id: 'crawlmouse-crawlmouse.audits-ttl-cleanup',
      name: 'crawlmouse.audits-ttl-cleanup',
      triggers: [
        {
          cron: '0 4 * * *',
        },
      ],
      steps: {
        step: {
          id: 'step',
          name: 'step',
          runtime: {
            type: 'http',
            url: 'https://crawlmouse.com/api/webhooks/inngest?fnId=crawlmouse-crawlmouse.audits-ttl-cleanup&stepId=step',
          },
        },
      },
    },
  ],
];

describe('registration with V2_PIPELINE unset (D3)', () => {
  it('is v1’s four functions, the same objects, in today’s order', () => {
    for (const env of [{}, { V2_PIPELINE: '0' }, { V2_PIPELINE: 'true' }, { V2_PIPELINE: '' }]) {
      const fns = inngestFunctions(env);
      expect(fns).toHaveLength(4);
      expect(fns[0]).toBe(auditFn);
      expect(fns[1]).toBe(reconcileBillingFn);
      expect(fns[2]).toBe(reconcileBillingManualFn);
      expect(fns[3]).toBe(cleanupExpiredAuditsFn);
    }
  });

  it('syncs the configs it synced before this change', async () => {
    // auditFn reads the variable when its module loads: load it afresh with the variable unset.
    vi.stubEnv('INNGEST_AUDIT_CONCURRENCY', undefined);
    vi.resetModules();
    const fresh = await import('./functions');
    vi.unstubAllEnvs();
    expect(
      JSON.parse(
        JSON.stringify(
          fresh.inngestFunctions({}).map((fn) =>
            (fn as unknown as { getConfig(o: unknown): unknown }).getConfig({
              baseUrl: new URL('https://crawlmouse.com/api/webhooks/inngest'),
              appPrefix: 'crawlmouse',
            }),
          ),
        ),
      ),
    ).toEqual(V1_CONFIGS);
  });

  it('is what the serve route registers', () => {
    const route = readFileSync(
      fileURLToPath(new URL('../../../app/api/webhooks/inngest/route.ts', import.meta.url)),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(route).toMatch(/functions:\s*inngestFunctions\(process\.env\)\s*,?\s*\}\)/);
    expect(route).toMatch(/from\s*['"]@\/lib\/v2\/pipeline\/functions['"]/);
  });
});

describe('registration with V2_PIPELINE=1 (D3)', () => {
  it('adds checkFn, its cancel handler, the reaper and the expiry after v1’s four', () => {
    const fns = inngestFunctions({ V2_PIPELINE: '1' });
    expect(fns.slice(0, 4)).toEqual([
      auditFn,
      reconcileBillingFn,
      reconcileBillingManualFn,
      cleanupExpiredAuditsFn,
    ]);
    expect(
      configsOf(fns.slice(4))
        .map((c) => c.id)
        .filter((id) => !id.endsWith('-failure')),
    ).toEqual([
      `crawlmouse-${CHECK_FN_ID}`,
      `crawlmouse-${CHECK_CANCELLED_FN_ID}`,
      `crawlmouse-${CHECK_REAPER_FN_ID}`,
      `crawlmouse-${CHECK_EXPIRY_FN_ID}`,
    ]);
  });

  it('registers the scheduler (CC-28 D4) only with V2_PIPELINE=1 and V2_CHECKS_PUBLIC=1', () => {
    const tick = `crawlmouse-${SCHEDULE_TICK_FN_ID}`;
    for (const [env, registered] of [
      [{}, false],
      [{ V2_PIPELINE: '1' }, false],
      [{ V2_CHECKS_PUBLIC: '1' }, false],
      [{ V2_PIPELINE: '1', V2_CHECKS_PUBLIC: '0' }, false],
      [{ V2_PIPELINE: 'true', V2_CHECKS_PUBLIC: '1' }, false],
      [{ V2_PIPELINE: '1', V2_CHECKS_PUBLIC: '1' }, true],
    ] as const) {
      const ids = configsOf(inngestFunctions(env)).map((c) => c.id);
      expect(
        ids.filter((id) => id === tick),
        JSON.stringify(env),
      ).toHaveLength(registered ? 1 : 0);
    }
  });

  it('registers no expiry with V2_PIPELINE unset', () => {
    expect(configsOf(inngestFunctions({})).map((c) => c.id)).not.toContain(
      `crawlmouse-${CHECK_EXPIRY_FN_ID}`,
    );
  });

  it('the registered expiry runs expireUnkept, then settleKept, over the wiring’s stores', async () => {
    const calls: string[] = [];
    const evidence = memoryEvidenceStore();
    const expiry: ExpireDeps = {
      store: {
        expiredUnkept: async () => {
          calls.push('expiredUnkept');
          return { rows: [], remaining: 0 };
        },
        deleteExpiredUnkept: async () => [],
        unsettledKept: async () => {
          calls.push('unsettledKept');
          return { rows: [], remaining: 0 };
        },
      },
      evidence,
      keep: { store: {} as KeepStore, evidence, report: () => {} },
      now: () => 0,
    };
    const wiring: Wiring = { ...UNUSED_WIRING, expiry: () => expiry };
    const fn = inngestFunctions({ V2_PIPELINE: '1' }, wiring).find(
      (f) => configsOf([f])[0]!.id === `crawlmouse-${CHECK_EXPIRY_FN_ID}`,
    ) as unknown as { fn: (ctx: unknown) => Promise<unknown> };
    const out = await fn.fn({
      step: { run: async (_id: string, body: () => Promise<unknown>) => body() },
    });
    expect(calls).toEqual(['expiredUnkept', 'unsettledKept']);
    expect(out).toEqual({
      expired: { sites: 0, checks: 0, skipped: 0, left: 0 },
      settled: { moved: 0, nothing: 0, failed: 0, left: 0 },
    });
  });
});

/** Every declared concurrency limit of every config. */
const limitsOf = (configs: readonly Config[]): number[] =>
  configs.flatMap((c) => {
    const k = c.concurrency;
    if (k === undefined) return [];
    if (typeof k === 'number') return [k];
    return (Array.isArray(k) ? k : [k]).map((o) => o.limit);
  });

/**
 * CC-28's mail functions and CC-29's deletion of Agency Plus requests, registered with
 * V2_CHECKS_PUBLIC=1 only (lib/v2/mail/functions.ts).
 */
const MAIL_IDS = [
  'crawlmouse-crawlmouse.mail.account',
  'crawlmouse-crawlmouse.mail.check-notify',
  'crawlmouse-crawlmouse.mail.fix-to-developer',
  'crawlmouse-crawlmouse.events.check-finished',
  'crawlmouse-crawlmouse.mail.contact-purge',
];
const SWEEP = [undefined, '', '0', '-1', '2', '5', '6', '50', '1000', 'abc', '5.5'] as const;

/**
 * CC-33's founder functions: registered with V2_BILLING=1 or V2_CHECKS_PUBLIC=1. The sign-in canary
 * is registered only with a sign-in link given, which this list does not pass (lib/v2/ops/functions.ts).
 */
const FOUNDER_IDS = [
  'crawlmouse-crawlmouse.founder.entitlement',
  'crawlmouse-crawlmouse.founder.sweep',
  'crawlmouse-crawlmouse.founder.digest',
];

/** CC-28's alert and summary functions: registered with V2_PIPELINE and V2_CHECKS_PUBLIC both set. */
const MONITOR_IDS = [
  'crawlmouse-crawlmouse.alert.dispatch',
  'crawlmouse-crawlmouse.summary.tick',
  'crawlmouse-crawlmouse.summary.send',
];

describe('CC-28’s monitoring functions (D5, D6)', () => {
  it('register with V2_PIPELINE and V2_CHECKS_PUBLIC both set, and with neither alone', () => {
    const ids = (env: Record<string, string>) => configsOf(inngestFunctions(env)).map((c) => c.id);
    expect(ids({ V2_PIPELINE: '1', V2_CHECKS_PUBLIC: '1' })).toEqual(
      expect.arrayContaining(MONITOR_IDS),
    );
    const envs: Record<string, string>[] = [
      {},
      { V2_PIPELINE: '1' },
      { V2_CHECKS_PUBLIC: '1' },
      { V2_BILLING: '1' },
    ];
    for (const env of envs) {
      for (const id of MONITOR_IDS) expect(ids(env), JSON.stringify(env)).not.toContain(id);
    }
  });
});

describe('no registered function can declare a concurrency limit above the plan cap (D4)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // auditFn reads INNGEST_AUDIT_CONCURRENCY when its module loads, so each case loads the modules
  // afresh, as a new deployment does.
  // V2_BILLING adds CC-03's trial and past-due functions, and V2_CHECKS_PUBLIC CC-27b's three deletion
  // functions, which the cap covers as well.
  for (const pub of [undefined, '1'] as const)
    for (const billing of [undefined, '1'] as const)
      for (const flag of [undefined, '1'] as const) {
        for (const audit of SWEEP) {
          it(`V2_CHECKS_PUBLIC=${String(pub)}, V2_BILLING=${String(billing)}, V2_PIPELINE=${String(flag)}, INNGEST_AUDIT_CONCURRENCY=${String(audit)}, every INNGEST_CHECK_CONCURRENCY`, async () => {
            vi.stubEnv('V2_CHECKS_PUBLIC', pub);
            vi.stubEnv('V2_BILLING', billing);
            vi.stubEnv('V2_PIPELINE', flag);
            vi.stubEnv('INNGEST_AUDIT_CONCURRENCY', audit);
            vi.resetModules();
            const fresh = await import('./functions');
            for (const check of SWEEP) {
              vi.stubEnv('INNGEST_CHECK_CONCURRENCY', check);
              const configs = configsOf(fresh.inngestFunctions(process.env));
              expect(configs.length).toBe(
                (flag === '1' ? 10 : 5) +
                  (billing === '1' ? 2 : 0) +
                  (pub === '1' ? 3 + MAIL_IDS.length : 0) +
                  // CC-33's founder functions, with either flag.
                  (pub === '1' || billing === '1' ? FOUNDER_IDS.length : 0) +
                  // CC-28's scheduler tick, and its alert and summary functions.
                  (pub === '1' && flag === '1' ? 1 + MONITOR_IDS.length : 0),
              );
              for (const id of MONITOR_IDS)
                expect(configs.map((c) => c.id).includes(id), id).toBe(pub === '1' && flag === '1');
              const deletionIds = [
                'crawlmouse-crawlmouse.account.deletion-cancel',
                'crawlmouse-crawlmouse.account.deletion-resume',
                'crawlmouse-crawlmouse.account.purge-deleted',
              ];
              const ids = configs.map((c) => c.id);
              for (const id of [...deletionIds, ...MAIL_IDS]) {
                expect(ids.includes(id), id).toBe(pub === '1');
              }
              for (const id of FOUNDER_IDS) {
                expect(ids.includes(id), id).toBe(pub === '1' || billing === '1');
              }
              if (billing === '1') {
                expect(configs.map((c) => c.id)).toEqual(
                  expect.arrayContaining([
                    'crawlmouse-crawlmouse.trial.lifecycle',
                    'crawlmouse-crawlmouse.billing.past-due-sweep',
                  ]),
                );
              }
              const limits = limitsOf(configs);
              expect(limits.length).toBeGreaterThan(0);
              for (const limit of limits) {
                expect(
                  limit,
                  `${configs.map((c) => c.id).join(', ')}: ${limits.join(', ')}`,
                ).toBeLessThanOrEqual(PLAN_CONCURRENCY_CAP);
                expect(limit).toBeGreaterThanOrEqual(1);
              }
            }
          });
        }
      }

  it('the sweep reaches the values it sets: a limit of 2 from each variable', async () => {
    vi.stubEnv('V2_PIPELINE', '1');
    vi.stubEnv('INNGEST_AUDIT_CONCURRENCY', '2');
    vi.stubEnv('INNGEST_CHECK_CONCURRENCY', '1');
    vi.resetModules();
    const fresh = await import('./functions');
    const configs = configsOf(fresh.inngestFunctions(process.env));
    expect(configs.find((c) => c.id === 'crawlmouse-crawlmouse.audit')!.concurrency).toEqual({
      limit: 2,
    });
    expect(configs.find((c) => c.id === `crawlmouse-${CHECK_FN_ID}`)!.concurrency).toEqual([
      { key: 'event.data.siteId', limit: 1 },
      { limit: 1 },
    ]);
  });
});

/** persistDb is not reached in these tests: each method throws if it is. */
const UNUSED_DB: StepStores['persistDb'] = {
  persistBuiltCheck: async () => {
    throw new Error('persistDb is not called in this test');
  },
  stageCheckRows: async () => {
    throw new Error('persistDb is not called in this test');
  },
};

describe('stepDeps: the step bodies’ dependencies as production wires them (quality 3, security 3)', () => {
  const stores: StepStores = {
    store: {} as PipelineStore,
    evidence: memoryEvidenceStore(),
    persistDb: UNUSED_DB,
  };

  it('discovers through the engine’s safeFetch, the SSRF guard (§5), as our crawler', () => {
    const deps = stepDeps({}, stores);
    expect(deps.discover.fetch).toBe(safeFetch);
    expect(deps.discover.userAgent).toBe(CRAWL_USER_AGENT);
  });

  it('renders with the daily budget that refuses (Q7)', () => {
    expect(stepDeps({}, stores).render.daily).toBe(NO_DAILY_BUDGET);
  });

  it('runs over the stores it is given', () => {
    const deps = stepDeps({}, stores);
    expect(deps.store).toBe(stores.store);
    expect(deps.evidence).toBe(stores.evidence);
    expect(deps.persistDb).toBe(stores.persistDb);
  });
});

/** An HTTP server on loopback that answers 404 and counts the connections and requests it sees. */
async function loopbackSite() {
  const seen = { connections: 0, requests: 0 };
  const server = createServer((_, res) => {
    seen.requests++;
    res.writeHead(404).end();
  });
  server.on('connection', () => {
    seen.connections++;
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((e) => (e ? reject(e) : resolve()));
    });
  return { seen, port, close };
}

describe('production discovery sends a loopback site nothing (quality 2)', () => {
  let site: Awaited<ReturnType<typeof loopbackSite>>;
  beforeEach(async () => {
    site = await loopbackSite();
  });
  afterEach(async () => {
    await site.close();
  });

  const SITE = recordedInput().site;
  const CHECK_ID = 'c0000000-0000-4000-8000-0000000000e2';
  const SO: RunSoFar = {
    startedAt: Date.now(),
    crawlFrom: null,
    pagesCrawled: 0,
    linksFound: 0,
    release: null,
  };
  const seedsOf = (evidence: ReturnType<typeof memoryEvidenceStore>) =>
    getJson(evidence, `anon/${SITE.id}/${CHECK_ID}/seeds.json.gz`);

  it('the server counts what reaches it: a request made to it is seen', async () => {
    await fetch(`http://127.0.0.1:${site.port}/robots.txt`);
    expect(site.seen).toEqual({ connections: 1, requests: 1 });
  });

  it('checkStepsFromEnv’s discover sends the site nothing, and seeds the homepage', async () => {
    const homepageUrl = `http://127.0.0.1:${site.port}/`;
    const { store } = memoryStore(
      SITE,
      [queuedCheck(CHECK_ID, SITE.id, '2026-11-08T12:00:00.000Z', GRADE_VERSION)],
      () => new Date().toISOString(),
    );
    const evidence = memoryEvidenceStore();
    const steps = checkStepsFromEnv({}, { store, evidence, persistDb: UNUSED_DB });
    const event: CheckRequested = {
      checkId: CHECK_ID,
      siteId: SITE.id,
      accountId: null,
      host: `127.0.0.1:${site.port}`,
      homepageUrl,
      trigger: 'manual',
      pageCap: 500,
    };
    expect(await steps.discover(event, SO)).toMatchObject({ seeds: 1, sitemap_urls: 0 });
    expect(site.seen).toEqual({ connections: 0, requests: 0 });
    expect(await seedsOf(evidence)).toEqual([
      { url: homepageUrl, source: 'homepage', lastmod: null },
    ]);
  });

  it('the check inngestFunctions registers discovers the same way', async () => {
    const host = `127.0.0.1:${site.port}`;
    const memory = memoryStore(
      { ...SITE, host },
      [queuedCheck(CHECK_ID, SITE.id, '2026-11-08T12:00:00.000Z', GRADE_VERSION)],
      () => new Date().toISOString(),
    );
    const evidence = memoryEvidenceStore();
    const wiring: Wiring = {
      ...UNUSED_WIRING,
      store: () => memory.store,
      stores: () => ({ store: memory.store, evidence, persistDb: UNUSED_DB }),
    };
    const checkFn = inngestFunctions({ V2_PIPELINE: '1' }, wiring).find(
      (f) => configsOf([f])[0]!.id === `crawlmouse-${CHECK_FN_ID}`,
    ) as unknown as { fn: (ctx: unknown) => Promise<unknown> };
    const event: CheckRequested = {
      checkId: CHECK_ID,
      siteId: SITE.id,
      accountId: null,
      host,
      homepageUrl: homepageOf(host),
      trigger: 'manual',
      pageCap: 500,
    };
    // With no worker variables the check fails at its first batch, after discovery.
    const step = {
      run: async (_id: string, fn: () => Promise<unknown>) => fn(),
      sleep: async () => {},
      sendEvent: async () => {},
    };
    await expect(checkFn.fn({ event: { data: event }, step, runId: 'run-1' })).rejects.toThrow(
      'check failed: worker_unavailable',
    );
    expect(site.seen).toEqual({ connections: 0, requests: 0 });
    expect(await seedsOf(evidence)).toEqual([
      { url: homepageOf(host), source: 'homepage', lastmod: null },
    ]);
  });
});

/** An Ed25519 private key in the environment's form, so only the URL is wrong. */
const GOOD_KEY = generateKeyPairSync('ed25519')
  .privateKey.export({ format: 'der', type: 'pkcs8' })
  .toString('base64');

const BAD_WORKER_ENVS = {
  'a malformed key': {
    CRAWL_WORKER_URL: 'https://worker.example.com',
    WORKER_SIGNING_SECRET: 'secret',
    WORKER_JWT_PRIVATE_KEY_PKCS8_B64: 'bm90IGEga2V5',
  },
  'a worker URL with no scheme': {
    CRAWL_WORKER_URL: 'worker.example.com',
    WORKER_SIGNING_SECRET: 'secret',
    WORKER_JWT_PRIVATE_KEY_PKCS8_B64: GOOD_KEY,
  },
} as const;

describe('a worker variable that makes no client (correctness 1)', () => {
  const site = { ...recordedInput().site, host: '127.0.0.1' };
  // An IP literal the SSRF guard refuses before any request: discovery reads nothing and sends
  // nothing off this machine, and the check reaches its first batch with the homepage as its seed.
  const EVENT: CheckRequested = {
    checkId: 'c0000000-0000-4000-8000-0000000000e1',
    siteId: site.id,
    accountId: null,
    host: site.host,
    homepageUrl: 'https://127.0.0.1',
    trigger: 'manual',
    pageCap: 500,
  };

  type Fn = {
    fn: (ctx: unknown) => Promise<unknown>;
    onFailureFn: (ctx: unknown) => Promise<unknown>;
  };

  function wired(env: Record<string, string>) {
    const memory = memoryStore(
      site,
      [queuedCheck(EVENT.checkId, site.id, '2026-11-08T12:00:00.000Z', GRADE_VERSION)],
      () => new Date().toISOString(),
    );
    const reap = vi.fn(async () => [
      { checkId: EVENT.checkId, siteId: site.id, reason: 'stalled' as const },
    ]);
    const store: PipelineStore = { ...memory.store, reap };
    const wiring: Wiring = {
      ...UNUSED_WIRING,
      store: () => store,
      stores: () => ({ store, evidence: memoryEvidenceStore(), persistDb: UNUSED_DB }),
    };
    const fns = inngestFunctions({ V2_PIPELINE: '1', ...env }, wiring);
    const byId = (id: string) =>
      fns.find((f) => configsOf([f])[0]!.id === `crawlmouse-${id}`) as unknown as Fn;
    return {
      rows: memory.rows,
      reap,
      checkFn: byId(CHECK_FN_ID),
      cancelled: byId(CHECK_CANCELLED_FN_ID),
      reaper: byId(CHECK_REAPER_FN_ID),
    };
  }

  /** A step that runs its body at once and records what is sent. */
  function tools() {
    const sent: unknown[] = [];
    return {
      sent,
      step: {
        run: async (_id: string, fn: () => Promise<unknown>) => fn(),
        sleep: async () => {},
        sendEvent: async (_id: string, payload: unknown) => void sent.push(payload),
      },
    };
  }

  for (const [name, env] of Object.entries(BAD_WORKER_ENVS)) {
    describe(name, () => {
      it('is an environment the worker client refuses to build from', () => {
        expect(() => workerClientFromEnv(env)).toThrow();
      });

      it('the reaper still reaps, and sends check.failed for what it reaped', async () => {
        const w = wired(env);
        const t = tools();
        // The reaper sends from inside its step with the client's own send; nothing leaves here.
        const send = vi.spyOn(inngest, 'send').mockResolvedValue({ ids: [] });
        let sent: unknown[];
        try {
          await w.reaper.fn({ step: t.step });
          sent = send.mock.calls.map(([events]) => events);
        } finally {
          send.mockRestore();
        }
        expect(w.reap).toHaveBeenCalledTimes(1);
        expect(sent).toEqual([
          [
            {
              id: `check-failed:${EVENT.checkId}`,
              name: 'check.failed',
              data: { checkId: EVENT.checkId, siteId: site.id, reason: 'stalled' },
            },
          ],
        ]);
      });

      it('the cancel handler still fails the check its run claimed', async () => {
        const w = wired(env);
        Object.assign(w.rows.get(EVENT.checkId)!, { status: 'running', inngest_run_id: 'run-9' });
        await w.cancelled.fn({
          event: { data: { function_id: `crawlmouse-${CHECK_FN_ID}`, run_id: 'run-9' } },
          step: tools().step,
        });
        expect(w.rows.get(EVENT.checkId)).toMatchObject({
          status: 'failed',
          failure_reason: 'canceled',
        });
      });

      it('the cancel handler fails a check cancelled before its claim, by the event’s check id', async () => {
        const w = wired(env);
        await w.cancelled.fn({
          event: {
            data: {
              function_id: `crawlmouse-${CHECK_FN_ID}`,
              run_id: 'run-never-claimed',
              event: { name: 'check.requested', data: EVENT },
            },
          },
          step: tools().step,
        });
        expect(w.rows.get(EVENT.checkId)).toMatchObject({
          status: 'failed',
          failure_reason: 'canceled',
        });
      });

      it('onFailure still fails the check', async () => {
        const w = wired(env);
        await w.checkFn.onFailureFn({
          event: { data: { event: { data: EVENT } } },
          error: new Error('boom'),
          step: tools().step,
        });
        expect(w.rows.get(EVENT.checkId)).toMatchObject({
          status: 'failed',
          failure_reason: 'internal',
        });
      });

      it('a check fails worker_unavailable at its first batch instead of staying queued', async () => {
        const w = wired(env);
        const t = tools();
        const error = await w.checkFn
          .fn({ event: { data: EVENT }, step: t.step, runId: 'run-1' })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(error).toBeInstanceOf(NonRetriableError);
        expect(error).toMatchObject({ message: 'check failed: worker_unavailable' });
        // Inngest then runs onFailure with that error.
        await w.checkFn.onFailureFn({
          event: { data: { event: { data: EVENT } } },
          error,
          step: t.step,
        });
        expect(w.rows.get(EVENT.checkId)).toMatchObject({
          status: 'failed',
          failure_reason: 'worker_unavailable',
        });
      });
    });
  }
});
