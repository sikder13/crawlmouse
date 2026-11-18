import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { findCheck, fixture } from '../fixtures';
import { INITIAL_STATE, reduce } from '../progress';
import { RECORDING_NAMES, recording, recordingSpec } from '../recordings';
import { LOG_LINES, LOG_LINE_MAX, crawlFrame, shortPath } from './crawl';

const MAX = 24;

describe('a log line’s path', () => {
  it('is shown whole up to the limit', () => {
    const p = '/products/ridge-2p';
    expect(shortPath(p, MAX)).toBe(p);
    const exact = `/${'a'.repeat(MAX - 1)}`;
    expect(shortPath(exact, MAX)).toBe(exact);
  });

  it('keeps its first folder and its end from a word boundary, the cut marked, within the limit', () => {
    expect(shortPath('/journal/layering-for-shoulder-season', MAX)).toBe('/journal/…season');
    expect(shortPath('/collections/mesa-trail-tables', 20)).toBe('/collections/…tables');
  });

  it('drops the folder rather than the page name when no word of the end fits beside it', () => {
    expect(shortPath('/collections/trail-stoves', 18)).toBe('/…trail-stoves');
    // A single word longer than the room: its end, the one cut inside a word.
    const long = `/a/${'x'.repeat(30)}`;
    expect(shortPath(long, 16)).toBe(`/…${'x'.repeat(14)}`);
  });

  it('cuts no word in two, and keeps some of the page name, for any path and limit (property)', () => {
    const word = fc.stringMatching(/^[a-z0-9]{1,12}$/);
    fc.assert(
      fc.property(
        fc.array(fc.array(word, { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 16, max: 40 }),
        (segments, max) => {
          const path = `/${segments.map((s) => s.join('-')).join('/')}`;
          const cut = shortPath(path, max);
          if (cut === path) return true;
          const [head, tail] = cut.split('…') as [string, string];
          const words = path.split(/[-/]/).filter(Boolean);
          // Each part is whole words: the head a run of the path's start, the tail of its end.
          return (
            [...cut].length <= max &&
            path.startsWith(head) &&
            path.endsWith(tail) &&
            tail !== '' &&
            /[-/]/.test(path[path.length - tail.length - 1] ?? '') &&
            (head.endsWith('/') || words.length === 0)
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('the crawler verdicts', () => {
  for (const name of RECORDING_NAMES) {
    it(`${name}: a crawler says it is being tested from its first request until its verdict`, () => {
      const spec = recordingSpec(name);
      const check = findCheck(fixture(spec.fixture), spec.shape_check_id ?? spec.check_id);
      const ctx = {
        domain: recording(name).host,
        crawlers: check.crawlers.filter((c) => c.group !== 'search_engine'),
      };
      let state = INITIAL_STATE;
      let seen = 0;
      for (const event of recording(name).events) {
        state = reduce(state, event);
        for (const v of crawlFrame(state, ctx).verdicts) {
          const asked = state.fetches.some((f) => f.purpose === 'test' && f.identity === v.ua);
          const landed = Object.hasOwn(state.verdicts, v.ua);
          expect(v.testing, `${v.ua} at ${event.at_ms}`).toBe(asked && !landed);
          if (v.testing) seen++;
        }
      }
      const tests = recording(name).events.some(
        (e) => e.type === 'page_fetched' && e.purpose === 'test',
      );
      if (tests) expect(seen).toBeGreaterThan(0);
    });
  }
});

describe('the fetch log’s lines', () => {
  for (const name of RECORDING_NAMES) {
    it(`${name}: fit the line budget at every event, a path cut only when the line needs it`, () => {
      const spec = recordingSpec(name);
      const check = findCheck(fixture(spec.fixture), spec.shape_check_id ?? spec.check_id);
      const ctx = { domain: recording(name).host, crawlers: check.crawlers };
      let state = INITIAL_STATE;
      let named = 0;
      for (const event of recording(name).events) {
        state = reduce(state, event);
        if (event.type !== 'page_fetched') continue;
        for (const l of crawlFrame(state, ctx).log.lines) {
          const shown = `${l.request} ${l.answer} ${l.time}`;
          const whole = `${l.full} ${l.answer} ${l.time}`;
          expect([...shown].length, shown).toBeLessThanOrEqual(LOG_LINE_MAX);
          // A path is cut only when the whole line would not fit.
          if (l.request !== l.full) expect([...whole].length, whole).toBeGreaterThan(LOG_LINE_MAX);
          if (!l.request.startsWith('GET ')) named++;
        }
      }
      const tests = recording(name).events.some(
        (e) => e.type === 'page_fetched' && e.purpose === 'test',
      );
      if (tests) expect(named, 'lines that name their requester were swept').toBeGreaterThan(0);
    });
  }
});

describe('the map is complete', () => {
  for (const name of RECORDING_NAMES) {
    it(`${name}: from grading on, before the grade lands, and no page or class changes after`, () => {
      const spec = recordingSpec(name);
      const check = findCheck(fixture(spec.fixture), spec.shape_check_id ?? spec.check_id);
      const ctx = { domain: recording(name).host, crawlers: check.crawlers };
      let state = INITIAL_STATE;
      let completeAt: string | null = null;
      let grades = 0;
      for (const event of recording(name).events) {
        const before = crawlFrame(state, ctx).mapComplete;
        if (event.type === 'graded') {
          grades++;
          expect(before, 'complete before the grade lands').toBe(true);
        }
        state = reduce(state, event);
        const frame = crawlFrame(state, ctx);
        if (frame.mapComplete && completeAt === null) completeAt = JSON.stringify(state.nodes);
        if (completeAt !== null) {
          expect(frame.mapComplete).toBe(true);
          expect(JSON.stringify(state.nodes), `${event.type} at ${event.at_ms}`).toBe(completeAt);
        }
      }
      // A replay that stops mid-crawl never says so; one that grades says so before it does.
      expect(completeAt !== null).toBe(grades > 0);
    });
  }
});

describe('the fetch log names who asked', () => {
  // Written out here rather than read from crawl.ts, so the test does not agree with a wrong rule.
  const HEADING: Record<string, string> = {
    browser: 'Recent fetches · as a browser',
    render: 'Recent fetches · rendered in a browser',
  };
  const headingFor = (identity: string) => HEADING[identity] ?? `Recent fetches · as ${identity}`;

  for (const name of RECORDING_NAMES) {
    it(`${name}: at every event, one requester in the heading or each line names its own`, () => {
      const spec = recordingSpec(name);
      const check = findCheck(fixture(spec.fixture), spec.shape_check_id ?? spec.check_id);
      const ctx = {
        domain: recording(name).host,
        crawlers: check.crawlers.filter((c) => c.group !== 'search_engine'),
      };
      let state = INITIAL_STATE;
      let mixed = 0;
      for (const event of recording(name).events) {
        state = reduce(state, event);
        if (event.type !== 'page_fetched') continue;
        const shown = state.fetches.slice(-LOG_LINES);
        const { log } = crawlFrame(state, ctx);
        const who = new Set(shown.map((f) => f.identity));
        if (who.size === 1) {
          expect(log.heading).toBe(headingFor(shown[0]!.identity));
          for (const line of log.lines) expect(line.request).toMatch(/^GET \//);
        } else {
          mixed++;
          expect(log.heading).toBe('Recent fetches');
          log.lines.forEach((line, i) => {
            expect(line.request.startsWith(`${shown[i]!.identity} GET /`)).toBe(true);
          });
        }
      }
      // The crawler tests interleave each crawler's request with the untagged control.
      const tests = recording(name).events.some(
        (e) => e.type === 'page_fetched' && e.purpose === 'test',
      );
      if (tests) expect(mixed).toBeGreaterThan(0);
    });
  }
});

describe('the bar at the end', () => {
  const end = (ended: 'finished' | 'partial') => ({
    ...INITIAL_STATE,
    pages_crawled: 210,
    pages_estimated: 214,
    ended,
  });
  const ctx = { domain: 'example.test', crawlers: [] };

  it('is full when the crawl finished, whatever the estimate said', () => {
    expect(crawlFrame(end('finished'), ctx).bar).toMatchObject({ value: 210, max: 210 });
  });

  it('stays at its share of the estimate when the crawl was cut short, and says of what', () => {
    const cut = crawlFrame(end('partial'), ctx);
    expect(cut.bar).toMatchObject({ value: 210, max: 214 });
    // The running wording, so the line keeps its length; the heading says it finished, partly.
    expect(cut.pagesText).toBe('210 of about 214 pages');
    expect(crawlFrame(end('finished'), ctx).pagesText).toBe('210 pages crawled');
  });
});

describe('waiting for a free crawler, and what discovery found (CC-42A decisions 4 and 5)', () => {
  const ctx = { domain: 'example.test', crawlers: [] };
  const events = (...es: Parameters<typeof reduce>[1][]) => es.reduce(reduce, INITIAL_STATE);
  const discovered = events(
    { type: 'stage', at_ms: 0, phase: 'robots_and_sitemap', state: 'now' },
    { type: 'stage', at_ms: 4000, phase: 'robots_and_sitemap', state: 'done' },
    { type: 'discovered', at_ms: 4000, robots_txt: 'found', sitemap_urls: 1240 },
    { type: 'stage', at_ms: 4000, phase: 'homepage', state: 'now' },
  );

  it('while the worker is busy, the heading is "In line" with how long it has waited', () => {
    const s = {
      ...reduce(discovered, { type: 'waiting', at_ms: 10_000, since_ms: 10_000 }),
      elapsed_ms: 100_000,
    };
    const f = crawlFrame(s, ctx);
    expect(f.heading).toBe('In line');
    expect(f.waiting).toBe('Waiting for a free crawler · 1:30');
  });

  it('names no position in line: nothing it could count is a real order', () => {
    const s = reduce(discovered, { type: 'waiting', at_ms: 10_000, since_ms: 10_000 });
    expect(crawlFrame(s, ctx).waiting).not.toMatch(/\d+\s*(ahead|before|in line)|#\d/i);
  });

  it('once a batch is taken the heading is the step under way again, with no wait line', () => {
    const s = events(
      { type: 'stage', at_ms: 0, phase: 'robots_and_sitemap', state: 'now' },
      { type: 'waiting', at_ms: 1000, since_ms: 1000 },
      { type: 'waiting', at_ms: 5000, since_ms: null },
    );
    const f = crawlFrame(s, ctx);
    expect(f.heading).toBe('Reading robots.txt');
    expect(f.waiting).toBeNull();
  });

  it('the note under the title is the elapsed time and the pages so far, not a promise', () => {
    const s = {
      ...reduce(discovered, { type: 'counts', at_ms: 47_000, pages_crawled: 12, links_found: 80 }),
      elapsed_ms: 47_000,
    };
    const { note } = crawlFrame(s, ctx).title;
    expect(note).toBe(
      '0:47 elapsed, 12 pages so far. You can leave this page; the result keeps building.',
    );
    expect(note).not.toMatch(/usually|about two minutes/i);
    const one = { ...s, pages_crawled: 1 };
    expect(crawlFrame(one, ctx).title.note).toContain('1 page so far');
  });

  it('shows what discovery found, one line for each field it recorded', () => {
    expect(crawlFrame(discovered, ctx).discovery).toEqual([
      'robots.txt found',
      'Sitemap: 1,240 URLs',
    ]);
    const lines = (
      robots_txt: 'found' | 'not_found' | 'unreadable' | null,
      sitemap_urls: number | null,
    ) => crawlFrame({ ...discovered, discovery: { robots_txt, sitemap_urls } }, ctx).discovery;
    expect(lines('not_found', 0)).toEqual(['No robots.txt', 'Sitemap: no URLs found']);
    expect(lines('unreadable', 1)).toEqual(['robots.txt could not be read', 'Sitemap: 1 URL']);
    // A field discovery did not record is not named.
    expect(lines(null, 5)).toEqual(['Sitemap: 5 URLs']);
    expect(lines('found', null)).toEqual(['robots.txt found']);
    expect(crawlFrame(INITIAL_STATE, ctx).discovery).toEqual([]);
  });

  it('every robots.txt state has a line of its own', () => {
    const states = ['found', 'not_found', 'unreadable'] as const;
    const seen = states.map(
      (robots_txt) =>
        crawlFrame({ ...discovered, discovery: { robots_txt, sitemap_urls: null } }, ctx)
          .discovery[0],
    );
    expect(new Set(seen).size).toBe(states.length);
  });

  it('an ended check is not in line', () => {
    const s = reduce(reduce(discovered, { type: 'waiting', at_ms: 10_000, since_ms: 10_000 }), {
      type: 'ended',
      at_ms: 20_000,
      status: 'failed',
    });
    const f = crawlFrame(s, ctx);
    expect(f.heading).toBe('Stopped');
    expect(f.waiting).toBeNull();
  });
});
