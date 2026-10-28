import { describe, expect, it } from 'vitest';
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

  it('keeps the start and end of a longer one, the cut marked, within the limit', () => {
    const s = shortPath('/journal/layering-for-shoulder-season', MAX);
    expect(s).toBe('/journal/lay…lder-season');
    expect(s.length).toBe(MAX);
    expect(s.startsWith('/journal/')).toBe(true);
    expect(s.endsWith('-season')).toBe(true);
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
