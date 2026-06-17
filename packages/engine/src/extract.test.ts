import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { extractPage } from './extract.js';

describe('extractPage', () => {
  it('extracts title and internal links', () => {
    const html = `
      <html><head><title>Home</title></head>
      <body>
        <a href="/about">About</a>
        <a href="https://example.com/products">Products</a>
        <a href="https://other.com/x">External</a>
        <a href="/contact" class="cta">Contact us</a>
      </body></html>`;
    const result = extractPage(html, 'https://example.com/');
    expect(result.title).toBe('Home');
    expect(result.links.map((l) => l.toUrl)).toEqual([
      'https://example.com/about',
      'https://example.com/products',
      'https://example.com/contact',
    ]);
    expect(result.links[0]!.anchorText).toBe('About');
  });

  it('skips empty hrefs, fragments-only, javascript:, mailto:', () => {
    const html = `<a href="#top">x</a><a href="javascript:void(0)">y</a><a href="mailto:a@b.com">z</a><a href="">empty</a>`;
    const result = extractPage(html, 'https://example.com/');
    expect(result.links).toEqual([]);
  });

  it('marks generic anchors', () => {
    const html = `<a href="/a">Click here</a><a href="/b">Real product page</a>`;
    const result = extractPage(html, 'https://example.com/');
    expect(result.links[0]!.isGenericAnchor).toBe(true);
    expect(result.links[1]!.isGenericAnchor).toBe(false);
  });

  it('handles relative URLs from non-root pages', () => {
    const html = `<a href="../sibling">x</a><a href="child">y</a>`;
    const result = extractPage(html, 'https://example.com/blog/post');
    expect(result.links.map((l) => l.toUrl)).toEqual([
      'https://example.com/sibling',
      'https://example.com/blog/child',
    ]);
  });

  // Perf: the crawler already holds a parsed cheerio root ($) for each fetched page,
  // so re-serializing it to HTML and re-parsing (cheerio.load again) is wasted CPU on
  // every request. extractPage must accept an already-parsed CheerioAPI and yield the
  // SAME result as parsing the equivalent HTML string — this is the hermetic guarantee
  // that the single-parse crawler path is behavior-identical to the old double-parse one.
  it('accepts an already-parsed cheerio root and matches the string-parse result', () => {
    const html = `
      <html><head><title>Home</title></head>
      <body>
        <a href="/about">About</a>
        <a href="https://example.com/products">Products</a>
        <a href="https://other.com/x">External</a>
        <a href="/contact" class="cta">Contact us</a>
      </body></html>`;
    const baseUrl = 'https://example.com/';
    const fromString = extractPage(html, baseUrl);
    const fromRoot = extractPage(cheerio.load(html), baseUrl);
    expect(fromRoot.title).toBe(fromString.title);
    expect(fromRoot.links).toEqual(fromString.links);
  });

  describe('rel=canonical (§2)', () => {
    it('returns a differing same-host canonical target', () => {
      const html = '<html><head><link rel="canonical" href="/main"></head><body></body></html>';
      expect(extractPage(html, 'https://example.com/variant?v=2').canonicalUrl).toBe('https://example.com/main');
    });

    it('ignores a self-canonical (nothing to consolidate)', () => {
      const html = '<html><head><link rel="canonical" href="https://example.com/p"></head><body></body></html>';
      expect(extractPage(html, 'https://example.com/p').canonicalUrl).toBeUndefined();
    });

    it('ignores a cross-host canonical (a page cannot reassign its identity to another site)', () => {
      const html = '<html><head><link rel="canonical" href="https://evil.com/x"></head><body></body></html>';
      expect(extractPage(html, 'https://example.com/p').canonicalUrl).toBeUndefined();
    });

    it('has no canonicalUrl when none is declared', () => {
      expect(extractPage('<html><head></head><body></body></html>', 'https://example.com/p').canonicalUrl).toBeUndefined();
    });
  });
});
