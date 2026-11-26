import { describe, expect, it, vi } from 'vitest';
import { GRADE_VERSION } from '@crawlmouse/engine/v2/pipeline';
import type { AccessBatchResult, BatchResult, CrawlBatchResult } from '@crawlmouse/types/v2';
import { runCheck, type CheckStepTools } from '../../../../../../inngest/check';
import type { CheckRequested } from '../../../../../../inngest/check-events';
import {
  CHECK,
  HOST,
  PAGE_CAP,
  SITE_ID,
  readRecorded,
  recordedInput,
  seedsOf,
} from '../../../../../../packages/engine/fixtures/v2/build/recorded';
import { getJson, putJson } from '../evidence';
import { objectNames } from '../keep';
import { fakeWorker, memoryStore, queuedCheck } from '../test-support/fakes';
import { memoryEvidenceStore } from '../test-support/memory-evidence';
import { AFTER_RENDER_MIN_S, RENDER_SHARE_S, RESERVE_S } from '../limits';
import { REQUEST_TIMEOUT_MS } from '@crawlmouse/engine/v2/pipeline';
import { RENDER_STEP_MS } from './deps';
import { NO_DAILY_BUDGET, checkSteps, type StepDeps } from './index';
import type { WorkerClient } from '../../../worker-client/types';
import type { RowTarget } from '../types';

// persist.ts and checkMap are workstreams A's and D's: stand-ins here, so this test is about the
// steps and the orchestration. The persist stand-in records what the persist step hands it.
const persisted = vi.hoisted(() => [] as unknown[]);
vi.mock('../persist', () => ({
  PIECE_CUT: { rows: 2_000, bytes: 1024 * 1024, perStep: 50 },
  pageVantage: (pages: { url: string; outcome: string; identity_sent: string }[]) =>
    new Map(
      pages
        .filter((p) => p.outcome === 'fetched')
        .map((p) => [p.url, { identity_sent: p.identity_sent }]),
    ),
  // One persist step that writes every row and finishes the check (persist.ts persistStep).
  persistStep: async (_db: unknown, input: unknown) => {
    persisted.push(input);
    return { next: null, outcome: { written: true, counts: {}, verified: [] } };
  },
  // What the build read of the fixes, marked so the persist step's hand-over can be seen.
  readOfFixes: (fixes: unknown[], events: unknown[]) => [
    { read_by: 'build', fixes: fixes.length, events: events.length },
  ],
}));
vi.mock('@crawlmouse/engine/v2/pipeline', async (original) => ({
  ...(await original<object>()),
  checkMap: () => ({ version: 1, positions: {} }),
}));

const T0 = Date.parse('2026-11-05T02:30:00Z');
/**
 * persist.ts is mocked above, so the database it would call is never reached: each of PersistDb's
 * methods (the finishing RPC, and the chunked staging A added for Q11) throws if it is.
 */
const UNUSED_DB = {
  persistBuiltCheck: async (): Promise<unknown> => {
    throw new Error('persistDb is not called in this test');
  },
  stageCheckRows: async (): Promise<unknown> => {
    throw new Error('persistDb is not called in this test');
  },
  rowTarget: async (): Promise<RowTarget> => {
    throw new Error('persistDb is not called in this test');
  },
  insertPageResults: async (): Promise<void> => {
    throw new Error('persistDb is not called in this test');
  },
  storedRows: async (): Promise<{ status: string; page_results: number; link_edges: number }> => {
    throw new Error('persistDb is not called in this test');
  },
  insertEdges: async (): Promise<void> => {
    throw new Error('persistDb is not called in this test');
  },
};
const EVENT: CheckRequested = {
  checkId: CHECK,
  siteId: SITE_ID,
  accountId: null,
  host: new URL(HOST).hostname,
  homepageUrl: HOST,
  trigger: 'first_audit',
  pageCap: PAGE_CAP,
};

/** The recorded batches as the pipeline numbers them: from 1, crawl then access. */
function recordedFromOne(): Map<number, BatchResult> {
  return new Map(
    readRecorded('batches').map((b) => {
      const n = Number(b.batch_id.split(':')[1]) + 1;
      return [n, { ...b, batch_id: `${CHECK}:${n}` }];
    }),
  );
}

async function runRecorded(
  over: {
    /** The render deps, or a function of the step's clock that gives them (QA B1's moving clock). */
    render?: Partial<StepDeps['render']> | ((clock: { now: number }) => object);
    measure?: NonNullable<WorkerClient['measureRendered']>;
  } = {},
) {
  persisted.length = 0;
  const clock = { now: T0 };
  const iso = () => new Date(clock.now).toISOString();
  const results = recordedFromOne();
  const { worker: plain, posted } = fakeWorker(results);
  const worker: WorkerClient = over.measure ? { ...plain, measureRendered: over.measure } : plain;
  const { store, batches, rows } = memoryStore(
    recordedInput().site,
    [
      {
        ...queuedCheck(CHECK, SITE_ID, '2026-11-05T02:29:58.000Z', GRADE_VERSION),
        trigger: 'first_audit',
      },
    ],
    iso,
  );
  const evidence = memoryEvidenceStore();
  let nonces = 0;
  const deps: StepDeps = {
    store,
    evidence,
    persistDb: UNUSED_DB,
    worker: () => worker,
    now: () => clock.now,
    nonce: () => `nonce-${String(++nonces).padStart(16, '0')}`,
    env: { VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40) },
    render: {
      // Configured, so the refusing daily budget is what stops rendering (Q7).
      client: { content: async () => ({ ok: false }) } as never,
      caps: { perCheckMs: 3_600_000, perDayMs: 36_000_000 },
      daily: NO_DAILY_BUDGET,
      inFlight: 2,
      ...(typeof over.render === 'function' ? over.render(clock) : over.render),
    },
    discover: { fetch: (async () => ({})) as never, userAgent: 'UA', now: () => clock.now },
  };
  const steps = checkSteps(deps);
  // The recorded crawl was planned from the recording's seeds, lastmod dates included (stage 2's
  // "newest" picks read them); they stand in for discovery here, so the planners meet the same seeds.
  steps.discover = async () => {
    await putJson(evidence, `anon/${SITE_ID}/${CHECK}/seeds.json.gz`, seedsOf(HOST));
    return {
      seeds: seedsOf(HOST).length,
      sitemap_urls: seedsOf(HOST).length - 1,
      robots_txt: 'found',
      at: clock.now,
    };
  };
  const ids: string[] = [];
  const tools: CheckStepTools = {
    run: async (id, fn) => {
      ids.push(id);
      return JSON.parse(JSON.stringify(await fn()));
    },
    sleep: async (id, ms) => {
      ids.push(id);
      clock.now += ms;
    },
    sendEvent: async (id) => {
      ids.push(id);
    },
  };
  const result = await runCheck({ event: { data: EVENT }, step: tools, runId: 'run-1' }, steps);
  return { result, ids, posted, results, evidence, batches, rows };
}

describe('checkSteps under runCheck, on the recorded worker batches', () => {
  it('runs claim to finalize in the order the recorded check was planned', async () => {
    const { result, ids } = await runRecorded();
    expect(result.status === 'finished' || result.status === 'partial').toBe(true);
    const batch = (p: string) => [`${p}-post`, `${p}-wait-1`, `${p}-poll-1`, `${p}-read`];
    expect(ids).toEqual([
      'claim',
      'discover',
      ...batch('crawl-1'),
      ...batch('crawl-2'),
      'crawl-3-post',
      ...batch('access-1'),
      ...batch('access-2'),
      'render',
      'build',
      'persist',
      'emit',
      'finalize',
    ]);
  });

  it('posts what the recorded batches fetched: the planners agree with the recording', async () => {
    const { posted, results } = await runRecorded();
    const urlsOf = (b: BatchResult) =>
      b.kind === 'crawl'
        ? (b as CrawlBatchResult).pages.map((p) => p.url)
        : [...new Set((b as AccessBatchResult).access_tests.map((t) => t.page_url))];
    expect(posted.map((p) => [p.kind, p.batch])).toEqual([
      ['crawl', 1],
      ['crawl', 2],
      ['access', 3],
      ['access', 4],
    ]);
    for (const p of posted) {
      const sent = p.kind === 'crawl' ? p.urls : p.pages.map((x) => x.url);
      expect(new Set(sent), `batch ${p.batch}`).toEqual(new Set(urlsOf(results.get(p.batch)!)));
      expect(p.site_host).toBe('built-site.test');
      expect(p.budget.max_seconds).toBeGreaterThanOrEqual(60);
    }
  });

  it('stores every batch, the seeds, the render and the map, and deletes the built check', async () => {
    const { evidence, batches } = await runRecorded();
    const base = `anon/${SITE_ID}/${CHECK}`;
    expect([...evidence.objects.keys()].sort()).toEqual(
      [
        `${base}/batch-1.json.gz`,
        `${base}/batch-2.json.gz`,
        `${base}/batch-3.json.gz`,
        `${base}/batch-4.json.gz`,
        `${base}/map.json.gz`,
        `${base}/render.json.gz`,
        `${base}/seeds.json.gz`,
      ].sort(),
    );
    for (const b of batches.values()) {
      expect(b.status).toBe('done');
      expect(b.result_path).toBe(`${base}/batch-${b.batch}.json.gz`);
      expect((b.summary as { release: string }).release).toBe('unreleased');
    }
  });

  it('renders nothing while the daily budget refuses (Q7)', async () => {
    const { evidence } = await runRecorded();
    const render = (await getJson(evidence, `anon/${SITE_ID}/${CHECK}/render.json.gz`)) as {
      pages: { rendered: boolean; reason?: string }[];
    };
    expect(render.pages.length).toBeGreaterThan(0);
    for (const p of render.pages)
      expect(p).toMatchObject({ rendered: false, reason: 'daily_budget_unavailable' });
  });

  const renderedPages = async (evidence: Awaited<ReturnType<typeof runRecorded>>['evidence']) =>
    (
      (await getJson(evidence, `anon/${SITE_ID}/${CHECK}/render.json.gz`)) as {
        pages: { rendered: boolean; reason?: string }[];
      }
    ).pages;

  it('asks the budget of this check when one is wired', async () => {
    const asked: string[] = [];
    const { evidence } = await runRecorded({
      render: () => ({
        dailyFor: (checkId: string) => {
          asked.push(checkId);
          return { reserve: async () => false, settle: async () => undefined };
        },
      }),
    });
    expect(asked).toEqual([CHECK]);
    const pages = await renderedPages(evidence);
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) expect(p).toMatchObject({ rendered: false, reason: 'daily_cap' });
  });

  // Review of the render budget (B1): a 240 s render step did not fit the 180 s the run keeps for
  // render, build, persist and finalize together, so a full render would run the check past its
  // finish timeout. Render takes its share of RESERVE_S; the rest is left for the steps after it.
  it('renders within its share of the reserve, leaving the rest for build, persist and finalize', () => {
    expect(RENDER_STEP_MS).toBe(RENDER_SHARE_S * 1000);
    expect(RESERVE_S - RENDER_SHARE_S).toBeGreaterThanOrEqual(AFTER_RENDER_MIN_S);
  });

  it(`stops rendering ${RENDER_STEP_MS / 1000} s after the render step began`, async () => {
    let contents = 0;
    const { evidence } = await runRecorded({
      render: (clock) => ({
        admit: async () => undefined,
        client: {
          content: async () => {
            contents++;
            return { ok: false, reason: 'page_failed', retryAfterMs: null, browserMs: 1 };
          },
        },
        dailyFor: () => ({
          reserve: async () => {
            clock.now += RENDER_STEP_MS;
            return true;
          },
          settle: async () => undefined,
        }),
      }),
    });
    expect(contents).toBe(0);
    const pages = await renderedPages(evidence);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.filter((p) => p.reason === 'out_of_time').length).toBeGreaterThan(0);
  });

  it('counts the deadline from the start of the step, so slow loads shorten the render', async () => {
    let reserves = 0;
    const { evidence } = await runRecorded({
      render: (clock) => ({
        admit: async () => undefined,
        // Called once the step has loaded what it reads: those loads took almost the whole allowance.
        dailyFor: () => {
          clock.now += RENDER_STEP_MS - 1;
          return {
            reserve: async () => {
              reserves++;
              return true;
            },
            settle: async () => undefined,
          };
        },
      }),
    });
    expect(reserves).toBe(0);
    const pages = await renderedPages(evidence);
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) expect(p).toMatchObject({ rendered: false, reason: 'out_of_time' });
  });

  // QA's B1 on #172: the deadline left no room for one page once any time passed in the step's
  // loads (1 ms: 0 of 27 rendered), because it was tested against both renders up front and the
  // two together are the step's whole share. It is now tested before each request.
  describe('renders through the step while the clock moves (QA B1)', () => {
    const HTML =
      '<html><head><title>A page</title></head><body><main><p>' +
      'Words a reader can read without JavaScript. '.repeat(20) +
      '</p></main></body></html>';
    /** A run whose loads take `loadsMs`, and each request `requestMs`, on the step's own clock. */
    async function moving(loadsMs: number, requestMs: number) {
      const starts: number[] = [];
      let stepStart = 0;
      const { evidence } = await runRecorded({
        render: (clock) => ({
          admit: async () => undefined,
          client: {
            content: async () => {
              starts.push(clock.now);
              clock.now += requestMs;
              return { ok: true, html: HTML, browserMs: requestMs };
            },
          },
          // Called once the step has loaded what it reads: the loads took `loadsMs`.
          dailyFor: () => {
            stepStart = clock.now;
            clock.now += loadsMs;
            return { reserve: async () => true, settle: async () => undefined };
          },
        }),
        // The worker reads each rendered page (questions/042); here it answers at once.
        measure: async () => ({
          raw_words: 40,
          rendered_words: 40,
          challenged: false,
          links: null,
        }),
      });
      return { pages: await renderedPages(evidence), starts, stepStart };
    }

    it.each([1, 1_000, 30_000])(
      'renders every sampled page when the loads took %i ms and each request is quick',
      async (loadsMs) => {
        const { pages, starts } = await moving(loadsMs, 1);
        expect(pages.length).toBeGreaterThan(0);
        expect(pages.filter((p) => p.rendered)).toHaveLength(pages.length);
        expect(starts).toHaveLength(2 * pages.length);
      },
    );

    it('starts no request that could not finish by the deadline, and renders what fits', async () => {
      // Each request takes 20 s on the step's clock, so the 90 s share holds a few and not all.
      const { pages, starts, stepStart } = await moving(1_000, 20_000);
      const deadline = stepStart + RENDER_STEP_MS;
      expect(starts.length).toBeGreaterThan(0);
      for (const at of starts) expect(at + REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(deadline);
      expect(pages.some((p) => p.rendered)).toBe(true);
      expect(pages.some((p) => p.reason === 'out_of_time')).toBe(true);
    });
  });

  describe('with the budget granted, each rendered page is read on the worker (questions/042)', () => {
    const granted = (): Partial<StepDeps['render']> => {
      let used = 0;
      return {
        client: {
          content: async () => ({ ok: true, html: '<p>a b c</p>', browserMs: 50 }),
        } as never,
        // The recorded host does not resolve; admission is the engine's to test, not this one's.
        admit: async () => {},
        daily: {
          async reserve(ms: number, limitMs: number) {
            if (used + ms > limitMs) return false;
            used += ms;
            return true;
          },
          async settle(reservedMs: number, usedMs: number) {
            used += usedMs - reservedMs;
          },
        },
      };
    };
    const renderOf = async (evidence: Awaited<ReturnType<typeof runRecorded>>['evidence']) =>
      (await getJson(evidence, `anon/${SITE_ID}/${CHECK}/render.json.gz`)) as {
        pages: { url: string; rendered: boolean; reason?: string; without_js?: unknown }[];
      };

    it('measures with what the worker read, for every rendered page', async () => {
      const asked: string[] = [];
      const { evidence } = await runRecorded({
        render: granted(),
        measure: async (_s, _r, url) => {
          asked.push(url);
          return { raw_words: 4, rendered_words: 8, challenged: false, links: null };
        },
      });
      const render = await renderOf(evidence);
      expect(render.pages.length).toBeGreaterThan(0);
      expect(asked.sort()).toEqual(render.pages.map((p) => p.url).sort());
      for (const p of render.pages) {
        expect(p).toMatchObject({
          rendered: true,
          without_js: { raw_words: 4, rendered_words: 8, text_share: 0.5 },
        });
      }
    });

    it('reads no page itself when the worker cannot: each records measure_failed', async () => {
      const { evidence } = await runRecorded({ render: granted() });
      const render = await renderOf(evidence);
      expect(render.pages.length).toBeGreaterThan(0);
      for (const p of render.pages)
        expect(p).toMatchObject({ rendered: false, reason: 'measure_failed' });
    });
  });

  it('hands persistence the built check, every page’s vantage and the map’s path', async () => {
    await runRecorded();
    expect(persisted).toHaveLength(1);
    const input = persisted[0] as {
      built: { check: { id: string; status: string }; page_results: { url: string }[] };
      vantage: Map<string, unknown>;
      map_path: string;
    };
    expect(input.built.check.id).toBe(CHECK);
    expect(input.map_path).toBe(`anon/${SITE_ID}/${CHECK}/map.json.gz`);
    expect([...input.vantage.keys()].sort()).toEqual(
      input.built.page_results.map((p) => p.url).sort(),
    );
  });

  // QA B3 on #219: the build stores its release's piece cut, and persist cuts by the stored one.
  it('hands persistence the piece cut the build stored with the built check', async () => {
    await runRecorded();
    expect((persisted[0] as { cut: unknown }).cut).toEqual({
      rows: 2_000,
      bytes: 1024 * 1024,
      perStep: 50,
    });
  });

  it('hands persistence what the build read of the site’s fixes, for the watermark (CC-26b D5)', async () => {
    await runRecorded();
    expect((persisted[0] as { read: unknown }).read).toEqual([
      { read_by: 'build', fixes: 0, events: 0 },
    ]);
  });

  it('keeps the check running with its progress while it runs', async () => {
    const { rows } = await runRecorded();
    const row = rows.get(CHECK)!;
    expect(row.status).toBe('running');
    expect(row.progress?.pages_crawled).toBe(
      [...recordedFromOne().values()]
        .filter((b): b is CrawlBatchResult => b.kind === 'crawl')
        .flatMap((b) => b.pages)
        .filter((p) => p.outcome === 'fetched').length,
    );
    expect(row.inngest_run_id).toBe('run-1');
  });
});

/**
 * F-260 end to end: a worker deploy meets the first run at its second crawl batch, which comes from
 * another release. The first run queues the check again and sends its retry; the retry run, with one
 * worker that still holds the first run's batches (as the real one does for an hour), reads the same
 * recording numbered from `firstBatch`.
 */
async function runAcrossADeploy(honourFirstBatch = true) {
  persisted.length = 0;
  const clock = { now: T0 };
  const iso = () => new Date(clock.now).toISOString();
  const results = new Map<number, BatchResult>();
  const recorded = recordedFromOne();
  const crawl2 = recorded.get(2) as CrawlBatchResult;
  results.set(1, recorded.get(1)!);
  results.set(2, {
    ...crawl2,
    pages: crawl2.pages.map((p) => ({ ...p, worker_release: 'b'.repeat(12) })),
  });
  const { worker, posted, held } = fakeWorker(results);
  const { store, batches, rows } = memoryStore(
    recordedInput().site,
    [
      {
        ...queuedCheck(CHECK, SITE_ID, '2026-11-05T02:29:58.000Z', GRADE_VERSION),
        trigger: 'first_audit',
      },
    ],
    iso,
  );
  const evidence = memoryEvidenceStore();
  let nonces = 0;
  const deps: StepDeps = {
    store,
    evidence,
    persistDb: UNUSED_DB,
    worker: () => worker,
    now: () => clock.now,
    nonce: () => `nonce-${String(++nonces).padStart(16, '0')}`,
    env: { VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40) },
    render: {
      client: { content: async () => ({ ok: false }) } as never,
      caps: { perCheckMs: 3_600_000, perDayMs: 36_000_000 },
      daily: NO_DAILY_BUDGET,
      inFlight: 2,
    },
    discover: { fetch: (async () => ({})) as never, userAgent: 'UA', now: () => clock.now },
  };
  const steps = checkSteps(deps);
  steps.discover = async () => {
    await putJson(evidence, `anon/${SITE_ID}/${CHECK}/seeds.json.gz`, seedsOf(HOST));
    return {
      seeds: seedsOf(HOST).length,
      sitemap_urls: seedsOf(HOST).length - 1,
      robots_txt: 'found',
      at: clock.now,
    };
  };
  const sent: { name: string; id: string; data: CheckRequested }[] = [];
  const tools: CheckStepTools = {
    run: async (_id, fn) => JSON.parse(JSON.stringify(await fn())),
    sleep: async (_id, ms) => {
      clock.now += ms;
    },
    sendEvent: async (_id, payload) => {
      sent.push(payload as (typeof sent)[number]);
    },
  };
  const first = await runCheck({ event: { data: EVENT }, step: tools, runId: 'run-1' }, steps);
  const retry = sent.find((e) => e.name === 'check.requested');
  const rowAfterFirst = { ...rows.get(CHECK)! };
  const batchesAfterFirst = batches.size;
  const objectsAfterFirst = [...evidence.objects.keys()].sort();
  if (!retry) return { first, retry, rowAfterFirst, batchesAfterFirst, objectsAfterFirst };
  const firstBatch = honourFirstBatch ? retry.data.retry!.firstBatch : 1;
  // The worker's new release answers the recording, numbered from the retry's first batch.
  for (const [n, b] of recorded) {
    const m = n - 1 + firstBatch;
    if (m > 2) results.set(m, { ...b, batch_id: `${CHECK}:${m}` });
  }
  clock.now += 60_000;
  const second = await runCheck(
    {
      event: { data: honourFirstBatch ? retry.data : { ...retry.data, retry: { firstBatch } } },
      step: tools,
      runId: 'run-2',
    },
    steps,
  );
  return {
    first,
    retry,
    rowAfterFirst,
    batchesAfterFirst,
    objectsAfterFirst,
    second,
    posted,
    held,
    rows,
    batches,
    evidence,
  };
}

describe('F-260: a worker deploy in the middle of a check', () => {
  it('queues the check again and sends its one retry, numbered past the first run’s batches', async () => {
    const { first, retry, rowAfterFirst, batchesAfterFirst } = await runAcrossADeploy();
    expect(first).toEqual({ status: 'retried' });
    expect(retry).toEqual({
      id: `check-retry:${CHECK}`,
      name: 'check.requested',
      data: { ...EVENT, retry: { firstBatch: 3 } },
    });
    expect(rowAfterFirst).toMatchObject({
      status: 'queued',
      started_at: null,
      progress: null,
      inngest_run_id: null,
    });
    expect(batchesAfterFirst).toBe(0);
  });

  // QA's gate on #190, F1: expiry and the purge name a check's objects from its batch rows, so the
  // first run's stored results go with its rows, and no object is left that nothing would remove.
  it('removes the first run’s stored batches with its rows, so every object left is one expiry names', async () => {
    const { objectsAfterFirst, evidence, batches } = await runAcrossADeploy();
    const base = `anon/${SITE_ID}/${CHECK}`;
    expect(objectsAfterFirst).toEqual([`${base}/seeds.json.gz`]);
    const named = new Set(
      objectNames([...batches!.values()].map((b) => b.batch)).map((n) => `${base}/${n}.json.gz`),
    );
    const left = [...evidence!.objects.keys()];
    expect(left.filter((k) => !named.has(k))).toEqual([]);
    expect(left.sort()).toEqual(
      [
        `${base}/batch-3.json.gz`,
        `${base}/batch-4.json.gz`,
        `${base}/batch-5.json.gz`,
        `${base}/batch-6.json.gz`,
        `${base}/map.json.gz`,
        `${base}/render.json.gz`,
        `${base}/seeds.json.gz`,
      ].sort(),
    );
  });

  it('builds on the retry what an undisturbed run builds, from batches the worker did not hold', async () => {
    const undisturbed = await runRecorded();
    const before = persisted[0] as { built: { page_results: unknown[]; link_edges: unknown[] } };
    const { second, posted } = await runAcrossADeploy();
    expect(second).toEqual(undisturbed.result);
    expect(posted!.map((p) => [p.kind, p.batch])).toEqual([
      ['crawl', 1],
      ['crawl', 2],
      ['crawl', 3],
      ['crawl', 4],
      ['access', 5],
      ['access', 6],
    ]);
    const after = persisted[0] as typeof before;
    expect(after.built.page_results).toEqual(before.built.page_results);
    expect(after.built.link_edges).toEqual(before.built.link_edges);
  });

  it('would read the first run’s held batches if the retry numbered from 1, and fail', async () => {
    const { second } = await runAcrossADeploy(false);
    expect(second).toEqual({ status: 'failed', reason: 'worker_redeployed' });
  });
});
