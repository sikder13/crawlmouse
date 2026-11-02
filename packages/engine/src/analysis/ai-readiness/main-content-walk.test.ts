/**
 * MainContentWalk gives extractMainContent's output byte for byte.
 *
 * The corpus (fixtures/v2/main-content/corpus.json.gz) is every distinct document extractMainContent
 * was handed while the engine's and the worker's test suites ran (2026-11-01, branch
 * build/cc-12b-detector-inputs): 2,618 documents, serialised with `$.html()`. Each is parsed both ways
 * the code parses pages: cheerio's default (parse5), and htmlparser2 in HTML mode as the crawl worker
 * does. The property below covers what the corpus does not: generated documents over the strip set's
 * selectors, the density rule and the whitespace `collapseWs` collapses.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as cheerio from 'cheerio';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { extractMainContent } from './main-content.js';
import { collapsedLength, MainContentWalk, STRIP_RULES, stripRules } from './main-content-walk.js';

const CORPUS: string[] = JSON.parse(
  gunzipSync(
    readFileSync(new URL('../../../fixtures/v2/main-content/corpus.json.gz', import.meta.url)),
  ).toString('utf8'),
);

/** Prefix lengths read from every corpus document: around a part, a page, and the worker's cap. */
const PREFIXES = [0, 1, 7, 100, 4096, 65_536, 65_537];

/** Corpus documents each parser throws on (measured: see the test that uses this). */
const REFUSED = { parse5: 40, htmlparser2: 0 };

const PARSERS = {
  parse5: (html: string) => cheerio.load(html),
  htmlparser2: (html: string) =>
    cheerio.load(html, { xml: { xmlMode: false, decodeEntities: true } }),
};

/**
 * htmlparser2 told to keep CDATA sections as nodes: neither parser above does, and a CDATA node is
 * the one node with children, not an element, that can sit inside a body.
 */
const withCdata = (html: string) =>
  cheerio.load(html, { xml: { xmlMode: false, decodeEntities: true, recognizeCDATA: true } });

/** A pre-order walk of the whole document, as the worker's reader makes one, feeding the collector. */
function collector($: cheerio.CheerioAPI): MainContentWalk {
  const c = new MainContentWalk();
  const stack: { node: cheerio.AnyNode; exit: boolean }[] = $.root()
    .toArray()
    .map((node) => ({ node, exit: false }));
  while (stack.length) {
    const { node, exit } = stack.pop()!;
    if (exit) {
      c.exit(node);
      continue;
    }
    c.enter(node);
    if (!('children' in node)) continue;
    stack.push({ node, exit: true });
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ node: node.children[i]!, exit: false });
    }
  }
  return c;
}

/** A document a parser refuses (parse5 throws on some numeric references) cannot be compared. */
function parsed(parse: (html: string) => cheerio.CheerioAPI, html: string) {
  try {
    return parse(html);
  } catch {
    return null;
  }
}

describe('MainContentWalk is extractMainContent', () => {
  it('the corpus holds the documents it says', () => {
    expect(CORPUS).toHaveLength(2618);
    expect(new Set(CORPUS).size).toBe(CORPUS.length);
  });

  it.each(Object.entries(PARSERS))(
    'gives the same main content on every corpus document, parsed with %s',
    (name, parse) => {
      const differ: number[] = [];
      const refused: number[] = [];
      CORPUS.forEach((html, i) => {
        const $ = parsed(parse, html);
        if ($ === null) {
          refused.push(i);
          return;
        }
        const old = extractMainContent($);
        const c = collector($);
        const same =
          JSON.stringify(c.result()) === JSON.stringify(old) &&
          PREFIXES.every((n) => c.textPrefix(n) === old.text.slice(0, n));
        if (!same) differ.push(i);
      });
      expect(differ).toEqual([]);
      // Stated, not skipped: the documents the parser itself throws on, before either path runs.
      expect(refused.length).toBe(REFUSED[name as keyof typeof PARSERS]);
    },
    600_000,
  );

  it('gives the same main content on generated documents, under both parsers', () => {
    fc.assert(
      fc.property(documentArb, fc.nat(80), (html, n) => {
        for (const parse of [...Object.values(PARSERS), withCdata]) {
          const $ = parse(html);
          const old = extractMainContent($);
          const c = collector($);
          expect(c.result()).toEqual(old);
          expect(c.textPrefix(n)).toBe(old.text.slice(0, n));
        }
      }),
      { numRuns: 3000 },
    );
  });

  it('the generator reaches what it is for: stripped elements, dropped blocks and the fallback', () => {
    const seen = { stripped: 0, dropped: 0, fallback: 0 };
    fc.assert(
      fc.property(documentArb, (html) => {
        const $ = PARSERS.htmlparser2(html);
        const c = collector($);
        c.result();
        if ($('body').find(STRIPPED_SELECTOR).length > 0) seen.stripped++;
        if (c.blocksDropped > 0) seen.dropped++;
        if (c.fellBack) seen.fallback++;
      }),
      { numRuns: 3000, seed: 7 },
    );
    expect(seen.stripped).toBeGreaterThan(100);
    expect(seen.dropped).toBeGreaterThan(20);
    expect(seen.fallback).toBeGreaterThan(0);
  });
});

describe('the strip matcher', () => {
  it('has a rule for every selector of the strip set', () => {
    expect(STRIP_RULES.length).toBe(STRIPPED_SELECTOR.split(',').length);
  });

  it('refuses a selector it cannot express, rather than matching less', () => {
    expect(() => stripRules('nav, div > p')).toThrow(/has no rule/);
    expect(() => stripRules('[role^="nav"]')).toThrow(/has no rule/);
    expect(() => stripRules('a.b')).toThrow(/has no rule/);
  });
});

describe('collapsedLength', () => {
  it('is the length of the collapsed string, over every whitespace JavaScript matches', () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom(...TEXT_UNITS), maxLength: 40 }), (s) => {
        expect(collapsedLength(s)).toBe(s.replace(/\s+/g, ' ').trim().length);
      }),
      { numRuns: 5000 },
    );
  });
});

// ─── generated documents ────────────────────────────────────────────────────────────────────────

import { AI_STRUCTURAL_STRIP, CMP_STRIP_SELECTORS } from './constants.js';

const STRIPPED_SELECTOR = `${AI_STRUCTURAL_STRIP}, ${CMP_STRIP_SELECTORS}`;

/** Every character `\s` matches, letters, and characters next to them in the tables. */
const TEXT_UNITS = [
  'a',
  'b',
  'é',
  '\u{1F600}',
  '<',
  '&amp;',
  ' ',
  '\t',
  '\n',
  '\v',
  '\f',
  '\r',
  ' ',
  ' ',
  ' ',
  ' ',
  '​',
  ' ',
  ' ',
  ' ',
  ' ',
  '　',
  '﻿',
  '\u0085',
  '᠎',
];

const TAGS = [
  'div',
  'ul',
  'ol',
  'section',
  'form',
  'li',
  'p',
  'span',
  'a',
  'a',
  'a',
  'h1',
  'table',
  'td',
  'nav',
  'NAV',
  'footer',
  'header',
  'aside',
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'math',
  'body',
  'main',
  'article',
  'button',
];
const SPACES = [' ', '\t', '\n', '\f', '\r', ' ', ' '];

const attrArb = fc.oneof(
  fc
    .constantFrom('navigation', 'banner', 'contentinfo', 'Navigation', ' banner', 'main')
    .map((v) => ` role="${v}"`),
  fc
    .constantFrom(
      'onetrust-consent-sdk',
      'CybotCookiebotDialog',
      'cybotcookiebotdialog',
      'usercentrics-root',
      'x',
    )
    .map((v) => ` id="${v}"`),
  fc
    .array(
      fc.tuple(
        fc.constantFrom('cc-window', 'cc-window2', 'xcc-window', 'CC-WINDOW', 'x'),
        fc.constantFrom(...SPACES),
      ),
      {
        minLength: 1,
        maxLength: 3,
      },
    )
    .map((parts) => ` class="${parts.map(([t, s]) => t + s).join('')}"`),
  fc.constant(' href="/x"'),
);

const textArb = fc.string({ unit: fc.constantFrom(...TEXT_UNITS), maxLength: 30 });

/**
 * A block of links near the density rule's thresholds: 2 to 6 links of short or long text, in a
 * density tag or not, with or without prose beside them.
 */
const menuArb = fc
  .tuple(
    fc.constantFrom('ul', 'ol', 'div', 'section', 'form', 'p'),
    fc.array(fc.constantFrom('Home', 'About us', 'A much longer link title for a card', 'x'), {
      minLength: 2,
      maxLength: 6,
    }),
    fc.constantFrom('', 'Some prose beside the links.', 'w'),
  )
  .map(
    ([tag, links, prose]) =>
      `<${tag}>${links.map((t) => `<li><a href="/x">${t}</a></li>`).join('')}${prose}</${tag}>`,
  );

const nodeArb: fc.Arbitrary<string> = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    textArb,
    menuArb,
    fc.constantFrom(
      '<!-- c -->',
      '<![CDATA[x y]]>',
      '<![CDATA[a much longer run of text in a CDATA section]]>',
      '</p>',
      '</div>',
      '<br>',
      '<img src=x>',
    ),
    fc
      .tuple(
        fc.constantFrom(...TAGS),
        fc.array(attrArb, { maxLength: 2 }),
        fc.array(tie('node'), { maxLength: 5 }),
        fc.boolean(),
      )
      .map(
        ([tag, attrs, kids, close]) =>
          `<${tag}${attrs.join('')}>${kids.join('')}${close ? `</${tag}>` : ''}`,
      ),
  ),
})).node;

const documentArb = fc
  .tuple(fc.boolean(), fc.array(nodeArb, { maxLength: 6 }), fc.boolean())
  .map(([head, body, wrap]) => {
    const inner = body.join('');
    const start = head ? '<html><head><title>t</title><nav>head nav</nav></head>' : '';
    return wrap ? `${start}<body>${inner}</body>` : `${start}${inner}`;
  });
