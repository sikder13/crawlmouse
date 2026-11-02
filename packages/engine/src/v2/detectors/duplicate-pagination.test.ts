import { describe, expect, it } from 'vitest';
import { simhashAway, site, u, type PageSpec } from '../../../fixtures/v2/detectors/builders.js';
import { detectDuplicatePagination, firstPageOf } from './duplicate-pagination.js';
import type { Detection } from './types.js';

const BASE = '0123456789abcdef';
const T = '/blog/page/{n}';
const of = (out: Detection[]) => out.find((d) => d.key === `pagination:${T}`);

/** /blog (page 1) and /blog/page/2, with the given hashes and page 2's canonical. */
function pair(
  page2: { simhash: string | null; canonical?: string | null },
  page1: Partial<PageSpec> = {},
) {
  return site([
    { path: '/', links: ['/blog'] },
    { path: '/blog', links: ['/blog/page/2'], facts: { simhash: BASE }, ...page1 },
    {
      path: '/blog/page/2',
      template: T,
      kind: 'pagination',
      facts: {
        simhash: page2.simhash,
        canonical: page2.canonical === undefined ? null : { href: page2.canonical },
      },
    },
  ]);
}

describe('duplicate_pagination', () => {
  it('detects a page within 3 bits of page 1, and is clear at 4', () => {
    expect(
      of(
        detectDuplicatePagination(
          pair({ simhash: simhashAway(BASE, 3), canonical: u('/blog/page/2') }),
        ),
      ),
    ).toMatchObject({
      state: 'detected',
      measured: 1,
      conditions: ['pagination_near_duplicate'],
      affected_urls: [u('/blog/page/2')],
    });
    expect(
      of(
        detectDuplicatePagination(
          pair({ simhash: simhashAway(BASE, 4), canonical: u('/blog/page/2') }),
        ),
      ),
    ).toMatchObject({
      state: 'not_detected',
      measured: 0,
    });
  });

  it('detects a page that canonicalises to page 1 while its content differs (truth vector)', () => {
    // Hand-computed: 10 bits apart, so not a near-duplicate; the canonical sends it to page 1 anyway.
    // A rule reading "a canonical to page 1 consolidates it, so it is fine" gives not_detected here.
    expect(
      of(
        detectDuplicatePagination(pair({ simhash: simhashAway(BASE, 10), canonical: u('/blog') })),
      ),
    ).toMatchObject({
      state: 'detected',
      conditions: ['pagination_canonical_to_first'],
    });
  });

  it('is indeterminate when page 1 was not crawled', () => {
    const s = pair({ simhash: BASE });
    const without = { ...s, pages: s.pages.filter((p) => p.url !== u('/blog')) };
    expect(of(detectDuplicatePagination(without))).toMatchObject({
      state: 'indeterminate',
      reason: 'first_page_not_crawled',
    });
  });

  it('is indeterminate when either page has no content hash and the canonical does not decide it', () => {
    expect(
      of(detectDuplicatePagination(pair({ simhash: null, canonical: u('/blog/page/2') }))),
    ).toMatchObject({
      state: 'indeterminate',
      reason: 'content_not_hashed',
    });
    expect(
      of(detectDuplicatePagination(pair({ simhash: BASE }, { facts: { simhash: null } }))),
    ).toMatchObject({
      state: 'indeterminate',
      reason: 'content_not_hashed',
    });
  });

  it('is indeterminate when the content differs and the canonical was not read', () => {
    expect(of(detectDuplicatePagination(pair({ simhash: simhashAway(BASE, 10) })))).toMatchObject({
      state: 'indeterminate',
      reason: 'canonical_not_read',
    });
  });

  it('rolls a template up: detected if any page is, indeterminate if any cannot be decided', () => {
    const three = (p3: { simhash: string | null }) =>
      site([
        { path: '/', links: ['/blog'] },
        { path: '/blog', facts: { simhash: BASE } },
        {
          path: '/blog/page/2',
          template: T,
          kind: 'pagination',
          facts: { simhash: simhashAway(BASE, 9), canonical: { href: null } },
        },
        {
          path: '/blog/page/3',
          template: T,
          kind: 'pagination',
          facts: { ...p3, canonical: { href: null } },
        },
      ]);
    expect(of(detectDuplicatePagination(three({ simhash: BASE })))).toMatchObject({
      state: 'detected',
      measured: 1,
    });
    expect(of(detectDuplicatePagination(three({ simhash: null })))).toMatchObject({
      state: 'indeterminate',
    });
    expect(of(detectDuplicatePagination(three({ simhash: simhashAway(BASE, 20) })))).toMatchObject({
      state: 'not_detected',
    });
  });

  it('on a truncated crawl a clear template is indeterminate, but a duplicate is still detected', () => {
    // An uncrawled later page of the template could repeat page 1.
    const truncated = (simhash: string) => {
      const s = pair({ simhash, canonical: u('/blog/page/2') });
      return { ...s, page_cap: s.pages.length };
    };
    expect(of(detectDuplicatePagination(truncated(simhashAway(BASE, 20))))).toMatchObject({
      state: 'indeterminate',
      reason: 'crawl_truncated',
    });
    expect(of(detectDuplicatePagination(truncated(BASE)))).toMatchObject({ state: 'detected' });
  });

  it('a later page that kept its content from us leaves the template undecided', () => {
    // /blog/page/2 is clear; /blog/page/3 answered 503, so whether it repeats page 1 is unknown.
    const s = site([
      { path: '/', links: ['/blog'] },
      { path: '/blog', facts: { simhash: BASE } },
      {
        path: '/blog/page/2',
        template: T,
        kind: 'pagination',
        facts: { simhash: simhashAway(BASE, 20), canonical: { href: null } },
      },
      { path: '/blog/page/3', template: T, kind: 'pagination', status: 503 },
    ]);
    expect(of(detectDuplicatePagination(s))).toMatchObject({
      state: 'indeterminate',
      reason: 'page_not_read',
      affected_urls: [u('/blog/page/3')],
    });
    // Even with a hash and a landing recorded, a 503's content is its error page, not the list's.
    const errorPage = {
      ...s,
      pages: s.pages.map((p) =>
        p.url === u('/blog/page/3') ? { ...p, final_url: p.url, content_simhash: BASE } : p,
      ),
    };
    expect(of(detectDuplicatePagination(errorPage))).toMatchObject({
      state: 'indeterminate',
      reason: 'page_not_read',
    });
  });

  it('names the first undecided page’s reason by URL, whatever the input order', () => {
    // /blog/page/2 answered 503 (page_not_read); /blog/page/3 has no hash (content_not_hashed).
    const s = site([
      { path: '/', links: ['/blog'] },
      { path: '/blog', facts: { simhash: BASE } },
      { path: '/blog/page/2', template: T, kind: 'pagination', status: 503 },
      {
        path: '/blog/page/3',
        template: T,
        kind: 'pagination',
        facts: { canonical: { href: null } },
      },
    ]);
    const reversed = { ...s, pages: [...s.pages].reverse() };
    expect(of(detectDuplicatePagination(s))).toMatchObject({ reason: 'page_not_read' });
    expect(detectDuplicatePagination(reversed)).toEqual(detectDuplicatePagination(s));
  });

  it('a later page that is now gone leaves the template undecided: removed, not fixed', () => {
    const s = site([
      { path: '/', links: ['/blog'] },
      { path: '/blog', facts: { simhash: BASE } },
      { path: '/blog/page/2', template: T, kind: 'pagination', status: 404 },
      {
        path: '/blog/page/3',
        template: T,
        kind: 'pagination',
        facts: { simhash: simhashAway(BASE, 20), canonical: { href: null } },
      },
    ]);
    expect(of(detectDuplicatePagination(s))).toMatchObject({
      state: 'indeterminate',
      reason: 'list_page_gone',
    });
  });

  it('a later page that redirects is not a page of the list', () => {
    // /blog/page/9 is past the end and redirects to page 1: its hash is page 1's own.
    const s = site([
      { path: '/', links: ['/blog'] },
      { path: '/blog', facts: { simhash: BASE } },
      {
        path: '/blog/page/9',
        template: T,
        kind: 'pagination',
        facts: { final_url: u('/blog'), simhash: BASE },
      },
    ]);
    expect(of(detectDuplicatePagination(s))).toBeUndefined();
  });

  it('finds pagination by URL, not by the page kind the v1 classifier assigned', () => {
    // v1 may relabel a near-duplicate page `duplicate`; the URL still says it is page 2.
    const s = pair({ simhash: BASE, canonical: null });
    const relabelled = {
      ...s,
      pages: s.pages.map((p) =>
        p.url === u('/blog/page/2') ? { ...p, kind: 'duplicate' as const } : p,
      ),
    };
    expect(of(detectDuplicatePagination(relabelled))).toMatchObject({ state: 'detected' });
  });

  describe('firstPageOf', () => {
    it.each([
      ['https://a.test/blog/page/2', 'https://a.test/blog'],
      ['https://a.test/page/7', 'https://a.test'],
      ['https://a.test/shop?page=3', 'https://a.test/shop'],
      ['https://a.test/shop?paged=2&sort=x', 'https://a.test/shop?sort=x'],
      ['https://a.test/list?offset=20', 'https://a.test/list'],
      ['https://a.test/list?start=10', 'https://a.test/list'],
      ['https://a.test/list?pg=2', 'https://a.test/list'],
    ])('%s → %s', (url, first) => expect(firstPageOf(url)).toBe(first));

    it.each([
      'https://a.test/blog/page/1',
      'https://a.test/list?offset=0',
      'https://a.test/page/about',
      'https://a.test/blog',
    ])('%s is not a later page', (url) => expect(firstPageOf(url)).toBeNull());
  });
});
