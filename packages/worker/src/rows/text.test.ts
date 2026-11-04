import { expectWithinBudget } from '@crawlmouse/timing';
import { describe, expect, it } from 'vitest';
import { MAX_KEPT_BYTES } from '../fetch/fetcher.js';
import { outcome } from '../test-support/outcome.js';
import {
  isHtml,
  MAX_DOM_DEPTH,
  NOT_HTML,
  MAX_READ_TAGS,
  READ_IN_PART,
  READ_IN_PART_TAGS,
  TOO_DEEP,
  countWords,
  domDepth,
  parseHtml,
  readHtml,
  servedText,
  wordsIn,
} from './text.js';

const parse = (html: string) => parseHtml(html)!;

describe('servedText', () => {
  it('keeps adjacent elements apart and skips script, style, noscript, template and svg', () => {
    const $ = parse(
      '<html><head><title>T</title></head><body><p>one</p><p>two</p><a>three</a><script>no</script><style>no</style>' +
        '<noscript>no</noscript><template>no</template><svg><text>no</text></svg></body></html>',
    );
    expect(servedText($)).toBe('one two three');
  });

  it('does not change the document it reads', () => {
    const $ = parse('<body><p>a</p><script>s</script></body>');
    servedText($);
    expect($('script').length).toBe(1);
  });

  it('reads a body with a million sibling elements', () => {
    const $ = parse(`<body>${'<p>w'.repeat(1_000_000)}</body>`);
    expect(countWords(servedText($))).toBe(1_000_000);
  });

  it('reads text without a body element', () => {
    expect(servedText(parse('<p>no body</p>'))).toBe('no body');
  });
});

describe('nesting depth', () => {
  const nested = (depth: number) =>
    `<body>${'<div>'.repeat(depth)}deep${'</div>'.repeat(depth)}</body>`;

  it(`reads a page nested exactly ${MAX_DOM_DEPTH} deep, and refuses one level more`, () => {
    // body is one level, so depth - 1 divs inside it reach depth.
    expect(domDepth(parse(nested(MAX_DOM_DEPTH - 1)))).toBe(MAX_DOM_DEPTH);
    expect(parseHtml(nested(MAX_DOM_DEPTH))).toBeNull();
  });

  it('stops a page of unclosed tags at the limit, rather than parsing all of it', () => {
    // Each stray close tag makes the parser search every open element; parsed to the end, this page
    // took 14.5 s on a workstation (round 5 of review measured about 57 s on the VM).
    const hostile = `<body>${'<em></p>'.repeat(87_500)}`;
    const t0 = performance.now();
    expect(parseHtml(hostile)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('reads 2 MiB of stray close tags under 510 open elements in linear time', () => {
    // The slowest shape review round 6 found: every close tag searches the open elements, which the
    // limit holds to 511. 0.2 to 0.3 s on a workstation; the bound leaves room for a loaded runner.
    const page = `<body>${'<div>'.repeat(510)}${'</span>'.repeat(300_000)}`;
    const { values } = expectWithinBudget(
      'readHtml, 2 MiB of stray close tags under 510 open elements',
      () => readHtml({ body: page, bodyCut: false }),
      { budgetMs: 3_000 },
    );
    const { $, note } = values[0]!;
    expect($).not.toBeNull();
    expect(note).toBe(READ_IN_PART_TAGS);
  });

  it('counts depth as domDepth does: script and style add no level', () => {
    const at = (n: number, leaf: string) => `<body>${'<div>'.repeat(n - 1)}${leaf}</body>`;
    expect(parseHtml(at(MAX_DOM_DEPTH, '<script>x</script><style>y</style>'))).not.toBeNull();
    expect(parseHtml(at(MAX_DOM_DEPTH, '<i>x</i>'))).toBeNull();
    // Closed elements give their level back.
    expect(parseHtml(`<body>${'<div>x</div>'.repeat(5_000)}</body>`)).not.toBeNull();
  });

  it('measures 200,000 levels in linear time, without overflowing the stack', () => {
    const t0 = Date.now();
    expect(parseHtml(nested(200_000))).toBeNull();
    expect(Date.now() - t0).toBeLessThan(5_000);
  });
});

describe('wordsIn', () => {
  it('counts words in HTML, and 0 for a response that is not HTML', () => {
    expect(wordsIn(outcome({ body: '<body><p>a b</p><p>c</p></body>' }))).toEqual({
      words: 3,
      note: null,
    });
    const json = outcome({ headers: { 'content-type': 'application/json' }, body: '{"a": 1}' });
    expect(wordsIn(json)).toEqual({ words: 0, note: NOT_HTML });
    // With no Content-Type, a body that starts with a tag is read as HTML, as browsers sniff it.
    expect(wordsIn(outcome({ headers: {}, body: '<p>one two</p>' }))).toEqual({
      words: 2,
      note: null,
    });
    expect(wordsIn(outcome({ headers: {}, body: 'plain words here' }))).toEqual({
      words: 0,
      note: NOT_HTML,
    });
    expect(countWords('  ')).toBe(0);
  });

  it('is null for a page too deep to read, and says so', () => {
    const deep = outcome({ body: `<body>${'<div>'.repeat(600)}x</body>` });
    expect(wordsIn(deep)).toEqual({ words: null, note: TOO_DEEP });
  });

  it('reads all of a body that was kept whole', () => {
    const body = `<body>${'w '.repeat(1_000_000)}</body>`;
    expect(wordsIn(outcome({ body, bodyCut: false }))).toEqual({ words: 1_000_000, note: null });
  });

  it('sniffs HTML when no Content-Type was sent, after leading whitespace or a BOM', () => {
    for (const body of ['<html><p>a b</p>', '\n  <html><p>a b</p>', '\uFEFF<html><p>a b</p>']) {
      expect(wordsIn(outcome({ headers: {}, body }))).toEqual({ words: 2, note: null });
    }
    expect(wordsIn(outcome({ headers: {}, body: 'a b <p>c</p>' }))).toEqual({
      words: 0,
      note: NOT_HTML,
    });
  });

  it('reads XHTML as HTML', () => {
    const xhtml = outcome({
      headers: { 'content-type': 'application/xhtml+xml' },
      body: '<p>a b</p>',
    });
    expect(wordsIn(xhtml)).toEqual({ words: 2, note: null });
  });

  it('reads what was kept of a body that was cut, and says so', () => {
    const r = wordsIn(outcome({ body: '<body>w w w', bodyCut: true }));
    expect(r).toEqual({ words: 3, note: READ_IN_PART });
    expect(READ_IN_PART).toBe(
      'Only the first 2 MiB of this page were read for its text and links.',
    );
  });

  it('reads a page of exactly 200,000 tags whole', () => {
    const r = wordsIn(outcome({ body: '<p>w'.repeat(200_000) }));
    expect(r).toEqual({ words: 200_000, note: null });
  });

  it('reads a page of more tags up to its 200,000th, and says so', () => {
    // Each `<p>w` is one tag and one word; the 200,001st is not read.
    const r = wordsIn(outcome({ body: '<p>w'.repeat(200_001) }));
    expect(r).toEqual({ words: 200_000, note: READ_IN_PART_TAGS });
    expect(READ_IN_PART_TAGS).toBe(
      `Only the first ${MAX_READ_TAGS} tags of this page were read for its text and links.`,
    );
    expect(MAX_READ_TAGS).toBe(200_000);
  });

  it(`reads a body of exactly ${MAX_KEPT_BYTES} characters, kept whole, as whole`, () => {
    const body = `<body>${'w'.repeat(MAX_KEPT_BYTES - '<body></body>'.length)}</body>`;
    expect(body).toHaveLength(MAX_KEPT_BYTES);
    expect(wordsIn(outcome({ body, bodyCut: false }))).toEqual({ words: 1, note: null });
  });

  it(`reads no more than ${MAX_KEPT_BYTES} characters of a body handed over longer`, () => {
    const r = wordsIn(outcome({ body: `<body>${'w '.repeat(MAX_KEPT_BYTES)}</body>` }));
    expect(r.note).toBe(READ_IN_PART);
    // "<body>" takes six of the characters read; each word and its space take two.
    expect(r.words).toBe((MAX_KEPT_BYTES - '<body>'.length) / 2);
  });
});

describe('isHtml', () => {
  const of = (headers: Record<string, string | string[]>, body = '') =>
    isHtml(outcome({ headers, body }));

  it.each([
    ['text/html', true],
    ['text/html; charset=utf-8', true],
    ['TEXT/HTML', true],
    ['Text/Html; Charset=UTF-8', true],
    ['application/xhtml+xml', true],
    [' application/xhtml+xml ; q=1', true],
    ['text/htmlx', false],
    ['application/vnd.foo+html', false],
    ['text/plain', false],
    ['application/octet-stream', false],
    ['application/pdf', false],
    ['application/rss+xml', false],
  ])('Content-Type %j is HTML: %s', (type, html) => {
    expect(of({ 'content-type': type }, '<html><body>x</body></html>')).toBe(html);
  });

  it('with no Content-Type, or an empty one, sniffs a tag that is not an XML declaration', () => {
    expect(of({}, '  ﻿<html><body>x</body></html>')).toBe(true);
    expect(of({ 'content-type': '; charset=utf-8' }, '<p>x</p>')).toBe(true);
    expect(of({}, '<?xml version="1.0"?><rss></rss>')).toBe(false);
    expect(of({}, '  <?XML version="1.0"?><feed/>')).toBe(false);
    expect(of({}, 'plain words')).toBe(false);
  });
});
