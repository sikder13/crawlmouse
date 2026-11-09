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
import { fakeWorker, memoryStore, queuedCheck } from '../test-support/fakes';
import { memoryEvidenceStore } from '../test-support/memory-evidence';
import { NO_DAILY_BUDGET, checkSteps, type StepDeps } from './index';

// persist.ts and checkMap are workstreams A's and D's: stand-ins here, so this test is about the
// steps and the orchestration. The persist stand-in records what the persist step hands it.
const persisted = vi.hoisted(() => [] as unknown[]);
vi.mock('../persist', () => ({
  pageVantage: (pages: { url: string; outcome: string; identity_sent: string }[]) =>
    new Map(
      pages
        .filter((p) => p.outcome === 'fetched')
        .map((p) => [p.url, { identity_sent: p.identity_sent }]),
    ),
  persistBuiltCheck: async (_db: unknown, input: unknown) => {
    persisted.push(input);
    return { written: true, counts: {} };
  },
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

async function runRecorded() {
  persisted.length = 0;
  const clock = { now: T0 };
  const iso = () => new Date(clock.now).toISOString();
  const results = recordedFromOne();
  const { worker, posted } = fakeWorker(results);
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
    },
    discover: { fetch: (async () => ({})) as never, userAgent: 'UA', now: () => clock.now },
  };
  const steps = checkSteps(deps);
  // The recorded crawl was planned from the recording's seeds, lastmod dates included (stage 2's
  // "newest" picks read them); they stand in for discovery here, so the planners meet the same seeds.
  steps.discover = async () => {
    await putJson(evidence, `anon/${SITE_ID}/${CHECK}/seeds.json.gz`, seedsOf(HOST));
    return { seeds: seedsOf(HOST).length, sitemap_urls: seedsOf(HOST).length - 1, at: clock.now };
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
