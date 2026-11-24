/**
 * Row 23: the daily sentinel's work, with the store, the worker and the pipeline's request as
 * fakes. Which sites are due, what a look posts to the worker, how its result is compared, and what
 * starts a full check.
 */
import { describe, expect, it } from 'vitest';
import type { Verdict } from '@crawlmouse/types/v2';
import {
  WorkerError,
  type BatchPost,
  type PollResult,
  type WorkerClient,
} from '../../worker-client/types';
import { sentinelHour } from './sentinel';
import {
  SENTINEL_LOOK_BUDGET,
  SENTINEL_PAGE,
  SENTINEL_SEND_CHUNK,
  lookCheckId,
  sentinelWork,
  type BaselineTest,
  type SentinelDeps,
  type WatchableSite,
} from './sentinel-work';

const NOW = Date.parse('2026-11-24T06:30:00Z');
const DAY = '2026-11-24';
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
const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => id(from + i));
/** Site ids due at 06:00 UTC, and one that is not. */
const DUE = ids(0, 400).filter((s) => sentinelHour(s) === 6);
const NOT_DUE = ids(0, 400).find((s) => sentinelHour(s) !== 6)!;
/** A Free site due at 06:00, from ids outside DUE's range: the hour alone would pick it. */
const FREE_DUE = ids(1000, 400).find((s) => sentinelHour(s) === 6)!;
const SITE = DUE[0]!;

const site = (siteId: string, account: Record<string, unknown> = PRO): WatchableSite => ({
  siteId,
  host: 'shop.lab.crawlmouse.com',
  account,
});

const tested = (over: Partial<BaselineTest> = {}): BaselineTest => ({
  identity_role: 'crawler',
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
  sites: WatchableSite[] = [...DUE.map((s) => site(s)), site(NOT_DUE), site(FREE_DUE, FREE)],
) {
  const posted: BatchPost[] = [];
  const requested: { siteId: string; day: string }[] = [];
  const sent: { id: string; data: { siteId: string; day: string } }[][] = [];
  const offsets: number[] = [];
  let postError: WorkerError | null = null;
  const worker: WorkerClient = {
    postBatch: async (b) => {
      posted.push(b);
      if (postError) throw postError;
      return { batch_id: `${b.check_id}:${b.batch}`, signals: false };
    },
    pollBatch: async () => poll,
    readProgress: async () => null,
    readMetrics: async () => null,
  };
  const deps: SentinelDeps = {
    store: {
      watchableSites: async (offset) => (
        offsets.push(offset),
        sites.slice(offset, offset + SENTINEL_PAGE)
      ),
      baseline: async () => ({
        checkId: 'full-1',
        host: 'shop.lab.crawlmouse.com',
        tests: [tested()],
      }),
      testsOf: async (checkId) => (checkId === 'full-1' ? [tested()] : []),
    },
    shown: () => true,
    paused: () => false,
    now: () => NOW,
    worker: () => worker,
    nonce: () => 'n'.repeat(32),
    global: async () => true,
    request: async (siteId, day) => (requested.push({ siteId, day }), `check-${siteId}`),
    send: async (events) => void sent.push(events),
    ...over,
  };
  return {
    work: sentinelWork(deps),
    posted,
    requested,
    sent,
    offsets,
    failPost: (e: WorkerError) => (postError = e),
  };
}

const done = (verdict: Verdict, words = 500): PollResult => ({
  status: 'done',
  result: {
    kind: 'access',
    access_tests: [
      { identity_role: 'crawler', ua: 'GPTBot', template_key: '/', verdict, word_count: words },
    ],
  },
});

describe('dispatch', () => {
  it('sends one watch per paid site due this hour, keyed on the site and the day', async () => {
    const { work, sent } = harness();
    expect(DUE.length).toBeGreaterThan(0);
    expect(await work.dispatch(6, DAY)).toEqual({ watched: DUE.length });
    expect(sent.flat()).toEqual(
      DUE.map((siteId) => ({
        id: `sentinel-watch:${siteId}:${DAY}`,
        name: 'sentinel.watch',
        data: { siteId, day: DAY },
      })),
    );
  });

  it('reads every page of sites and sends in chunks, so neither bounds how many are watched', async () => {
    const many = ids(5000, 3 * SENTINEL_PAGE + 7).map((s) => site(s));
    const due = many.filter((s) => sentinelHour(s.siteId) === 6).length;
    const { work, sent, offsets } = harness({}, undefined, many);
    expect(await work.dispatch(6, DAY)).toEqual({ watched: due });
    expect(offsets).toEqual([0, SENTINEL_PAGE, 2 * SENTINEL_PAGE, 3 * SENTINEL_PAGE]);
    expect(sent.every((chunk) => chunk.length <= SENTINEL_SEND_CHUNK)).toBe(true);
    expect(sent.flat()).toHaveLength(due);
  });

  it('sends nothing while the sentinel is hidden or crawling is paused', async () => {
    const hidden = harness({ shown: () => false });
    expect(await hidden.work.dispatch(6, DAY)).toEqual({ skip: 'hidden' });
    expect(hidden.sent).toEqual([]);
    expect(await harness({ paused: () => true }).work.dispatch(6, DAY)).toEqual({
      skip: 'crawl_paused',
    });
  });
});

describe('look', () => {
  it("posts the full check's pages, one per template, under the look's id for the watch's day", async () => {
    const { work, posted } = harness();
    const out = await work.look(SITE, DAY, 1);
    const check = lookCheckId(SITE, DAY, 1);
    expect(out).toEqual({ batchId: `${check}:0`, baseline: 'full-1' });
    expect(posted).toEqual([
      {
        kind: 'access',
        check_id: check,
        site_id: SITE,
        site_host: 'shop.lab.crawlmouse.com',
        batch: 0,
        nonce: 'n'.repeat(32),
        budget: SENTINEL_LOOK_BUDGET,
        pages: [{ template_key: '/', url: 'https://shop.lab.crawlmouse.com/' }],
      },
    ]);
  });

  it("uses the watch's day, not the clock's, after midnight", async () => {
    const { work, posted } = harness({ now: () => Date.parse('2026-11-25T00:05:00Z') });
    await work.look(SITE, DAY, 1);
    expect(posted[0]!.check_id).toBe(lookCheckId(SITE, DAY, 1));
  });

  it('gives each look of a day its own id, and the next day another', () => {
    const looks = [
      lookCheckId(SITE, DAY, 1),
      lookCheckId(SITE, DAY, 2),
      lookCheckId(SITE, '2026-11-25', 1),
      lookCheckId(id(999), DAY, 1),
    ];
    expect(new Set(looks).size).toBe(4);
  });

  it('reads the batch it already posted when a retry finds it there', async () => {
    const h = harness();
    h.failPost(new WorkerError('batch_exists', 409, 'batch_exists'));
    expect(await h.work.look(SITE, DAY, 1)).toEqual({
      batchId: `${lookCheckId(SITE, DAY, 1)}:0`,
      baseline: 'full-1',
    });
  });

  it('skips a look the worker is too busy to take, as no evidence', async () => {
    const h = harness();
    h.failPost(new WorkerError('busy', 429, 'busy'));
    expect(await h.work.look(SITE, DAY, 1)).toEqual({ skip: 'worker_busy' });
  });

  it('throws on any other refusal, so the step retries', async () => {
    const h = harness();
    h.failPost(new WorkerError('server', 500, null));
    await expect(h.work.look(SITE, DAY, 1)).rejects.toThrow(WorkerError);
  });

  it.each<[string, Partial<SentinelDeps>]>([
    ['hidden', { shown: () => false }],
    ['crawl_paused', { paused: () => true }],
    ['no_worker', { worker: () => null }],
  ])('looks at nothing when %s', async (skip, over) => {
    const h = harness(over);
    expect(await h.work.look(SITE, DAY, 1)).toEqual({ skip });
    expect(h.posted).toEqual([]);
  });

  it('skips a site with no full check to compare with', async () => {
    const { work } = harness({
      store: {
        watchableSites: async () => [],
        baseline: async () => null,
        testsOf: async () => [],
      },
    });
    expect(await work.look(SITE, DAY, 1)).toEqual({ skip: 'no_baseline' });
  });
});

describe('result', () => {
  it('waits while the batch runs', async () => {
    const { work } = harness();
    expect(await work.result('full-1', 'b:0')).toEqual({ status: 'running' });
  });

  it('finds nothing moved when every crawler reads as the full check did', async () => {
    const { work } = harness({}, done('allowed'));
    expect(await work.result('full-1', 'b:0')).toEqual({ status: 'done', moved: 0 });
  });

  it('counts a crawler that became blocked', async () => {
    const { work } = harness({}, done('disallowed_by_robots'));
    expect(await work.result('full-1', 'b:0')).toEqual({ status: 'done', moved: 1 });
  });

  it('counts a template whose text went', async () => {
    const { work } = harness({}, done('allowed', 40));
    expect(await work.result('full-1', 'b:0')).toEqual({ status: 'done', moved: 1 });
  });

  it('compares with the full check the look was made from, not a newer one', async () => {
    const { work } = harness({}, done('disallowed_by_robots'));
    expect(await work.result('other-check', 'b:0')).toEqual({ status: 'done', moved: 0 });
  });

  it.each<[PollResult]>([
    [{ status: 'failed' }],
    [{ status: 'not_found' }],
    [{ status: 'done', result: { kind: 'crawl' } }],
  ])('reads a look that did not end well as no evidence: %j', async (poll) => {
    const { work } = harness({}, poll);
    expect(await work.result('full-1', 'b:0')).toEqual({ status: 'failed' });
  });
});

describe('request', () => {
  it("starts one full check keyed on the watch's day", async () => {
    const { work, requested } = harness({ now: () => Date.parse('2026-11-25T00:05:00Z') });
    expect(await work.request(SITE, DAY)).toEqual({ checkId: `check-${SITE}` });
    expect(requested).toEqual([{ siteId: SITE, day: DAY }]);
  });

  it.each<[string, Partial<SentinelDeps>]>([
    ['capacity', { global: async () => false }],
    ['crawl_paused', { paused: () => true }],
    ['hidden', { shown: () => false }],
  ])('starts none with %s', async (skip, over) => {
    const h = harness(over);
    expect(await h.work.request(SITE, DAY)).toEqual({ skip });
    expect(h.requested).toEqual([]);
  });
});
