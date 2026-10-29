import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CheckPhaseSchema, ProgressSchema } from '@crawlmouse/types/v2';
import {
  INITIAL_STATE,
  PHASES,
  ProgressEventSchema,
  RECENT_FETCHES_IN_PROGRESS,
  reduce,
  stateAt,
  toProgress,
  type ProgressEvent,
} from './progress';

const URL_A = 'https://example.test/';
const URL_B = 'https://example.test/b';

/** A small stream that exercises every event type once, in a legal order. */
const STREAM: ProgressEvent[] = [
  { type: 'stage', at_ms: 0, phase: 'robots_and_sitemap', state: 'now' },
  { type: 'pages_estimated', at_ms: 900, pages: 2 },
  {
    type: 'crawler_verdict',
    at_ms: 900,
    ua: 'Googlebot',
    group: 'search_engine',
    scored: false,
    verdict: 'allowed',
    evidence_class: 'declared',
    status: null,
    pages_measured: 2,
  },
  { type: 'stage', at_ms: 1000, phase: 'robots_and_sitemap', state: 'done' },
  { type: 'stage', at_ms: 1000, phase: 'homepage', state: 'now' },
  {
    type: 'page_fetched',
    at_ms: 1400,
    url: URL_A,
    identity: 'browser',
    purpose: 'crawl',
    status: 200,
    ms: 380,
    links: 4,
  },
  { type: 'counts', at_ms: 1400, pages_crawled: 1, links_found: 4 },
  { type: 'stage', at_ms: 1500, phase: 'homepage', state: 'done' },
  { type: 'stage', at_ms: 1500, phase: 'crawl', state: 'now' },
  {
    type: 'page_fetched',
    at_ms: 2000,
    url: URL_B,
    identity: 'browser',
    purpose: 'crawl',
    status: 200,
    ms: 120,
    links: 3,
  },
  { type: 'counts', at_ms: 2000, pages_crawled: 2, links_found: 6 },
  { type: 'page_linked', at_ms: 2000, url: URL_B, from: URL_A, via: 'link' },
  { type: 'page_classified', at_ms: 2100, url: URL_B, as: 'orphan' },
  { type: 'stage', at_ms: 2200, phase: 'crawl', state: 'done' },
  { type: 'stage', at_ms: 2200, phase: 'crawler_tests', state: 'now' },
  {
    type: 'page_fetched',
    at_ms: 2600,
    url: URL_A,
    identity: 'GPTBot',
    purpose: 'test',
    status: 403,
    ms: 90,
    links: 0,
  },
  {
    type: 'crawler_verdict',
    at_ms: 2600,
    ua: 'GPTBot',
    group: 'ai_training',
    scored: false,
    verdict: 'blocked_by_ua_rule',
    evidence_class: 'simulated',
    status: 403,
    pages_measured: 1,
  },
  {
    type: 'finding',
    at_ms: 2650,
    fingerprint: '0f1e000000000001',
    title: 'Let GPTBot through',
    section: 'crawler_access',
    affected_pages: 2,
  },
  { type: 'stage', at_ms: 3000, phase: 'crawler_tests', state: 'done' },
  { type: 'stage', at_ms: 3000, phase: 'without_js', state: 'now' },
  { type: 'stage', at_ms: 3500, phase: 'without_js', state: 'done' },
  { type: 'stage', at_ms: 3500, phase: 'grading', state: 'now' },
  { type: 'stage', at_ms: 4000, phase: 'grading', state: 'done' },
  {
    type: 'graded',
    at_ms: 4000,
    technical_seo: {
      score: 70,
      grade: 'B-',
      breakdown: { orphanRatioScore: 1, depthScore: 1, anchorDiversityScore: 1, structureScore: 1 },
      refusal: { refused: false, triggers: [], confidenceCapped: false, unevaluable: [] },
      site_structure_score: 70,
    },
    ai_readability: {
      withheld: false,
      total: 50,
      grade: 'D+',
      components: {
        access: { score: 20, max: 40, heuristic: false },
        readable: { score: 15, max: 30, heuristic: false },
        quotable: { score: 10, max: 20, heuristic: true },
        signals: { score: 5, max: 10, heuristic: false },
      },
      access_range: null,
    },
  },
  { type: 'ended', at_ms: 4000, status: 'finished' },
];

describe('the progress-event contract', () => {
  it('parses every event of a stream that uses each event type', () => {
    for (const e of STREAM) expect(ProgressEventSchema.safeParse(e).success, e.type).toBe(true);
    const types = new Set(STREAM.map((e) => e.type));
    expect([...types].sort()).toEqual(
      ProgressEventSchema.options.map((o) => o.shape.type.value).sort(),
    );
  });

  it('rejects an event with a field it does not define', () => {
    expect(
      ProgressEventSchema.safeParse({
        type: 'counts',
        at_ms: 0,
        pages_crawled: 1,
        links_found: 1,
        x: 1,
      }).success,
    ).toBe(false);
  });

  it('lists the six phases in the contract order', () => {
    expect(PHASES).toEqual(CheckPhaseSchema.options);
  });
});

describe('the reducer', () => {
  const end = stateAt(STREAM, Infinity);

  it('applies an event that lands exactly at the requested moment, and none after it', () => {
    expect(stateAt(STREAM, 1999).pages_crawled).toBe(1);
    expect(stateAt(STREAM, 2000).pages_crawled).toBe(2);
  });

  it('marks each phase next, now, then done as its stage events land', () => {
    expect(stateAt(STREAM, 0).steps.map((s) => s.state)).toEqual([
      'now',
      'next',
      'next',
      'next',
      'next',
      'next',
    ]);
    expect(stateAt(STREAM, 1500).steps.map((s) => s.state)).toEqual([
      'done',
      'done',
      'now',
      'next',
      'next',
      'next',
    ]);
    expect(end.steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('adds a map node when the crawl fetches a page, not when a crawler test requests it', () => {
    expect(end.nodes.map((n) => n.url)).toEqual([URL_A, URL_B]);
    expect(end.fetches.filter((f) => f.url === URL_A)).toHaveLength(2);
  });

  it('attaches a page to the page whose link reached it, and records its classification', () => {
    const b = end.nodes.find((n) => n.url === URL_B);
    expect(b).toMatchObject({ from: URL_A, via: 'link', kind: 'orphan' });
  });

  it('keeps verdicts, findings and grades, and stops the clock at the end', () => {
    expect(Object.keys(end.verdicts)).toEqual(['Googlebot', 'GPTBot']);
    expect(end.findings.map((f) => f.title)).toEqual(['Let GPTBot through']);
    expect(end.grades?.technical_seo.grade).toBe('B-');
    expect(end.ended).toBe('finished');
    expect(stateAt(STREAM, 99_000).elapsed_ms).toBe(4000);
    expect(stateAt(STREAM, 1234).elapsed_ms).toBe(1234);
  });

  it('is pure: the same events give the same state, and the initial state is left as it was', () => {
    const once = stateAt(STREAM, 2600);
    const twice = stateAt(STREAM, 2600);
    expect(twice).toEqual(once);
    expect(INITIAL_STATE.nodes).toEqual([]);
  });

  it('never lets a counter fall or the elapsed time run backwards (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 5000 }), { minLength: 2, maxLength: 20 }),
        (ts) => {
          const sorted = [...ts].sort((a, b) => a - b);
          let prev = stateAt(STREAM, sorted[0]!);
          for (const t of sorted.slice(1)) {
            const next = stateAt(STREAM, t);
            if (next.pages_crawled < prev.pages_crawled) return false;
            if (next.links_found < prev.links_found) return false;
            if (next.elapsed_ms < prev.elapsed_ms) return false;
            prev = next;
          }
          return true;
        },
      ),
    );
  });

  it('rejects a stage that runs out of the contract order', () => {
    expect(() =>
      reduce(INITIAL_STATE, { type: 'stage', at_ms: 0, phase: 'crawl', state: 'now' }),
    ).toThrow(/crawl/);
  });

  it('rejects a page linked from itself', () => {
    expect(() =>
      reduce(INITIAL_STATE, {
        type: 'page_linked',
        at_ms: 0,
        url: URL_A,
        from: URL_A,
        via: 'link',
      }),
    ).toThrow(/itself/);
  });

  it('rejects events that go back in time', () => {
    const s = reduce(INITIAL_STATE, STREAM[0]!);
    expect(() => reduce(s, { ...STREAM[0]!, at_ms: -1 } as ProgressEvent)).toThrow(/back in time/);
  });

  /** The stream up to (not including) its first event of `type`, applied. */
  const before = (type: ProgressEvent['type']) =>
    STREAM.slice(
      0,
      STREAM.findIndex((e) => e.type === type),
    ).reduce(reduce, INITIAL_STATE);
  const graded = STREAM.find((e) => e.type === 'graded')!;
  const ended = STREAM.find((e) => e.type === 'ended')!;

  it('rejects a change to the map once grading has begun, and nothing else', () => {
    const grading = before('graded');
    const at_ms = grading.last_ms;
    const fetched = (url: string, purpose: 'crawl' | 'test') =>
      ({
        type: 'page_fetched',
        at_ms,
        url,
        identity: 'browser',
        purpose,
        status: 200,
        ms: 100,
        links: 0,
      }) as ProgressEvent;
    expect(() => reduce(grading, fetched('https://example.test/late', 'crawl'))).toThrow(
      /after grading began/,
    );
    expect(() =>
      reduce(grading, { type: 'page_classified', at_ms, url: URL_B, as: 'orphan' }),
    ).toThrow(/after grading began/);
    // A request that adds no page, and a page fetched again, change nothing on the map.
    expect(reduce(grading, fetched('https://example.test/late', 'test')).nodes).toBe(grading.nodes);
    expect(reduce(grading, fetched(URL_A, 'crawl')).nodes).toBe(grading.nodes);
  });

  it('rejects counts that fall', () => {
    const s = stateAt(STREAM, 2000);
    expect(() =>
      reduce(s, { type: 'counts', at_ms: 2000, pages_crawled: 1, links_found: 6 }),
    ).toThrow(/fall/);
    expect(() =>
      reduce(s, { type: 'counts', at_ms: 2000, pages_crawled: 2, links_found: 5 }),
    ).toThrow(/fall/);
  });

  it('rejects a page classified before it was fetched', () => {
    expect(() =>
      reduce(stateAt(STREAM, 1400), {
        type: 'page_classified',
        at_ms: 1400,
        url: URL_B,
        as: 'orphan',
      }),
    ).toThrow(/before it was fetched/);
  });

  it('accepts nothing after the end', () => {
    const end = stateAt(STREAM, Infinity);
    for (const e of [
      { type: 'counts', at_ms: 4000, pages_crawled: 999, links_found: 999 },
      {
        ...STREAM.find((x) => x.type === 'page_fetched')!,
        at_ms: 4000,
        url: 'https://example.test/c',
      },
      { ...ended, status: 'failed' },
      graded,
    ] as ProgressEvent[]) {
      expect(() => reduce(end, e), e.type).toThrow(/after the stream ended/);
    }
  });

  it('grades once, and only once grading has started', () => {
    expect(() => reduce(before('graded'), graded)).not.toThrow();
    expect(() => reduce(reduce(before('graded'), graded), graded)).toThrow(/Graded twice/);
    expect(() => reduce(stateAt(STREAM, 3000), { ...graded, at_ms: 3000 })).toThrow(
      /before grading/,
    );
  });

  it('takes one verdict per crawler and one finding per fingerprint', () => {
    const verdict = STREAM.find((e) => e.type === 'crawler_verdict' && e.ua === 'GPTBot')!;
    const finding = STREAM.find((e) => e.type === 'finding')!;
    const s = stateAt(STREAM, 2650);
    expect(() => reduce(s, { ...verdict, at_ms: 2650 })).toThrow(/GPTBot.*twice/);
    expect(() => reduce(s, { ...finding, at_ms: 2650 })).toThrow(/0f1e000000000001.*twice/);
  });

  it('ends finished or partial only once every step is done; a failure may end anywhere', () => {
    const early = stateAt(STREAM, 3000);
    for (const status of ['finished', 'partial'] as const) {
      expect(() => reduce(early, { ...ended, at_ms: 3000, status })).toThrow(/not done/);
    }
    expect(reduce(early, { ...ended, at_ms: 3000, status: 'failed' }).ended).toBe('failed');
  });
});

describe('the projection onto the contract Progress', () => {
  it('validates against ProgressSchema at every event of the stream', () => {
    for (const e of STREAM) {
      const p = toProgress(stateAt(STREAM, e.at_ms));
      const r = ProgressSchema.safeParse(p);
      expect(r.success, `${e.type} at ${e.at_ms}`).toBe(true);
    }
  });

  it('carries only the latest fetches, oldest first, without identity or timing', () => {
    const p = toProgress(stateAt(STREAM, 2600));
    expect(p.recent_fetches.length).toBeLessThanOrEqual(RECENT_FETCHES_IN_PROGRESS);
    expect(p.recent_fetches.at(-1)).toEqual({ url: URL_A, status: 403, links: 0 });
    expect(Object.keys(p.recent_fetches[0]!).sort()).toEqual(['links', 'status', 'url']);
  });
});
