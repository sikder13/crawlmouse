/**
 * Row 23: the daily sentinel's work, with the store, the worker and the pipeline's request as
 * fakes. Which sites are due, what a look posts to the worker, how its result is compared, and what
 * starts a full check.
 */
import { describe, expect, it } from 'vitest';
import type { Verdict } from '@crawlmouse/types/v2';
import type { BatchPost, PollResult, WorkerClient } from '../../worker-client/types';
import { sentinelHour } from './sentinel';
import {
  SENTINEL_LOOK_BUDGET,
  lookCheckId,
  sentinelWork,
  type BaselineTest,
  type SentinelDeps,
  type WatchableSite,
} from './sentinel-work';

const NOW = Date.parse('2026-11-24T06:30:00Z');
const PRO = {
  state: 'pro',
  tier: 'pro',
  past_due_tier: null,
  past_due_since: null,
  trial_variant: null,
  trial_ends_at: null,
};
const FREE = { ...PRO, state: 'free', tier: 'free' };

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Site ids due at 06:00 UTC, and one that is not. */
const DUE = Array.from({ length: 400 }, (_, i) => id(i)).filter((s) => sentinelHour(s) === 6);
const NOT_DUE = Array.from({ length: 400 }, (_, i) => id(i)).find((s) => sentinelHour(s) !== 6)!;
/** A Free site due at 06:00, from ids outside DUE's range: the hour alone would pick it. */
const FREE_DUE = Array.from({ length: 400 }, (_, i) => id(1000 + i)).find(
  (s) => sentinelHour(s) === 6,
)!;

const site = (siteId: string, account = PRO): WatchableSite => ({
  siteId,
  host: 'shop.lab.crawlmouse.com',
  account,
});

const test = (over: Partial<BaselineTest> = {}): BaselineTest => ({
  ua: 'GPTBot',
  template_key: '/',
  page_url: 'https://shop.lab.crawlmouse.com/',
  verdict: 'allowed',
  word_count: 500,
  ...over,
});

function harness(
  over: Partial<SentinelDeps> = {},
  poll: PollResult = { status: 'running', progress: null },
) {
  const posted: BatchPost[] = [];
  const requested: { siteId: string; day: string }[] = [];
  const worker: WorkerClient = {
    postBatch: async (b) => {
      posted.push(b);
      return { batch_id: `${b.check_id}:${b.batch}`, signals: false };
    },
    pollBatch: async () => poll,
    readProgress: async () => null,
    readMetrics: async () => null,
  };
  const deps: SentinelDeps = {
    store: {
      watchableSites: async (offset) =>
        offset === 0 ? [...DUE.map((s) => site(s)), site(NOT_DUE), site(FREE_DUE, FREE)] : [],
      baseline: async () => ({
        checkId: 'full-1',
        host: 'shop.lab.crawlmouse.com',
        tests: [test()],
      }),
    },
    shown: () => true,
    paused: () => false,
    now: () => NOW,
    worker: () => worker,
    nonce: () => 'n'.repeat(32),
    global: async () => true,
    request: async (siteId, day) => (requested.push({ siteId, day }), `check-${siteId}`),
    ...over,
  };
  return { work: sentinelWork(deps), posted, requested };
}

const done = (verdict: Verdict, words = 500): PollResult => ({
  status: 'done',
  result: {
    kind: 'access',
    access_tests: [{ ua: 'GPTBot', template_key: '/', verdict, word_count: words }],
  },
});

describe('due', () => {
  it('names the paid sites watched this hour, and no other', async () => {
    const { work } = harness();
    expect(DUE.length).toBeGreaterThan(0);
    expect(await work.due(6)).toEqual({ siteIds: DUE });
  });

  it('names none while the sentinel is hidden or crawling is paused', async () => {
    expect(await harness({ shown: () => false }).work.due(6)).toEqual({ skip: 'hidden' });
    expect(await harness({ paused: () => true }).work.due(6)).toEqual({ skip: 'crawl_paused' });
  });
});

describe('plan', () => {
  it("picks the full check's pages, one per template", async () => {
    const { work } = harness();
    expect(await work.plan(DUE[0]!)).toEqual({
      host: 'shop.lab.crawlmouse.com',
      baseline: 'full-1',
      pages: [{ template_key: '/', url: 'https://shop.lab.crawlmouse.com/' }],
    });
  });

  it('skips a site with no full check to compare with', async () => {
    const { work } = harness({
      store: { watchableSites: async () => [], baseline: async () => null },
    });
    expect(await work.plan(DUE[0]!)).toEqual({ skip: 'no_baseline' });
  });
});

describe('look', () => {
  it('posts one access batch under a look id of its own, on the site’s host, within its budget', async () => {
    const { work, posted } = harness();
    const pages = [{ template_key: '/', url: 'https://shop.lab.crawlmouse.com/' }];
    const out = await work.look(DUE[0]!, 'shop.lab.crawlmouse.com', pages, 1);
    const check = lookCheckId(DUE[0]!, '2026-11-24', 1);
    expect(out).toEqual({ batchId: `${check}:0` });
    expect(posted).toEqual([
      {
        kind: 'access',
        check_id: check,
        site_id: DUE[0],
        site_host: 'shop.lab.crawlmouse.com',
        batch: 0,
        nonce: 'n'.repeat(32),
        budget: SENTINEL_LOOK_BUDGET,
        pages,
      },
    ]);
  });

  it('gives each look of a day its own id, and the next day another', () => {
    const ids = [
      lookCheckId(DUE[0]!, '2026-11-24', 1),
      lookCheckId(DUE[0]!, '2026-11-24', 2),
      lookCheckId(DUE[0]!, '2026-11-25', 1),
      lookCheckId(DUE[1] ?? id(999), '2026-11-24', 1),
    ];
    expect(new Set(ids).size).toBe(4);
  });

  it('looks at nothing when no worker is configured', async () => {
    const { work } = harness({ worker: () => null });
    expect(await work.look(DUE[0]!, 'h.example', [], 1)).toEqual({ skip: 'no_worker' });
  });
});

describe('result', () => {
  it('waits while the batch runs', async () => {
    const { work } = harness();
    expect(await work.result(DUE[0]!, 'b:0')).toEqual({ status: 'running' });
  });

  it('finds nothing moved when every crawler reads as the full check did', async () => {
    const { work } = harness({}, done('allowed'));
    expect(await work.result(DUE[0]!, 'b:0')).toEqual({ status: 'done', moved: 0 });
  });

  it('counts a crawler that became blocked', async () => {
    const { work } = harness({}, done('disallowed_by_robots'));
    expect(await work.result(DUE[0]!, 'b:0')).toEqual({ status: 'done', moved: 1 });
  });

  it('counts a template whose text went', async () => {
    const { work } = harness({}, done('allowed', 40));
    expect(await work.result(DUE[0]!, 'b:0')).toEqual({ status: 'done', moved: 1 });
  });

  it.each<[PollResult, string]>([
    [{ status: 'failed' }, 'failed'],
    [{ status: 'not_found' }, 'failed'],
    [{ status: 'done', result: { kind: 'crawl' } }, 'failed'],
  ])('reads a look that did not end well as no evidence: %j', async (poll, status) => {
    const { work } = harness({}, poll);
    expect(await work.result(DUE[0]!, 'b:0')).toEqual({ status });
  });
});

describe('request', () => {
  it('starts one full check, keyed on the UTC day', async () => {
    const { work, requested } = harness();
    expect(await work.request(DUE[0]!)).toEqual({ checkId: `check-${DUE[0]}` });
    expect(requested).toEqual([{ siteId: DUE[0], day: '2026-11-24' }]);
  });

  it('starts none over the day’s ceiling or while crawling is paused', async () => {
    expect(await harness({ global: async () => false }).work.request(DUE[0]!)).toEqual({
      skip: 'capacity',
    });
    expect(await harness({ paused: () => true }).work.request(DUE[0]!)).toEqual({
      skip: 'crawl_paused',
    });
  });
});
