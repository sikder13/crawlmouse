/**
 * The same-site link targets of a page's two renders (links.ts): one extractor for both sides, the
 * crawl's own rules (extract.ts `extractPage` with non-content links left out, then canonicalizeUrl),
 * the page's own site only, at most MAX_RENDER_LINKS a side, sorted, and `truncated` when a side had
 * more, or a target past the URL bound.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_URL_LENGTH } from '../batch-bounds.js';
import { MAX_RENDER_LINKS, renderLinks, sameSiteTargets } from './links.js';

const PAGE = 'https://shop.test/products/tent';
const body = (anchors: string) => `<html><body><nav>${anchors}</nav><p>Words.</p></body></html>`;
const a = (href: string, text = 'x') => `<a href="${href}">${text}</a>`;

describe('sameSiteTargets', () => {
  it('keeps the links to the page’s own site, in the crawl’s spelling, sorted and once each', () => {
    const html = body(
      a('/guides/b/') +
        a('https://shop.test/guides/a?utm_source=x&b=2&a=1') +
        a('/guides/b') +
        a('HTTPS://SHOP.TEST/about#team') +
        a('//shop.test/shop'),
    );
    expect(sameSiteTargets(html, PAGE)).toEqual({
      targets: [
        'https://shop.test/about',
        'https://shop.test/guides/a?a=1&b=2&utm_source=x',
        'https://shop.test/guides/b',
        'https://shop.test/shop',
      ],
      truncated: false,
    });
  });

  it('keeps the www twin, as the crawl does, and the homepage as its origin', () => {
    const html = body(a('https://www.shop.test/x') + a('/'));
    expect(sameSiteTargets(html, PAGE).targets).toEqual([
      'https://shop.test',
      'https://www.shop.test/x',
    ]);
  });

  it('leaves out hostile and off-site hrefs: script, data, mail, other hosts, other ports, fragments', () => {
    const html = body(
      a('javascript:void(0)') +
        a('JavaScript:alert(1)') +
        a('data:text/html,<p>x</p>') +
        a('mailto:a@shop.test') +
        a('tel:+100') +
        a('ftp://shop.test/file') +
        a('https://other.test/x') +
        a('https://shop.test.evil.test/x') +
        a('https://sub.shop.test/x') +
        a('https://shop.test:8443/x') +
        a('http://shop.test:8080/x') +
        a('#reviews') +
        a('') +
        a('http://[::1/x') +
        a(PAGE) +
        a(`${PAGE}#reviews`),
    );
    expect(sameSiteTargets(html, PAGE)).toEqual({ targets: [], truncated: false });
  });

  it('leaves out what the crawl leaves out as not a page: share actions and media files', () => {
    const html = body(a('/p?share=facebook') + a('/photo.jpg') + a('/wp-content/uploads/a.pdf'));
    expect(sameSiteTargets(html, PAGE).targets).toEqual([]);
  });

  it('keeps the default port and the other scheme, as the crawl does', () => {
    const html = body(a('https://shop.test:443/a') + a('http://shop.test/b'));
    expect(sameSiteTargets(html, PAGE).targets).toEqual([
      'http://shop.test/b',
      'https://shop.test/a',
    ]);
  });

  it(`keeps at most ${MAX_RENDER_LINKS}, the first in sorted order, and says when it cut`, () => {
    const many = (n: number) =>
      body(Array.from({ length: n }, (_, i) => a(`/p/${String(n - i).padStart(4, '0')}`)).join(''));
    const at = sameSiteTargets(many(MAX_RENDER_LINKS), PAGE);
    expect(at.targets).toHaveLength(MAX_RENDER_LINKS);
    expect(at.truncated).toBe(false);
    const past = sameSiteTargets(many(MAX_RENDER_LINKS + 1), PAGE);
    expect(past.targets).toHaveLength(MAX_RENDER_LINKS);
    expect(past.truncated).toBe(true);
    expect(past.targets[0]).toBe('https://shop.test/p/0001');
    expect(past.targets.at(-1)).toBe(
      `https://shop.test/p/${String(MAX_RENDER_LINKS).padStart(4, '0')}`,
    );
    // Repeats of one target count once, so they do not reach the bound.
    const repeats = body(Array.from({ length: MAX_RENDER_LINKS + 5 }, () => a('/same')).join(''));
    expect(sameSiteTargets(repeats, PAGE)).toEqual({
      targets: ['https://shop.test/same'],
      truncated: false,
    });
  });

  it('leaves out a target past the URL bound, and says the side is cut', () => {
    const long = `/${'p'.repeat(MAX_URL_LENGTH)}`;
    expect(sameSiteTargets(body(a(long) + a('/ok')), PAGE)).toEqual({
      targets: ['https://shop.test/ok'],
      truncated: true,
    });
  });
});

describe('renderLinks', () => {
  it('reads both sides with the one extractor, and is truncated when either side is', () => {
    const many = body(
      Array.from({ length: MAX_RENDER_LINKS + 1 }, (_, i) => a(`/p/${i}`)).join(''),
    );
    expect(renderLinks(body(a('/a')), body(a('/a') + a('/b')), PAGE)).toEqual({
      static: ['https://shop.test/a'],
      rendered: ['https://shop.test/a', 'https://shop.test/b'],
      truncated: false,
    });
    expect(renderLinks(many, body(a('/a')), PAGE).truncated).toBe(true);
    expect(renderLinks(body(a('/a')), many, PAGE).truncated).toBe(true);
  });

  it('gives the same list for the same links, whatever their order and spelling on each side (property)', () => {
    const path = fc.constantFrom('/a', '/b', '/c/', '/d?y=1&x=2', '/e#f', 'https://shop.test/g');
    fc.assert(
      fc.property(fc.array(path, { maxLength: 12 }), (paths) => {
        const forward = body(paths.map((p) => a(p)).join(''));
        const backward = body(
          [...paths]
            .reverse()
            .map((p) => a(p))
            .join(''),
        );
        const { static: s, rendered: r } = renderLinks(forward, backward, PAGE);
        expect(s).toEqual(r);
        expect(s).toEqual([...s].sort());
        expect(new Set(s).size).toBe(s.length);
      }),
    );
  });
});
