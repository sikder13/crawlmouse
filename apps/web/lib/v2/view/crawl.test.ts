import { describe, expect, it } from 'vitest';
import { findCheck, fixture } from '../fixtures';
import { INITIAL_STATE, reduce } from '../progress';
import { RECORDING_NAMES, recording, recordingSpec } from '../recordings';
import { LOG_LINES, LOG_PATH_MAX, crawlFrame, shortPath } from './crawl';

describe('a log line’s path', () => {
  it('is shown whole up to the limit', () => {
    const p = '/products/ridge-2p';
    expect(shortPath(p)).toBe(p);
    const exact = `/${'a'.repeat(LOG_PATH_MAX - 1)}`;
    expect(shortPath(exact)).toBe(exact);
  });

  it('keeps the start and end of a longer one, the cut marked, within the limit', () => {
    const s = shortPath('/journal/layering-for-shoulder-season');
    expect(s).toBe('/journal/lay…lder-season');
    expect(s.length).toBe(LOG_PATH_MAX);
    expect(s.startsWith('/journal/')).toBe(true);
    expect(s.endsWith('-season')).toBe(true);
  });
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
      const tests = recording(name).events.some((e) => e.type === 'page_fetched' && e.purpose === 'test');
      if (tests) expect(mixed).toBeGreaterThan(0);
    });
  }
});
