/**
 * What a page's script adds to its same-site links (links.ts): one extractor for both sides, the
 * crawl's own rules (extract.ts `extractPage` with non-content links left out, then canonicalizeUrl,
 * the page's own site by `inSiteScope`), both sides read whole, the difference taken over the whole
 * sets, and only the difference kept: sorted, at most MAX_RENDER_LINKS targets and
 * MAX_RENDER_LINK_CHARS characters, with its whole count.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_URL_LENGTH } from '../batch-bounds.js';
import {
  MAX_RENDER_LINK_CHARS,
  MAX_RENDER_LINKS,
  readRenderLinks,
  renderLinks,
  sameSiteTargets,
} from './links.js';

const PAGE = 'https://shop.test/products/tent';
const body = (anchors: string) => `<html><body><nav>${anchors}</nav><p>Words.</p></body></html>`;
const a = (href: string, text = 'x') => `<a href="${href}">${text}</a>`;
const page = (hrefs: readonly string[]) => body(hrefs.map((h) => a(h)).join(''));
const sorted = (xs: Iterable<string>) => [...xs].sort();

describe('sameSiteTargets', () => {
  it('keeps the links to the page’s own site, in the crawl’s spelling, once each', () => {
    const html = page([
      '/guides/b/',
      'https://shop.test/guides/a?utm_source=x&b=2&a=1',
      '/guides/b',
      'HTTPS://SHOP.TEST/about#team',
      '//shop.test/shop',
    ]);
    expect(sorted(sameSiteTargets(html, PAGE))).toEqual([
      'https://shop.test/about',
      'https://shop.test/guides/a?a=1&b=2&utm_source=x',
      'https://shop.test/guides/b',
      'https://shop.test/shop',
    ]);
  });

  it('keeps the www twin as a target of its own, as the worker’s crawl keeps it a page of its own', () => {
    expect(sorted(sameSiteTargets(page(['https://www.shop.test/x', '/']), PAGE))).toEqual([
      'https://shop.test',
      'https://www.shop.test/x',
    ]);
  });

  it('leaves out hostile and off-site hrefs: script, data, mail, other hosts, other ports, fragments', () => {
    const html = page([
      'javascript:void(0)',
      'JavaScript:alert(1)',
      'data:text/html,<p>x</p>',
      'mailto:a@shop.test',
      'tel:+100',
      'ftp://shop.test/file',
      'https://other.test/x',
      'https://shop.test.evil.test/x',
      'https://sub.shop.test/x',
      'https://shop.test:8443/x',
      'http://shop.test:8080/x',
      '#reviews',
      '',
      'http://[::1/x',
      PAGE,
      `${PAGE}#reviews`,
    ]);
    expect(sorted(sameSiteTargets(html, PAGE))).toEqual([]);
  });

  it('leaves out what the crawl leaves out as not a page: share actions and media files', () => {
    const html = page(['/p?share=facebook', '/photo.jpg', '/wp-content/uploads/a.pdf']);
    expect(sorted(sameSiteTargets(html, PAGE))).toEqual([]);
  });

  it('keeps the default port and the other scheme, as the crawl does', () => {
    const html = page(['https://shop.test:443/a', 'http://shop.test/b']);
    expect(sorted(sameSiteTargets(html, PAGE))).toEqual([
      'http://shop.test/b',
      'https://shop.test/a',
    ]);
  });

  it('reads a side whole, past any count', () => {
    const many = Array.from({ length: 3 * MAX_RENDER_LINKS }, (_, i) => `/p/${i}`);
    expect(sameSiteTargets(page(many), PAGE).size).toBe(3 * MAX_RENDER_LINKS);
  });

  it('leaves out a target past the URL bound', () => {
    const long = `/${'p'.repeat(MAX_URL_LENGTH)}`;
    expect(sorted(sameSiteTargets(page([long, '/ok']), PAGE))).toEqual(['https://shop.test/ok']);
  });
});

describe('renderLinks', () => {
  it('keeps what the rendered side links to and the static side does not, and nothing else', () => {
    expect(renderLinks(page(['/a', '/static-only']), page(['/b', '/a']), PAGE)).toEqual({
      js_only: ['https://shop.test/b'],
      js_only_count: 1,
      truncated: false,
    });
    expect(renderLinks(page(['/a']), page(['/a']), PAGE)).toEqual({
      js_only: [],
      js_only_count: 0,
      truncated: false,
    });
  });

  it('decides a www twin as the crawl would: a static /x and a rendered www twin of it are two pages', () => {
    const twin = renderLinks(page(['/x']), page(['/x', 'https://www.shop.test/x']), PAGE);
    expect(twin.js_only).toEqual(['https://www.shop.test/x']);
    expect(renderLinks(page(['/x']), page(['https://shop.test/x']), PAGE).js_only).toEqual([]);
  });

  it('takes the difference over the whole sides: a page with far more links than the bound is read', () => {
    // A mega-menu of 600 links on both sides, and two the script adds.
    const menu = Array.from(
      { length: 3 * MAX_RENDER_LINKS },
      (_, i) => `/c/${String(i).padStart(3, '0')}`,
    );
    expect(renderLinks(page(menu), page([...menu, '/new/1', '/new/2']), PAGE)).toEqual({
      js_only: ['https://shop.test/new/1', 'https://shop.test/new/2'],
      js_only_count: 2,
      truncated: false,
    });
    // With none added, the empty difference is evidence of absence, and is not truncated.
    expect(renderLinks(page(menu), page(menu), PAGE)).toEqual({
      js_only: [],
      js_only_count: 0,
      truncated: false,
    });
  });

  it('leaves out a target past the URL bound on both sides alike, so it is never JS-only', () => {
    const long = `/${'p'.repeat(MAX_URL_LENGTH)}`;
    expect(renderLinks(page(['/a']), page(['/a', long]), PAGE)).toEqual({
      js_only: [],
      js_only_count: 0,
      truncated: false,
    });
  });

  it(`keeps at most ${MAX_RENDER_LINKS} JS-only targets, the first sorted, and counts them all`, () => {
    const added = (n: number) =>
      Array.from({ length: n }, (_, i) => `/p/${String(n - i).padStart(4, '0')}`);
    const at = renderLinks(page([]), page(added(MAX_RENDER_LINKS)), PAGE);
    expect(at).toMatchObject({ js_only_count: MAX_RENDER_LINKS, truncated: false });
    expect(at.js_only).toHaveLength(MAX_RENDER_LINKS);
    const past = renderLinks(page([]), page(added(MAX_RENDER_LINKS + 1)), PAGE);
    expect(past).toMatchObject({ js_only_count: MAX_RENDER_LINKS + 1, truncated: true });
    expect(past.js_only).toHaveLength(MAX_RENDER_LINKS);
    expect(past.js_only[0]).toBe('https://shop.test/p/0001');
    expect(past.js_only.at(-1)).toBe(
      `https://shop.test/p/${String(MAX_RENDER_LINKS).padStart(4, '0')}`,
    );
  });

  it('never calls a target in both sides JS-only, and calls every rendered target the static side lacks JS-only (property)', () => {
    const path = fc.constantFrom(
      '/',
      '/a',
      '/b',
      '/c/',
      '/d?y=1&x=2',
      '/e#f',
      'https://shop.test/g',
      'https://www.shop.test/a',
    );
    fc.assert(
      fc.property(fc.array(path, { maxLength: 10 }), fc.array(path, { maxLength: 10 }), (s, r) => {
        const got = renderLinks(page(s), page(r), PAGE);
        const served = sameSiteTargets(page(s), PAGE);
        const rendered = sameSiteTargets(page(r), PAGE);
        for (const t of got.js_only) expect(served.has(t)).toBe(false);
        expect(got.js_only).toEqual(sorted([...rendered].filter((t) => !served.has(t))));
        expect(got.js_only_count).toBe(got.js_only.length);
      }),
    );
  });
});

describe('the character budget', () => {
  /** A same-site URL of exactly `length` characters, sorting by `i`. */
  const urlOf = (i: number, length: number) => {
    const head = `https://shop.test/p${String(i).padStart(2, '0')}-`;
    return head + 'x'.repeat(length - head.length);
  };
  const longs = (n: number) => Array.from({ length: n }, (_, i) => urlOf(i, MAX_URL_LENGTH));
  // Each target is MAX_URL_LENGTH characters, so this many fill the budget exactly.
  const fill = MAX_RENDER_LINK_CHARS / MAX_URL_LENGTH;

  it('is a whole number of the longest targets, below the count bound', () => {
    expect(Number.isInteger(fill)).toBe(true);
    expect(fill).toBeLessThan(MAX_RENDER_LINKS);
  });

  it('keeps a difference exactly at the budget whole, and does not call it truncated', () => {
    const got = renderLinks(page([]), page(longs(fill)), PAGE);
    expect(got).toEqual({ js_only: longs(fill), js_only_count: fill, truncated: false });
    expect(got.js_only.reduce((n, t) => n + t.length, 0)).toBe(MAX_RENDER_LINK_CHARS);
  });

  it(`truncates a difference past the budget before ${MAX_RENDER_LINKS} targets, keeping the sorted prefix that fits`, () => {
    // One more long target, and a short one sorting last that would fit on its own: a prefix stops
    // at the first target that does not fit, so neither is kept.
    const short = 'https://shop.test/zz';
    const got = renderLinks(page([]), page([short, ...longs(fill + 1).reverse()]), PAGE);
    expect(got).toEqual({ js_only: longs(fill), js_only_count: fill + 2, truncated: true });
    expect(got.js_only.reduce((n, t) => n + t.length, 0)).toBeLessThanOrEqual(
      MAX_RENDER_LINK_CHARS,
    );
  });
});

describe('readRenderLinks: links as a stored render outcome holds them', () => {
  const current = { js_only: ['https://shop.test/a'], js_only_count: 3, truncated: true };

  it('reads the current shape as it is', () => {
    expect(readRenderLinks(current)).toEqual(current);
    const empty = { js_only: [], js_only_count: 0, truncated: false };
    expect(readRenderLinks(empty)).toEqual(empty);
  });

  it('reads any other shape as no links, without throwing', () => {
    const round1 = {
      static: ['https://shop.test/a'],
      rendered: ['https://shop.test/a', 'https://shop.test/b'],
      truncated: false,
    };
    for (const value of [
      round1,
      undefined,
      null,
      'links',
      [],
      { ...current, js_only: 'https://shop.test/a' },
      { ...current, js_only: [1] },
      { ...current, js_only_count: 1.5 },
      { ...current, js_only_count: -1 },
      { ...current, js_only_count: '3' },
      { ...current, js_only_count: Number.NaN },
      { ...current, truncated: 'no' },
    ]) {
      expect(readRenderLinks(value), JSON.stringify(value)).toBeNull();
    }
  });
});
