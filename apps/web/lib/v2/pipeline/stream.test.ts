import { randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  INITIAL_STATE,
  PHASES,
  ProgressEventSchema,
  reduce,
  type CrawlState,
  type ProgressEvent,
} from '../progress';
import { gzipJson } from './evidence';
import {
  BATCH_GZIP_BYTES,
  BATCH_RAW_BYTES,
  START,
  batchEvents,
  checkEvents,
  withLiveCounts,
  cursorFits,
  factsOf,
  formatCursor,
  nextEvents,
  parseCursor,
  readBatch,
  type CheckFacts,
  type Cursor,
  type StoredBatch,
} from './stream';
import { STARTED, crawlResult, edge, row, urlOf, type RowSpec } from './stream.fixtures';
import { memoryEvidenceStore } from './test-support/memory-evidence';
import type { StreamSnapshot } from './stream-store';

/** The user agent the recorded crawl rows were fetched with, written out. */
const CRAWL_UA = 'Mozilla/5.0 (compatible; Crawlmouse/2.0; +https://crawlmouse.com/bot)';

type StepState = 'done' | 'now' | 'next';
const stepsAt = (now: number) =>
  PHASES.map((phase, i) => ({
    phase,
    state: (i < now ? 'done' : i === now ? 'now' : 'next') as StepState,
  }));

const running = (now: number, pages: number, links: number, elapsedMs: number): CheckFacts => ({
  status: 'running',
  steps: stepsAt(now),
  counts: { pages_crawled: pages, links_found: links },
  elapsedMs,
  waitingSinceMs: null,
  discovered: null,
});

const stage = (phase: string, state: 'now' | 'done', at_ms: number) => ({
  type: 'stage',
  at_ms,
  phase,
  state,
});

describe('nextEvents, against events written out by hand', () => {
  it('a running check on its first poll: the batch, then the stages, then the counts', () => {
    const batch: StoredBatch = {
      batch: 1,
      result: crawlResult(
        [
          // A fetched 404: the worker read no links, so the row has no link count.
          row({ path: '/b', at: 2000, status: 404, links: null }),
          row({ path: '/', at: 500, ms: 80, links: 4 }),
          row({ path: '/blocked', at: 700, outcome: 'robots_disallowed', status: null }),
        ],
        [edge('/', '/b'), edge('/', '/'), edge('/', '/b'), edge('/b', '/c', true)],
      ),
    };
    const out = nextEvents(START, {
      check: running(2, 2, 3, 9000),
      startedAtMs: STARTED,
      batches: [batch],
    });
    expect(out.events).toEqual([
      {
        type: 'page_fetched',
        at_ms: 500,
        url: urlOf('/'),
        identity: CRAWL_UA,
        purpose: 'crawl',
        status: 200,
        ms: 80,
        links: 4,
      },
      { type: 'page_linked', at_ms: 500, url: urlOf('/b'), from: urlOf('/'), via: 'link' },
      { type: 'page_linked', at_ms: 2000, url: urlOf('/c'), from: urlOf('/b'), via: 'javascript' },
      stage('robots_and_sitemap', 'now', 9000),
      stage('robots_and_sitemap', 'done', 9000),
      stage('homepage', 'now', 9000),
      stage('homepage', 'done', 9000),
      stage('crawl', 'now', 9000),
      { type: 'counts', at_ms: 9000, pages_crawled: 2, links_found: 3 },
    ]);
    expect(formatCursor(out.cursor)).toBe('2.1.5.2.3.9000.0.0');
  });

  it('a page whose links were not read in full is not sent with its partial count', () => {
    const cut = { ...row({ path: '/long', at: 900, links: 7 }), links_read: false };
    const out = nextEvents(START, {
      check: running(2, 2, 3, 9000),
      startedAtMs: STARTED,
      batches: [{ batch: 1, result: crawlResult([row({ path: '/', at: 500 }), cut], []) }],
    });
    const fetched = out.events.filter((e) => e.type === 'page_fetched').map((e) => e.url);
    expect(fetched).toEqual([urlOf('/')]);
  });

  it('a check already finished on the first poll: both batches before any stage, then the end', () => {
    const out = nextEvents(START, {
      check: {
        status: 'finished',
        steps: null,
        counts: { pages_crawled: 2, links_found: 1 },
        elapsedMs: 60_000,
        waitingSinceMs: null,
        discovered: null,
      },
      startedAtMs: STARTED,
      batches: [
        { batch: 1, result: crawlResult([row({ path: '/', at: 400 })], [edge('/', '/x')]) },
        { batch: 2, result: crawlResult([row({ path: '/x', at: 30_000 })], []) },
      ],
    });
    expect(out.events.map((e) => (e.type === 'stage' ? `${e.phase}:${e.state}` : e.type))).toEqual([
      'page_fetched',
      'page_linked',
      'page_fetched',
      'robots_and_sitemap:now',
      'robots_and_sitemap:done',
      'homepage:now',
      'homepage:done',
      'crawl:now',
      'crawl:done',
      'crawler_tests:now',
      'crawler_tests:done',
      'without_js:now',
      'without_js:done',
      'grading:now',
      'grading:done',
      'counts',
      'ended',
    ]);
    expect(out.events.at(-1)).toEqual({ type: 'ended', at_ms: 60_000, status: 'finished' });
    expect(formatCursor(out.cursor)).toBe('2.2.12.2.1.60000.1.0');
  });

  it('a poll that missed two phases sends the stages between, in order', () => {
    const at: Cursor = { ...START, step: 3, at: 1000 };
    expect(checkEvents(at, running(3, 0, 0, 5000)).events).toEqual([
      stage('homepage', 'done', 5000),
      stage('crawl', 'now', 5000),
      stage('crawl', 'done', 5000),
      stage('crawler_tests', 'now', 5000),
    ]);
  });

  it('a check cancelled while queued sends the end alone', () => {
    const out = checkEvents(START, {
      status: 'failed',
      steps: null,
      counts: null,
      elapsedMs: 0,
      waitingSinceMs: null,
      discovered: null,
    });
    expect(out.events).toEqual([{ type: 'ended', at_ms: 0, status: 'failed' }]);
    expect(out.cursor.ended).toBe(true);
  });

  it('a failed check leaves its open step open and keeps the counts it had', () => {
    const at: Cursor = { ...START, batch: 1, step: 5, pages: 7, links: 9, at: 4000 };
    const out = checkEvents(at, {
      status: 'failed',
      steps: null,
      counts: { pages_crawled: 7, links_found: 9 },
      elapsedMs: 6000,
      waitingSinceMs: null,
      discovered: null,
    });
    expect(out.events).toEqual([{ type: 'ended', at_ms: 6000, status: 'failed' }]);
    expect(out.cursor.step).toBe(5);
  });

  it('a queued check sends nothing and leaves the cursor as it was', () => {
    const out = nextEvents(START, {
      check: {
        status: 'queued',
        steps: null,
        counts: null,
        elapsedMs: 0,
        waitingSinceMs: null,
        discovered: null,
      },
      startedAtMs: null,
      batches: [],
    });
    expect(out).toEqual({ events: [], cursor: START });
  });

  it('time does not go back: a row fetched before the last event sent is stamped with the last', () => {
    const at: Cursor = { ...START, step: 5, at: 9000 };
    const out = nextEvents(at, {
      check: running(2, 1, 0, 5000),
      startedAtMs: STARTED,
      batches: [{ batch: 1, result: crawlResult([row({ path: '/', at: 500 })], []) }],
    });
    expect(out.events.map((e) => e.at_ms)).toEqual([9000, 9000]);
  });

  it('counts do not fall when the row holds lower ones than were sent', () => {
    const at: Cursor = { ...START, step: 5, pages: 50, links: 400, at: 100 };
    expect(checkEvents(at, running(2, 40, 500, 200)).events).toEqual([
      { type: 'counts', at_ms: 200, pages_crawled: 50, links_found: 500 },
    ]);
  });

  describe('the homepage step, while the first batch runs', () => {
    const onHomepage: CheckFacts = {
      status: 'running',
      steps: [
        { phase: 'robots_and_sitemap', state: 'done' },
        { phase: 'homepage', state: 'now' },
        { phase: 'crawl', state: 'next' },
      ],
      counts: null,
      elapsedMs: 10,
      waitingSinceMs: null,
      discovered: null,
    };

    it('stays until a page has been read', () => {
      const out = checkEvents(START, withLiveCounts(onHomepage, { pages: 0, links: 0 }));
      expect(out.events.at(-1)).toEqual(stage('homepage', 'now', 10));
    });

    it('ends when the first page is read, and the crawl is under way', () => {
      const out = checkEvents(START, withLiveCounts(onHomepage, { pages: 1, links: 0 }));
      const stages = out.events.filter((e) => e.type === 'stage');
      expect(stages.at(-2)).toEqual(stage('homepage', 'done', 10));
      expect(stages.at(-1)).toEqual(stage('crawl', 'now', 10));
    });

    it('leaves a later step alone', () => {
      const later: CheckFacts = {
        ...onHomepage,
        steps: [
          { phase: 'homepage', state: 'done' },
          { phase: 'crawl', state: 'done' },
          { phase: 'crawler_tests', state: 'now' },
        ],
      };
      expect(withLiveCounts(later, { pages: 3, links: 0 }).steps).toEqual(later.steps);
    });
  });

  it('a running check is not taken past the crawler tests, whatever its stored steps say', () => {
    const facts: CheckFacts = {
      status: 'running',
      steps: [{ phase: 'grading', state: 'now' }],
      counts: null,
      elapsedMs: 10,
      waitingSinceMs: null,
      discovered: null,
    };
    const out = checkEvents(START, facts);
    expect(out.events.at(-1)).toEqual(stage('crawler_tests', 'done', 10));
    expect(out.cursor.step).toBe(8);
  });

  it('a viewer who was sent the end gets it again, alone; a batch is not sent after it', () => {
    const ended: Cursor = {
      ...START,
      batch: 1,
      step: 12,
      pages: 1,
      links: 0,
      at: 700,
      ended: true,
    };
    const out = nextEvents(ended, {
      check: {
        status: 'partial',
        steps: null,
        counts: null,
        elapsedMs: 900,
        waitingSinceMs: null,
        discovered: null,
      },
      startedAtMs: STARTED,
      batches: [{ batch: 2, result: crawlResult([row({ path: '/late', at: 100 })], []) }],
    });
    expect(out).toEqual({
      events: [{ type: 'ended', at_ms: 700, status: 'partial' }],
      cursor: ended,
    });
  });

  it('a batch that was not read moves the cursor and sends nothing', () => {
    expect(batchEvents(START, { batch: 3, result: null }, STARTED)).toEqual({
      events: [],
      cursor: { ...START, batch: 3 },
    });
  });
});

describe('waiting and discovery (CC-42A decisions 4 and 5)', () => {
  const found = { robots_txt: 'found' as const, sitemap_urls: 1240 };

  it('what discovery found is sent once, with the stage that says discovery is done', () => {
    const facts: CheckFacts = { ...running(1, 0, 0, 4000), discovered: found };
    const first = nextEvents(START, { check: facts, startedAtMs: STARTED, batches: [] });
    expect(first.events).toEqual([
      stage('robots_and_sitemap', 'now', 4000),
      stage('robots_and_sitemap', 'done', 4000),
      { type: 'discovered', at_ms: 4000, ...found },
      stage('homepage', 'now', 4000),
    ]);
    const again = nextEvents(first.cursor, {
      check: { ...facts, elapsedMs: 5000 },
      startedAtMs: STARTED,
      batches: [],
    });
    expect(again.events.filter((e) => e.type === 'discovered')).toEqual([]);
  });

  it('a row without discovery fields sends no discovery event', () => {
    const out = nextEvents(START, {
      check: running(1, 0, 0, 4000),
      startedAtMs: STARTED,
      batches: [],
    });
    expect(out.events.some((e) => e.type === 'discovered')).toBe(false);
  });

  it('a wait is sent when it begins and when it ends, once each', () => {
    const waiting: CheckFacts = { ...running(1, 0, 0, 70_000), waitingSinceMs: 62_000 };
    const a = nextEvents(START, { check: waiting, startedAtMs: STARTED, batches: [] });
    expect(a.events.at(-1)).toEqual({ type: 'waiting', at_ms: 70_000, since_ms: 62_000 });
    expect(formatCursor(a.cursor)).toBe('2.0.3.0.0.70000.0.62001');
    // Still waiting, the same wait: nothing new.
    const b = nextEvents(a.cursor, {
      check: { ...waiting, elapsedMs: 100_000 },
      startedAtMs: STARTED,
      batches: [],
    });
    expect(b.events).toEqual([]);
    // The worker took the batch.
    const c = nextEvents(b.cursor, {
      check: { ...waiting, elapsedMs: 130_000, waitingSinceMs: null },
      startedAtMs: STARTED,
      batches: [],
    });
    expect(c.events).toEqual([{ type: 'waiting', at_ms: 130_000, since_ms: null }]);
    expect(c.cursor.waitingSince).toBeNull();
  });

  it('a wait whose stored start is later than the event carrying it is clamped to that event', () => {
    const cursor: Cursor = { ...START, step: 3, at: 50_000 };
    const out = nextEvents(cursor, {
      check: { ...running(1, 0, 0, 40_000), waitingSinceMs: 60_000 },
      startedAtMs: STARTED,
      batches: [],
    });
    const w = out.events.find((e) => e.type === 'waiting')!;
    expect(w).toEqual({ type: 'waiting', at_ms: 50_000, since_ms: 50_000 });
  });

  it('an ended check sends no wait', () => {
    const out = nextEvents(START, {
      check: { ...running(1, 0, 0, 9000), status: 'failed', waitingSinceMs: 5000 },
      startedAtMs: STARTED,
      batches: [],
    });
    expect(out.events.some((e) => e.type === 'waiting')).toBe(false);
  });
});

describe('factsOf: the wait and discovery from a stored row (CC-42A)', () => {
  const stored = (
    progress: Partial<NonNullable<StreamSnapshot['progress']>> | null,
  ): StreamSnapshot => ({
    siteId: 's',
    accountId: null,
    siteRemoved: false,
    status: 'running',
    progress:
      progress === null
        ? null
        : {
            steps: [],
            pages_crawled: 0,
            links_found: 0,
            waiting_since: null,
            sitemap_urls: null,
            robots_txt: null,
            ...progress,
          },
    startedAt: new Date(STARTED).toISOString(),
    finishedAt: null,
    expiresAt: null,
    batches: [],
  });

  it('gives the wait as ms from the start, and discovery as stored', () => {
    const facts = factsOf(
      stored({
        waiting_since: new Date(STARTED + 62_000).toISOString(),
        sitemap_urls: 1240,
        robots_txt: 'found',
      }),
      STARTED + 90_000,
    );
    expect(facts.waitingSinceMs).toBe(62_000);
    expect(facts.discovered).toEqual({ robots_txt: 'found', sitemap_urls: 1240 });
  });

  it('gives no wait and no discovery for a row without them, or an unreadable time', () => {
    expect(factsOf(stored({}), STARTED)).toMatchObject({ waitingSinceMs: null, discovered: null });
    expect(factsOf(stored({ waiting_since: 'not a time' }), STARTED).waitingSinceMs).toBeNull();
    expect(factsOf(stored(null), STARTED)).toMatchObject({
      waitingSinceMs: null,
      discovered: null,
    });
  });
});

describe('the cursor as text', () => {
  it('round-trips', () => {
    fc.assert(
      fc.property(
        fc.record({
          batch: fc.nat(1_000_000),
          step: fc.nat(12),
          pages: fc.nat(100_000),
          links: fc.nat(10_000_000),
          at: fc.nat(3_600_000),
          ended: fc.boolean(),
          waitingSince: fc.option(fc.nat(3_600_000), { nil: null }),
        }),
        (c) => {
          expect(parseCursor(formatCursor(c))).toEqual(c);
        },
      ),
    );
  });

  it('refuses what formatCursor does not write', () => {
    for (const bad of [
      '',
      '1',
      '2.0.0.0.0.0.0',
      '2.0.13.0.0.0.0.0',
      '1.0.0.0.0.0.2',
      '1.-1.0.0.0.0.0',
      '1.0.0.0.0.0.0.0',
      '1.1e3.0.0.0.0.0',
      ' 1.0.0.0.0.0.0',
      '1.0.0.0.0.0.0\n',
    ]) {
      expect(parseCursor(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('still reads a cursor of the format before the wait was carried: no wait sent', () => {
    expect(parseCursor('1.2.5.40.300.61000.0')).toEqual({
      batch: 2,
      step: 5,
      pages: 40,
      links: 300,
      at: 61000,
      ended: false,
      waitingSince: null,
    });
  });

  it('fits a check that stores its batch, and says ended only of an ended check', () => {
    const c = (batch: number, ended = false): Cursor => ({ ...START, batch, ended });
    expect(cursorFits(c(0), 'queued', [])).toBe(true);
    expect(cursorFits(c(2), 'running', [1, 2])).toBe(true);
    expect(cursorFits(c(3), 'running', [1, 2])).toBe(false);
    expect(cursorFits(c(1, true), 'running', [1])).toBe(false);
    for (const status of ['finished', 'partial', 'failed'] as const) {
      expect(cursorFits(c(1, true), status, [1])).toBe(true);
    }
  });
});

// ─── The property: any run a real check can produce folds through `reduce` ───────────────────────

interface GenRow {
  drawable: 'yes' | 'no_status' | 'no_timing' | 'no_links';
  outcome: 'fetched' | 'failed' | 'robots_disallowed';
  dt: number;
}
interface GenBatch {
  read: boolean;
  rows: GenRow[];
  /** `from` indexes this batch's rows; `to` is a path anywhere in the run, or the row itself. */
  edges: { from: number; to: number; self: boolean; js: boolean }[];
}
interface GenPoll {
  started: boolean;
  phases: number;
  batches: number;
  pages: number;
  links: number;
  ms: number;
  wait: number | null;
}
interface GenRun {
  batches: GenBatch[];
  polls: GenPoll[];
  end: 'finished' | 'partial' | 'failed' | null;
  discovered: { robots_txt: 'found' | 'not_found' | 'unreadable'; sitemap_urls: number } | null;
}

const rowArb: fc.Arbitrary<GenRow> = fc.record({
  drawable: fc.constantFrom('yes', 'yes', 'yes', 'no_status', 'no_timing', 'no_links'),
  outcome: fc.constantFrom('fetched', 'fetched', 'fetched', 'failed', 'robots_disallowed'),
  dt: fc.nat(40_000),
});
const batchArb: fc.Arbitrary<GenBatch> = fc.record({
  read: fc.boolean(),
  rows: fc.array(rowArb, { maxLength: 5 }),
  edges: fc.array(
    fc.record({ from: fc.nat(4), to: fc.nat(30), self: fc.boolean(), js: fc.boolean() }),
    { maxLength: 8 },
  ),
});
const runArb: fc.Arbitrary<GenRun> = fc
  .record({
    batches: fc.array(batchArb, { maxLength: 4 }),
    polls: fc.array(
      fc.record({
        started: fc.boolean(),
        phases: fc.nat(3),
        batches: fc.nat(2),
        pages: fc.nat(60),
        links: fc.nat(900),
        ms: fc.nat(90_000),
        /** The stored wait's start, ms from the check's start; null when not waiting. */
        wait: fc.option(fc.nat(400_000), { nil: null }),
      }),
      { maxLength: 7 },
    ),
    end: fc.constantFrom('finished', 'partial', 'failed', null),
    /** What the stored progress says discovery found; null for a row without the fields. */
    discovered: fc.option(
      fc.record({
        robots_txt: fc.constantFrom('found' as const, 'not_found' as const, 'unreadable' as const),
        sitemap_urls: fc.nat(5000),
      }),
      { nil: null },
    ),
  })
  .filter((r) => r.polls.length > 0 || r.end !== null);

const pathOf = (batch: number, i: number) => `/p-${batch}-${i}`;

function specOf(batch: number, i: number, g: GenRow): RowSpec {
  return {
    path: pathOf(batch, i),
    at: g.dt,
    outcome: g.outcome,
    status: g.drawable === 'no_status' ? null : 200,
    ms: g.drawable === 'no_timing' ? null : 50,
    links: g.drawable === 'no_links' ? null : 2,
  };
}

/** The run's stored batches, numbered from 1, and its edges as [from, to] paths. */
function world(run: GenRun) {
  const every = run.batches.flatMap((b, bi) => b.rows.map((_, i) => pathOf(bi + 1, i)));
  const stored = run.batches.map((b, bi) => {
    const edges = b.rows.length
      ? b.edges.map((e) => {
          const from = pathOf(bi + 1, e.from % b.rows.length);
          const to = e.self ? from : (every[e.to % every.length] ?? from);
          return { from, to, js: e.js };
        })
      : [];
    return {
      batch: bi + 1,
      read: b.read,
      specs: b.rows.map((g, i) => specOf(bi + 1, i, g)),
      gen: b.rows,
      edges,
    };
  });
  return stored;
}

/** Plays the run as the route does: one poll after another, resuming from the cursor as text. */
function play(run: GenRun) {
  const stored = world(run);
  const toBatch = (s: (typeof stored)[number]): StoredBatch => ({
    batch: s.batch,
    result: s.read
      ? crawlResult(
          s.specs.map(row),
          s.edges.map((e) => edge(e.from, e.to, e.js)),
        )
      : null,
  });
  let cursor = START;
  let state: CrawlState = INITIAL_STATE;
  const sent: ProgressEvent[] = [];
  let started = false;
  let phase = 0;
  let have = 0;
  let pages = 0;
  let links = 0;
  let ms = 0;
  let lastWait: number | null = null;
  let discoveredSent = false;
  const poll = (check: CheckFacts, fold = true) => {
    // A reconnect at this point: the cursor goes out as text and comes back.
    cursor = parseCursor(formatCursor(cursor))!;
    const out = nextEvents(cursor, {
      check,
      startedAtMs: started ? STARTED : null,
      batches: stored
        .slice(0, have)
        .filter((b) => b.batch > cursor.batch)
        .map(toBatch),
    });
    for (const e of out.events) {
      ProgressEventSchema.parse(e);
      if (!fold) continue;
      state = reduce(state, e);
      sent.push(e);
    }
    cursor = out.cursor;
    return out.events;
  };
  for (const p of run.polls) {
    started ||= p.started;
    if (!started) {
      poll({
        status: 'queued',
        steps: null,
        counts: null,
        elapsedMs: 0,
        waitingSinceMs: null,
        discovered: null,
      });
      continue;
    }
    phase = Math.min(3, phase + p.phases);
    // A batch is stored only once the crawl has begun (the homepage batch is the first).
    if (phase >= 1) have = Math.min(stored.length, have + p.batches);
    pages += p.pages;
    links += p.links;
    ms += p.ms;
    const out = poll({
      ...running(phase, pages, links, ms),
      waitingSinceMs: p.wait,
      discovered: run.discovered,
    });
    if (out.some((e) => e.type === 'discovered')) discoveredSent = true;
    lastWait = p.wait;
  }
  let again: ProgressEvent[] | null = null;
  if (run.end !== null) {
    const graded = run.end !== 'failed';
    if (graded) have = stored.length;
    const facts: CheckFacts = {
      status: run.end,
      steps: null,
      counts: started ? { pages_crawled: pages, links_found: links } : null,
      elapsedMs: ms + 1,
      waitingSinceMs: null,
      discovered: null,
    };
    started = true;
    poll(facts);
    // A reconnect after the end: what it is sent is checked below, not folded.
    again = poll(facts, false);
  }
  return {
    stored,
    have,
    state,
    sent,
    cursor,
    phase,
    pages,
    links,
    again,
    everStarted: started,
    lastWait,
    discoveredSent,
  };
}

describe('nextEvents over generated runs (fast-check)', () => {
  it('folds through reduce, ends where the last snapshot is, and sends no event twice', () => {
    fc.assert(
      fc.property(runArb, (run) => {
        const { stored, have, state, sent, phase, pages, links, again } = play(run);
        const ran = run.polls.some((p) => p.started);

        // Steps and counts are the last snapshot's.
        const expectedSteps =
          run.end === 'finished' || run.end === 'partial'
            ? PHASES.map((p) => ({ phase: p, state: 'done' }))
            : ran
              ? stepsAt(phase)
              : PHASES.map((p) => ({ phase: p, state: 'next' }));
        expect(state.steps).toEqual(expectedSteps);
        expect([state.pages_crawled, state.links_found]).toEqual(ran ? [pages, links] : [0, 0]);
        expect(state.ended).toBe(run.end);

        // No event is sent twice; after the end, a reconnect gets the end alone. A wait may begin
        // again after it ended, so waits are checked apart: each one sent changes the wait.
        const once = sent.filter((e) => e.type !== 'waiting');
        expect(new Set(once.map((e) => JSON.stringify(e))).size).toBe(once.length);
        const waits = sent.flatMap((e) => (e.type === 'waiting' ? [e.since_ms] : []));
        for (let i = 1; i < waits.length; i++) expect(waits[i]).not.toBe(waits[i - 1]);
        expect(waits[0]).not.toBeNull();

        // The wait is the last poll's, clamped to the latest event's time, and the viewer's state
        // and the cursor agree on it; an end clears it.
        const { lastWait, cursor } = play(run);
        expect(state.waiting_since_ms).toBe(cursor.waitingSince);
        if (run.end !== null || !ran || lastWait === null) {
          expect(state.waiting_since_ms).toBeNull();
        } else {
          expect(state.waiting_since_ms).toBe(Math.min(lastWait, cursor.at));
        }

        // Discovery's findings land once, as stored, exactly when a running poll got past
        // discovery: worked out from the generated run, not from what the function sent.
        let reachedDiscovery = false;
        let begun = false;
        let at = 0;
        for (const p of run.polls) {
          begun ||= p.started;
          if (!begun) continue;
          at = Math.min(3, at + p.phases);
          if (at >= 1) reachedDiscovery = true;
        }
        const expectDiscovered = run.discovered !== null && reachedDiscovery;
        expect(sent.filter((e) => e.type === 'discovered').length).toBe(expectDiscovered ? 1 : 0);
        expect(state.discovery).toEqual(expectDiscovered ? run.discovered : null);
        if (again) expect(again).toEqual([sent.at(-1)]);

        // The map, computed from the generated rows without the function under test: one node for
        // each fetched row that holds a status, a time and a link count, in a batch that was read.
        const delivered = stored.slice(0, have).filter((b) => b.read);
        const drawn = delivered.flatMap((b) =>
          b.specs
            .filter((_, i) => b.gen[i]!.outcome === 'fetched' && b.gen[i]!.drawable === 'yes')
            .map((s) => urlOf(s.path)),
        );
        expect(state.nodes.map((n) => n.url).sort()).toEqual([...drawn].sort());
        const edges = delivered.flatMap((b) => b.edges.filter((e) => e.from !== e.to));
        for (const node of state.nodes) {
          const reaching = edges.filter((e) => urlOf(e.to) === node.url);
          if (reaching.length === 0) {
            expect(node.from).toBeNull();
          } else {
            expect(reaching.map((e) => urlOf(e.from))).toContain(node.from);
            expect(node.from).not.toBe(node.url);
          }
        }
      }),
      { numRuns: 400 },
    );
  });

  it('the generator reaches the cases the rules name', () => {
    const seen = {
      skip: 0,
      endedFirst: 0,
      unread: 0,
      undrawable: 0,
      self: 0,
      failedAt: new Set<number>(),
      waitEnded: 0,
      waitAtEnd: 0,
      discovered: 0,
    };
    fc.assert(
      fc.property(runArb, (run) => {
        if (run.polls.some((p) => p.started && p.phases > 1)) seen.skip++;
        if (run.polls.every((p) => !p.started) && run.end !== null) seen.endedFirst++;
        if (run.batches.some((b) => !b.read)) seen.unread++;
        if (run.batches.some((b) => b.rows.some((r) => r.drawable !== 'yes'))) seen.undrawable++;
        if (run.batches.some((b) => b.rows.length > 0 && b.edges.some((e) => e.self))) seen.self++;
        if (run.end === 'failed') seen.failedAt.add(play(run).phase);
        const ws = run.polls.filter((p) => p.started).map((p) => p.wait);
        if (ws.some((w, i) => w !== null && ws[i + 1] === null)) seen.waitEnded++;
        if (run.end !== null && ws.at(-1) != null) seen.waitAtEnd++;
        if (play(run).discoveredSent) seen.discovered++;
      }),
      { numRuns: 400 },
    );
    expect(seen.skip).toBeGreaterThan(0);
    expect(seen.endedFirst).toBeGreaterThan(0);
    expect(seen.unread).toBeGreaterThan(0);
    expect(seen.undrawable).toBeGreaterThan(0);
    expect(seen.self).toBeGreaterThan(0);
    expect([...seen.failedAt].sort()).toEqual([0, 1, 2, 3]);
    expect(seen.waitEnded).toBeGreaterThan(0);
    expect(seen.waitAtEnd).toBeGreaterThan(0);
    expect(seen.discovered).toBeGreaterThan(0);
  });
});

describe('readBatch', () => {
  const PATH = 'anon/s/c/batch-1.json.gz';
  const result = crawlResult([row({ path: '/', at: 1 })], [edge('/', '/a')]);

  it('reads a stored crawl batch result', async () => {
    const evidence = memoryEvidenceStore();
    await evidence.put(PATH, gzipJson(result));
    const got = await readBatch(evidence, PATH);
    expect(got?.pages.map((p) => p.url)).toEqual([urlOf('/')]);
    expect(got?.link_edges).toHaveLength(1);
  });

  it('throws when the object cannot be read: a missing object, or a request that failed', async () => {
    await expect(readBatch(memoryEvidenceStore(), PATH)).rejects.toThrow(
      `evidence: get ${PATH}: not found`,
    );
    const failing = {
      get: async () => {
        throw new Error('storage: connection reset');
      },
    };
    await expect(readBatch(failing, PATH)).rejects.toThrow('storage: connection reset');
  });

  it('answers null for an object that was read and is not a crawl batch’s contract result', async () => {
    const evidence = memoryEvidenceStore();
    await evidence.put(PATH, gzipJson({ ...result, pages: [{ url: 'nope' }] }));
    expect(await readBatch(evidence, PATH)).toBeNull();
    await evidence.put(PATH, gzipSync(Buffer.from('not json')));
    expect(await readBatch(evidence, PATH)).toBeNull();
    await evidence.put(PATH, new Uint8Array([1, 2, 3]));
    expect(await readBatch(evidence, PATH)).toBeNull();
  });

  it('passes over a contract result whose object is larger than the gzipped bound', async () => {
    // 100 rows of served text that does not compress: a valid result, about 4.8 MiB gzipped and
    // 6.4 MiB inflated, so the gzipped bound is the one it is over.
    const noisy = (pages: number) =>
      gzipJson(
        crawlResult(
          Array.from({ length: pages }, (_, i) => ({
            ...row({ path: `/n/${i}`, at: i }),
            raw_text: randomBytes(48 * 1024).toString('base64'),
          })),
          [],
        ),
      );
    const over = noisy(100);
    expect(over.byteLength).toBeGreaterThan(BATCH_GZIP_BYTES);
    expect(gunzipSync(over).byteLength).toBeLessThan(BATCH_RAW_BYTES);
    expect(await readBatch({ get: async () => over }, PATH)).toBeNull();
    const under = noisy(50);
    expect(under.byteLength).toBeLessThan(BATCH_GZIP_BYTES);
    expect((await readBatch({ get: async () => under }, PATH))?.pages).toHaveLength(50);
  });

  it('passes over an object that inflates past the raw bound', async () => {
    // The same contract result followed by 17 MiB of spaces, which JSON allows: it gzips to a few
    // kilobytes, inside the gzipped bound and over the raw one.
    const padded = (spaces: number) =>
      gzipSync(Buffer.from(JSON.stringify(result) + ' '.repeat(spaces)));
    const bomb = padded(17 * 1024 * 1024);
    expect(bomb.byteLength).toBeLessThan(BATCH_GZIP_BYTES);
    expect(await readBatch({ get: async () => bomb }, PATH)).toBeNull();
    expect(await readBatch({ get: async () => padded(1024) }, PATH)).not.toBeNull();
  });
});
