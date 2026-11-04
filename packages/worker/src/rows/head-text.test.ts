import { describe, expect, it } from 'vitest';
import { readPage } from '../reader/read.js';
import { DESCRIPTION_BYTES, TITLE_BYTES } from './head-text.js';

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

  it('control characters are dropped from the stored text, as every crawled string is', () => {
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
