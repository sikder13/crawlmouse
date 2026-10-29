import { extractPage, toPersistableText } from '@crawlmouse/engine/worker';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ANCHOR_TEXT_BYTES,
  MAX_LINKS_READ,
  MAX_URL_LENGTH,
  linksNotReadNote,
  readLinks,
} from './links.js';
import { bounded, CAPS } from './bounded.js';
import { parseHtml } from './text.js';

const BASE = 'https://example.com/dir/page';
/** readLinks, with anchor text cut as an edge stores it. */
const read = (html: string) => {
  const r = readLinks(parseHtml(html)!, BASE);
  return {
    ...r,
    links: r.links.map((l) => ({ ...l, anchorText: bounded(l.anchorText, CAPS.anchorText) })),
  };
};
const urls = (html: string) => read(html).links.map((l) => l.toUrl);

/**
 * The engine's own reading of a page, which readLinks must match: extractPage over the whole parsed
 * page, after the same reading limits (an href over MAX_URL_LENGTH, and links past the first
 * MAX_LINKS_READ, are not read), with anchor text cut the way an edge stores it.
 */
function engineReading(html: string) {
  const $ = parseHtml(html)!;
  const notRead = { tooLong: 0, pastLimit: 0 };
  let n = 0;
  for (const el of $('a[href]').toArray()) {
    if (el.attribs.href!.length > MAX_URL_LENGTH) notRead.tooLong++;
    else if (n >= MAX_LINKS_READ) notRead.pastLimit++;
    else {
      n++;
      continue;
    }
    delete el.attribs.href;
  }
  const page = extractPage($, BASE, { excludeNonContentLinks: true });
  return {
    notRead,
    canonicalUrl: page.canonicalUrl,
    links: page.links.map((l) => ({
      ...l,
      anchorText: toPersistableText(l.anchorText, ANCHOR_TEXT_BYTES),
    })),
  };
}

describe('readLinks: pinned readings', () => {
  it('reads an ordinary page, resolving against the page URL', () => {
    expect(urls('<body><a href="a">A</a><p><a href="/b">B</a></p></body>')).toEqual([
      'https://example.com/dir/a',
      'https://example.com/b',
    ]);
  });

  it('reads links nested inside links, in page order, each with its whole text', () => {
    const card = (n: number) =>
      `<a href="/post-${n}"><h2>Post ${n}</h2><p>Filed in <a href="/category/news">News</a></p></a>`;
    const { links, notRead } = read(`<body>${card(1)}${card(2)}</body>`);
    expect(notRead).toEqual({ tooLong: 0, pastLimit: 0 });
    expect(links.map((l) => [l.toUrl, l.anchorText])).toEqual([
      ['https://example.com/post-1', 'Post 1Filed in News'],
      ['https://example.com/category/news', 'News'],
      ['https://example.com/post-2', 'Post 2Filed in News'],
      ['https://example.com/category/news', 'News'],
    ]);
  });

  it('collapses whitespace across elements and trims it, as the engine does', () => {
    const { links } = read('<body><a href="/x">\n  Read <b>  more</b>\t</a></body>');
    expect(links[0]).toEqual({
      toUrl: 'https://example.com/x',
      anchorText: 'Read more',
      isGenericAnchor: true,
    });
  });

  it(`cuts anchor text at ${ANCHOR_TEXT_BYTES} bytes, after stripping control characters`, () => {
    // 3,000 stripped controls, then the words: what is stored starts at the words.
    const text = `${'\u0001'.repeat(3000)}${'word '.repeat(1000)}`;
    const { links } = read(`<body><a href="/x">${text}</a></body>`);
    expect(links[0]!.anchorText).toBe('word '.repeat(400));
    expect(Buffer.byteLength(links[0]!.anchorText)).toBe(ANCHOR_TEXT_BYTES);
  });

  it('reads the first rel=canonical, same-host only, as the engine does', () => {
    const head = (links: string) => `<head>${links}</head><body></body>`;
    expect(read(head('<link rel="canonical" href="/c">')).canonicalUrl).toBe(
      'https://example.com/c',
    );
    expect(read(head('<link rel="Canonical" href="/c">')).canonicalUrl).toBe(
      'https://example.com/c',
    );
    expect(read(head('<link rel="canonical"><link rel="canonical" href="/c">')).canonicalUrl).toBe(
      undefined,
    );
    expect(read(head('<link rel="canonical" href="https://other.org/c">')).canonicalUrl).toBe(
      undefined,
    );
  });

  it(`reads an href of exactly ${MAX_URL_LENGTH} characters, and not one longer`, () => {
    const exact = `/${'p'.repeat(MAX_URL_LENGTH - 1)}`;
    const long = `/${'p'.repeat(MAX_URL_LENGTH)}`;
    const { links, notRead } = read(
      `<body><a href="${exact}">e</a><a href="${long}">l</a><a href="/ok">ok</a></body>`,
    );
    expect(notRead.tooLong).toBe(1);
    expect(links.map((l) => l.anchorText)).toEqual(['e', 'ok']);
  });

  it(`reads the first ${MAX_LINKS_READ} links of a page with 500,000 and no more`, () => {
    const { links, notRead } = read(`<body>${'<a href="/l">l</a>'.repeat(500_000)}</body>`);
    expect(links).toHaveLength(MAX_LINKS_READ);
    expect(notRead.pastLimit).toBe(500_000 - MAX_LINKS_READ);
  });

  it('says what it did not read, from the counts', () => {
    expect(linksNotReadNote({ tooLong: 0, pastLimit: 0 })).toBeNull();
    expect(linksNotReadNote({ tooLong: 1, pastLimit: 0 })).toBe(
      `1 link was not read: 1 with a URL over ${MAX_URL_LENGTH} characters.`,
    );
    expect(linksNotReadNote({ tooLong: 2, pastLimit: 1 })).toBe(
      `3 links were not read: 2 with a URL over ${MAX_URL_LENGTH} characters; 1 past the first ${MAX_LINKS_READ} on the page.`,
    );
  });
});

describe('readLinks: cost', () => {
  const time = (html: string): number => {
    const $ = parseHtml(html)!;
    const t = performance.now();
    readLinks($, BASE);
    return performance.now() - t;
  };

  it('costs about the same for 500 links nested around a large subtree as for one', () => {
    // Review round 3's page: nested links around 663,000 paragraphs with no text. Reading each link's
    // text by walking its subtree costs links x nodes (12 s measured); one pass costs nodes.
    const subtree = '<p></p>'.repeat(663_000);
    const nested = time(
      `<body>${'<a href="/x">'.repeat(500)}${subtree}${'</a>'.repeat(500)}</body>`,
    );
    const single = time(`<body><a href="/x">${subtree}</a></body>`);
    expect(nested).toBeLessThan(single * 3 + 100);
  }, 60_000);
});

// Characters chosen to vary what the reading keys on: every JavaScript whitespace character (the
// engine collapses `\s+`), the stripped controls (toPersistableText removes them after collapsing),
// \v and \f (both), surrogate pairs and lone halves, letters and the generic-anchor words.
const SPACES = [
  ' ',
  '\t',
  '\n',
  '\r',
  '\v',
  '\f',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  ' ',
  '　',
  '﻿',
];
const CONTROLS = ['\u0000', '\u0001', '\u0008', '\u000e', '\u001f', '\u007f'];
const OTHERS = ['a', 'é', '\u{1F600}', '\ud800', '\udc00', '.', 'click', 'here', 'read', 'more'];
const piece = fc.oneof(
  fc.constantFrom(...SPACES),
  fc.constantFrom(...CONTROLS),
  fc.constantFrom(...OTHERS),
);
// HTML-escaped so the page parses as the text it was generated from.
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = fc
  .tuple(fc.array(piece, { maxLength: 12 }), fc.nat({ max: 3 }))
  // Sometimes long, so the cut at ANCHOR_TEXT_BYTES is reached from either side of it.
  .map(([parts, times]) => escape(parts.join('').repeat(times === 3 ? 600 : 1)));
const href = fc.constantFrom(
  '/a',
  'b',
  '../c',
  '/a#frag',
  '#top',
  'javascript:void(0)',
  'mailto:x@example.com',
  'tel:1',
  'https://example.com/d',
  'https://www.example.com/e',
  'https://other.org/f',
  'http://example.com/g',
  '/photo.jpg',
  '/?share=twitter',
  '  /h  ',
  '',
  `/${'p'.repeat(MAX_URL_LENGTH)}`,
  'ftp://example.com/i',
);

interface Node {
  kind:
    | 'a'
    | 'a-nohref'
    | 'p'
    | 'script'
    | 'style'
    | 'template'
    | 'svg-a'
    | 'comment'
    | 'canonical';
  href: string;
  text: string;
  children: Node[];
}
const node: fc.Memo<Node> = fc.memo((depth) =>
  fc.record({
    kind: fc.constantFrom<Node['kind']>(
      'a',
      'a',
      'a',
      'a-nohref',
      'p',
      'script',
      'style',
      'template',
      'svg-a',
      'comment',
      'canonical',
    ),
    href,
    text,
    children: depth > 1 ? fc.array(node(depth - 1), { maxLength: 4 }) : fc.constant([]),
  }),
);
const render = (n: Node): string => {
  const inner = `${n.text}${n.children.map(render).join('')}`;
  const attr = `href="${n.href.replace(/"/g, '&quot;')}"`;
  switch (n.kind) {
    case 'a':
      return `<a ${attr}>${inner}</a>`;
    case 'a-nohref':
      return `<a name="x">${inner}</a>`;
    case 'svg-a':
      return `<svg><a ${attr}>${inner}</a></svg>`;
    case 'comment':
      return `<!--${n.text.replace(/-->/g, '')}-->${n.children.map(render).join('')}`;
    case 'canonical':
      return `<link rel="${n.text.length % 2 ? 'Canonical' : 'canonical'}" ${attr}>${inner}`;
    default:
      return `<${n.kind}>${inner}</${n.kind}>`;
  }
};

describe('readLinks: matches the engine', () => {
  it('reads every generated page as extractPage does, after the same limits', () => {
    fc.assert(
      fc.property(fc.array(node(4), { maxLength: 6 }), (nodes) => {
        const html = `<html><head></head><body>${nodes.map(render).join('')}</body></html>`;
        const engine = engineReading(html);
        const ours = read(html);
        expect(ours.notRead).toEqual(engine.notRead);
        expect(ours.canonicalUrl).toEqual(engine.canonicalUrl);
        expect(ours.links).toEqual(engine.links);
      }),
      { numRuns: 400 },
    );
  });

  it('reads past the link limit as the engine does', () => {
    const html = `<body>${'<a href="/l">l</a>'.repeat(MAX_LINKS_READ + 5)}<a href="/last">z</a></body>`;
    expect(read(html)).toEqual(engineReading(html));
  });
});
