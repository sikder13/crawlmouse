import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readPage } from '../reader/read.js';
import { bounded, type TextCap } from './bounded.js';
import { DESCRIPTION_BYTES, headText, TITLE_BYTES } from './head-text.js';

/**
 * The page's title and meta description, for the grade's crawlability "meta" hook (CC-17): the text
 * as a search engine reads it (ASCII whitespace collapsed and trimmed, as document.title is), its
 * true length in characters, and whether the stored text was cut.
 */

const read = (html: string, bodyCut = false) =>
  readPage({ body: html, bodyCut, finalUrl: 'https://www.example.com/' }).read;

describe('title and meta description', () => {
  it('reads the first title and the first meta description, collapsed and trimmed', () => {
    const r = read(
      '<html><head><title>  Hello \n\t world </title><title>second</title>' +
        '<meta name="Description" content=" A  page\nabout things ">' +
        '<meta name="description" content="second"></head><body></body></html>',
    )!;
    expect(r.title).toEqual({ text: 'Hello world', chars: 11, cut: false });
    expect(r.description).toEqual({ text: 'A page about things', chars: 19, cut: false });
  });

  it('a page that declares neither says so, which is not the same as not read', () => {
    const r = read('<html><head></head><body><p>x</p></body></html>')!;
    expect(r.title).toEqual({ text: null, chars: 0, cut: false });
    expect(r.description).toEqual({ text: null, chars: 0, cut: false });
  });

  it('an empty title and a meta description with no content are declared and empty', () => {
    const r = read('<title> </title><meta name="description">')!;
    expect(r.title).toEqual({ text: '', chars: 0, cut: false });
    expect(r.description).toEqual({ text: '', chars: 0, cut: false });
  });

  it('only name=description counts: property=, http-equiv= and og:description do not', () => {
    const r = read(
      '<meta property="description" content="a"><meta http-equiv="description" content="b">' +
        '<meta name="og:description" content="c">',
    )!;
    expect(r.description!.text).toBeNull();
  });

  it(`cuts the stored text to ${TITLE_BYTES} and ${DESCRIPTION_BYTES} bytes, keeping the true length`, () => {
    const long = 'é'.repeat(2000);
    const r = read(`<title>${long}</title><meta name="description" content="${long}">`)!;
    expect(r.title!.chars).toBe(2000);
    expect(r.title!.cut).toBe(true);
    expect(Buffer.byteLength(r.title!.text!)).toBeLessThanOrEqual(TITLE_BYTES);
    expect(r.description!.chars).toBe(2000);
    expect(Buffer.byteLength(r.description!.text!)).toBeLessThanOrEqual(DESCRIPTION_BYTES);
  });

  it('counts characters as code points, so an astral character is one', () => {
    expect(read('<title>😀a</title>')!.title!.chars).toBe(2);
  });

  it('control characters are dropped, as every stored string drops them', () => {
    expect(read('<title>a\u0000b</title>')!.title!.text).toBe('ab');
  });

  it('a page read only in part, with none found before reading stopped, records neither', () => {
    const r = read('<html><head><meta charset="utf-8"></head><body><p>x</p>', true)!;
    expect(r.title).toBeNull();
    expect(r.description).toBeNull();
  });

  it('a page read only in part still records a title found before reading stopped', () => {
    expect(read('<title>kept</title><p>x', true)!.title).toEqual({
      text: 'kept',
      chars: 4,
      cut: false,
    });
  });
});

/** The text collapsed whole first, the obvious way: what headText's one pass must equal. */
function reference(raw: string, cap: TextCap) {
  const collapsed = raw
    .replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, '')
    .replace(/[\t\n\f\r ]+/g, ' ')
    .replace(/^ | $/g, '');
  const text = bounded(collapsed, cap);
  const whole = bounded(collapsed, { kind: 'text', bytes: Buffer.byteLength(collapsed) });
  return { text, chars: [...collapsed].length, cut: text !== whole };
}

describe('headText in one pass', () => {
  const unit = fc.constantFrom(
    'a',
    'é',
    '😀',
    ' ',
    '\t',
    '\n',
    '\f',
    '\r',
    '\u0000',
    '\u0007',
    '\u007f',
    '\u00a0',
    '\ud800',
    '\udc00',
    'xy',
  );
  const raw = fc.array(unit, { maxLength: 60 }).map((u) => u.join(''));

  it('equals collapsing the whole text first, then bounding it (property)', () => {
    fc.assert(
      fc.property(raw, fc.integer({ min: 1, max: 24 }), (r, bytes) => {
        const cap: TextCap = { kind: 'text', bytes };
        expect(headText(r, cap, false)).toEqual(reference(r, cap));
      }),
      { numRuns: 5000 },
    );
  });

  it('a 2 MiB title: keeps only the budget, and counts the whole', () => {
    const title = 't \n'.repeat((2 * 1024 * 1024) / 3);
    const r = headText(title, { kind: 'text', bytes: TITLE_BYTES }, false)!;
    expect(r.cut).toBe(true);
    expect(Buffer.byteLength(r.text!)).toBeLessThanOrEqual(TITLE_BYTES);
    expect(r.chars).toBe(reference(title, { kind: 'text', bytes: TITLE_BYTES }).chars);
  });
});
