/**
 * The reader's link walk feeds the engine's MainContentWalk, and the simhash reads the main content
 * it gives (`mainTextStart`). That must be extractMainContent's text, cut at HASHED_TEXT_CHARS: on
 * every corpus document the worker parses (packages/engine/fixtures/v2/main-content), and on
 * generated pages.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { extractMainContent } from '../../../engine/src/analysis/ai-readiness/main-content.js';
import { HASHED_TEXT_CHARS, readLinks } from './links.js';
import { parseHtml } from './text.js';

const CORPUS: string[] = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL('../../../engine/fixtures/v2/main-content/corpus.json.gz', import.meta.url),
    ),
  ).toString('utf8'),
);

const BASE = 'https://a.test/';
const expected = (html: string) =>
  extractMainContent(parseHtml(html)!).text.slice(0, HASHED_TEXT_CHARS);
const fromWalk = (html: string) => readLinks(parseHtml(html)!, BASE).mainTextStart;

describe('the main content the reader hashes', () => {
  it('is extractMainContent’s, cut at HASHED_TEXT_CHARS, on every corpus document the worker parses', () => {
    const differ: number[] = [];
    let tooDeep = 0;
    CORPUS.forEach((html, i) => {
      if (parseHtml(html) === null) tooDeep++;
      else if (fromWalk(html) !== expected(html)) differ.push(i);
    });
    expect(differ).toEqual([]);
    // Documents nested past MAX_DOM_DEPTH, which the worker does not read: stated, not skipped.
    expect(tooDeep).toBe(TOO_DEEP);
  }, 600_000);

  it('is the same on generated pages of links, menus and prose', () => {
    const block = fc.oneof(
      fc.constantFrom('Some prose here.', '  \n ', 'w', '<nav><a href="/n">Nav</a></nav>'),
      fc
        .array(fc.constantFrom('Home', 'About us', 'A longer card title and its blurb'), {
          minLength: 1,
          maxLength: 5,
        })
        .map((ls) => `<ul>${ls.map((t, i) => `<li><a href="/l${i}">${t}</a></li>`).join('')}</ul>`),
    );
    fc.assert(
      fc.property(fc.array(block, { maxLength: 12 }), fc.boolean(), (blocks, body) => {
        const html = body ? `<body>${blocks.join('')}</body>` : blocks.join('');
        expect(fromWalk(html)).toBe(expected(html));
      }),
      { numRuns: 2000 },
    );
  });

  it('a page whose main content runs past the cap is hashed on its first HASHED_TEXT_CHARS', () => {
    const html = `<body><p>${'word '.repeat(HASHED_TEXT_CHARS)}</p></body>`;
    expect(fromWalk(html)).toHaveLength(HASHED_TEXT_CHARS);
    expect(fromWalk(html)).toBe(expected(html));
  });
});

/** Measured: the corpus documents parseHtml refuses as nested past MAX_DOM_DEPTH. */
const TOO_DEEP = 2;
