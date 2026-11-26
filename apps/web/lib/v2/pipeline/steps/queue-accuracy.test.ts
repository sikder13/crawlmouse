/**
 * The accuracy guard (CC-42A decision 6): a check's answer does not depend on how long it waited
 * for a free crawler. One recorded site runs through checkSteps under runCheck twice: once alone,
 * and once with the worker stand-in answering `busy` to the first BUSY_POLLS posts. The grade, its
 * four components, the AI readability grade and the findings must be the same.
 *
 * Why BUSY_POLLS: 20 busy answers are 600 s of waiting (PACE.busyWaitS each). Before CC-42A the
 * crawl clock started when discovery ended, so a check that waited 600 s had no crawl window left
 * (CRAWL_CEILING_S is 480 s) and failed `worker_unavailable`. Restoring that time plan (the clock
 * from discovery, and no add-back) reddens "a check that waited ... gets the same answer". Moving the
 * clock alone does not: the add-back then credits the wait. inngest/check.test.ts pins the clock's
 * start on its own. 600 s is inside the wait budget (QUEUE_WAIT_MAX_S), so the waited check must
 * still be graded. Waits between later batches are not exercised here; steps/time.test.ts covers
 * them.
 *
 * The harness is pipeline.test.ts's: the recorded batches, the seeds standing in for discovery,
 * and persistence stubbed to record what it is handed (the built check).
 */
import { describe, expect, it, vi } from 'vitest';
import { GRADE_VERSION } from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult } from '@crawlmouse/types/v2';
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
import { putJson } from '../evidence';
import { CRAWL_CEILING_S, PACE, QUEUE_WAIT_MAX_S } from '../limits';
import { fakeWorker, memoryStore, queuedCheck } from '../test-support/fakes';
import { memoryEvidenceStore } from '../test-support/memory-evidence';
import { NO_DAILY_BUDGET, checkSteps, type StepDeps } from './index';
import type { RowTarget } from '../types';

const persisted = vi.hoisted(() => [] as unknown[]);
vi.mock('../persist', () => ({
  PIECE_CUT: { rows: 2_000, bytes: 1024 * 1024, perStep: 50 },
  pageVantage: (pages: { url: string; outcome: string; identity_sent: string }[]) =>
    new Map(
      pages
        .filter((p) => p.outcome === 'fetched')
        .map((p) => [p.url, { identity_sent: p.identity_sent }]),
    ),
  persistStep: async (_db: unknown, input: unknown) => {
    persisted.push(input);
    return { next: null, outcome: { written: true, counts: {}, verified: [] } };
  },
  readOfFixes: () => [],
}));
vi.mock('@crawlmouse/engine/v2/pipeline', async (original) => ({
  ...(await original<object>()),
  checkMap: () => ({ version: 1, positions: {} }),
}));

const T0 = Date.parse('2026-11-05T02:30:00Z');
const BUSY_POLLS = 20;
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

function recordedFromOne(): Map<number, BatchResult> {
  return new Map(
    readRecorded('batches').map((b) => {
      const n = Number(b.batch_id.split(':')[1]) + 1;
      return [n, { ...b, batch_id: `${CHECK}:${n}` }];
    }),
  );
}

interface Built {
  check: {
    status: string;
    technical_seo: { score: number; grade: string; breakdown: Record<string, number> } | null;
    ai_readability: unknown;
  };
  fixes: unknown[];
  page_results: { url: string; status_code: number | null }[];
}

/** One run of the recorded site; `busy` busy answers before the worker takes any post. */
async function runOnce(busy: number) {
  persisted.length = 0;
  const clock = { now: T0 };
  const iso = () => new Date(clock.now).toISOString();
  const { worker, refuse } = fakeWorker(recordedFromOne());
  for (let i = 0; i < busy; i++) refuse.push('busy');
  const { store } = memoryStore(
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
  const built = (persisted[0] as { built: Built } | undefined)?.built ?? null;
  return { result, ids, built, refusedLeft: refuse.length };
}

/** What a visitor is told: the grades, the four components and the findings. */
const answer = (b: Built) => ({
  status: b.check.status,
  technical_seo: b.check.technical_seo && {
    score: b.check.technical_seo.score,
    grade: b.check.technical_seo.grade,
    breakdown: b.check.technical_seo.breakdown,
  },
  ai_readability: b.check.ai_readability,
  fixes: b.fixes,
  pages: b.page_results.map((p) => [p.url, p.status_code]).sort(),
});

describe('the accuracy guard: waiting for a crawler does not change the answer (CC-42A decision 6)', () => {
  it('the wait the waited run makes is past the old crawl window and inside the wait budget', () => {
    const waitedS = BUSY_POLLS * PACE.busyWaitS;
    expect(waitedS).toBeGreaterThan(CRAWL_CEILING_S);
    expect(waitedS).toBeLessThan(QUEUE_WAIT_MAX_S);
  });

  it('a check that waited 20 busy answers for its first batch gets the same answer as one that did not', async () => {
    const alone = await runOnce(0);
    const waited = await runOnce(BUSY_POLLS);
    expect(alone.built).not.toBeNull();
    expect(waited.result).toEqual(alone.result);
    expect(waited.built).not.toBeNull();
    expect(answer(waited.built!)).toEqual(answer(alone.built!));
    // The worker really did refuse: every busy answer was spent, on sleeps the run took.
    expect(waited.refusedLeft).toBe(0);
    expect(waited.ids.filter((id) => /-busy-\d+$/.test(id))).toHaveLength(BUSY_POLLS);
    expect(alone.ids.some((id) => /-busy-/.test(id))).toBe(false);
    // Not two empty answers that agree: the alone run is graded, with the four components, and
    // finds something to fix on more than one crawled page.
    expect(alone.built!.fixes.length).toBeGreaterThan(0);
    expect(alone.built!.page_results.length).toBeGreaterThan(1);
    expect(alone.built!.check.technical_seo).not.toBeNull();
    expect(Object.keys(alone.built!.check.technical_seo!.breakdown).sort()).toEqual([
      'anchorDiversityScore',
      'depthScore',
      'orphanRatioScore',
      'structureScore',
    ]);
  });
});
