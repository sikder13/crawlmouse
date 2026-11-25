/**
 * The live link map with URLs as a real check writes them (c/027). The engine canonicalises a site's
 * root without its slash (`https://site.test`, packages/engine/src/url-canonical.ts), and production's
 * page rows hold it that way. The map found the home page only with the slash, so it drew no page
 * of any real check: every fixture it was tested on wrote the root as `https://…/`.
 *
 * Every URL here is made by the engine's own `canonicalizeUrl`, so the tests hold the form a check
 * stores, whatever that function decides, rather than a form written out by hand.
 */
import { describe, expect, it } from 'vitest';
import { canonicalizeUrl } from '@crawlmouse/engine';
import { layoutInput } from './map-layout';
import { INITIAL_STATE, reduce, type MapNode } from './progress';
import { START, nextEvents } from './pipeline/stream';
import { ORIGIN, STARTED, crawlResult, edge, row, urlOf } from './pipeline/stream.fixtures';

const SITE = 'https://site.test';
const real = (path: string) => canonicalizeUrl(`${SITE}${path}`);

const node = (url: string, from: string | null): MapNode => ({
  url,
  from,
  via: from === null ? null : 'link',
  kind: 'page',
});

describe('the map finds the home page as a real check writes it', () => {
  it('the engine writes the root without its slash (the case this file is about)', () => {
    expect(real('/')).toBe('https://site.test');
  });

  it('the stream’s fixtures write URLs as a check stores them, root and all', () => {
    // They wrote `https://stream.test/` until c/027, the one form no real check holds.
    expect(urlOf('/')).toBe(ORIGIN);
    expect(urlOf('/')).toBe(canonicalizeUrl(`${ORIGIN}/`));
    expect(row({ path: '/', at: 0 }).url).toBe(ORIGIN);
  });

  it('draws the home page at depth 0 and the pages its links reach below it', () => {
    const home = real('/');
    const a = real('/shop/');
    const b = real('/shop/lamps/');
    const input = layoutInput([node(home, null), node(a, home), node(b, a)]);
    expect(input.map((n) => [n.id, n.depth, n.parent])).toEqual([
      [home, 0, null],
      [a, 1, home],
      [b, 2, a],
    ]);
  });

  it('still finds a root written with its slash, as the recordings write it', () => {
    const input = layoutInput([
      node('https://site.test/', null),
      node('https://site.test/a', 'https://site.test/'),
    ]);
    expect(input.map((n) => n.depth)).toEqual([0, 1]);
  });

  it('takes no other page for the home page', () => {
    for (const url of [
      'https://site.test/a',
      'https://site.test/?page=2',
      'https://site.test/#top',
      'https://site.test//',
    ]) {
      expect(layoutInput([node(url, null)]), url).toEqual([]);
    }
  });
});

describe('a stored batch of real URLs, through the stream and the screen, to the map', () => {
  it('draws every fetched page a link from the home page reaches', () => {
    const at = (path: string, ms: number) => ({
      ...row({ path, at: ms }),
      url: real(path),
      final_url: real(path),
    });
    const link = (from: string, to: string) => ({
      ...edge(from, to),
      from_url: real(from),
      to_url: real(to),
    });
    const result = crawlResult(
      [at('/', 500), at('/shop/', 900), at('/shop/lamps/', 1300), at('/about/', 1700)],
      [link('/', '/shop/'), link('/', '/about/'), link('/shop/', '/shop/lamps/')],
    );
    const { events } = nextEvents(START, {
      check: {
        status: 'running',
        steps: null,
        counts: { pages_crawled: 4, links_found: 3 },
        elapsedMs: 9000,
        waitingSinceMs: null,
        discovered: null,
      },
      startedAtMs: STARTED,
      batches: [{ batch: 1, result }],
    });
    const state = events.reduce(reduce, INITIAL_STATE);
    expect(state.nodes.map((n) => n.url)).toEqual([
      real('/'),
      real('/shop/'),
      real('/shop/lamps/'),
      real('/about/'),
    ]);
    expect(layoutInput(state.nodes).map((n) => [n.id, n.depth])).toEqual([
      [real('/'), 0],
      [real('/shop/'), 1],
      [real('/shop/lamps/'), 2],
      [real('/about/'), 1],
    ]);
  });
});
