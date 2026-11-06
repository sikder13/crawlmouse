/**
 * The detectors decide from the fields the crawl worker records on PageResult (CC-12b): built here as
 * the worker writes them (real hop lists, a declared href beside its resolved URL, an hreflang list
 * with its completeness), not through the builders' `facts` shorthand.
 */
import type { PageResult } from '@crawlmouse/types/v2';
import { PageResultSchema } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { searchVerdicts, site, u, type PageSpec } from '../../../fixtures/v2/detectors/builders.js';
import { detectCanonicalMismatch } from './canonical-mismatch.js';
import { detectDuplicatePagination } from './duplicate-pagination.js';
import { pageFacts } from './facts.js';
import { detectHreflangGaps } from './hreflang-gaps.js';
import { detectRedirectChains } from './redirect-chains.js';
import { SEARCH_ENGINES } from './scope.js';
import type { Detection, DetectorInput } from './types.js';

const key = (prefix: string, path: string) => (d: Detection) => d.key === `${prefix}:${u(path)}`;

/** `input` with the PageResult at `path` given these fields, as a worker row would carry them. */
function withFields(
  input: DetectorInput,
  path: string,
  fields: Partial<PageResult>,
): DetectorInput {
  return {
    ...input,
    pages: input.pages.map((p) =>
      p.url === u(path) ? PageResultSchema.parse({ ...p, ...fields }) : p,
    ),
  };
}

const hop = (from: string, to: string | null, status = 301) => ({
  from: u(from),
  status,
  location: to === null ? null : u(to),
});

describe('pageFacts reads the worker’s fields', () => {
  const base = site([{ path: '/x' }]).pages[0]!;

  it('takes a redirect chain as its hop count and loop flag', () => {
    const p = { ...base, redirect: { hops: [hop('/x', '/y'), hop('/y', '/x', 308)], loop: true } };
    expect(pageFacts(p).redirect).toEqual({ hops: 2, loop: true });
  });

  it('takes the resolved canonical, else the href as written, else none', () => {
    const at = (href: string | null, url: string | null) =>
      pageFacts({ ...base, canonical_declared: { href, url } }).canonical;
    expect(at('../y', u('/y'))).toEqual({ href: u('/y') });
    expect(at('javascript:void(0)', null)).toEqual({ href: 'javascript:void(0)' });
    expect(at(null, null)).toEqual({ href: null });
    expect(pageFacts({ ...base, canonical_declared: null }).canonical).toBeNull();
  });

  it('reads an incomplete hreflang list as not read', () => {
    const links = [{ hreflang: 'en', href: u('/x') }];
    expect(pageFacts({ ...base, hreflang: { links, complete: true } }).hreflang).toEqual([
      { lang: 'en', href: u('/x') },
    ]);
    expect(pageFacts({ ...base, hreflang: { links, complete: false } }).hreflang).toBeNull();
  });
});

describe('decided from worker-shaped rows on a complete crawl', () => {
  const linked = (target: PageSpec): DetectorInput =>
    site([{ path: '/', links: [target.path] }, target]);

  it('redirect_chain: a recorded 2-hop chain is detected, and a loop is named', () => {
    const chain = withFields(linked({ path: '/t' }), '/t', {
      final_url: u('/t3'),
      redirect: { hops: [hop('/t', '/t2'), hop('/t2', '/t3', 302)], loop: false },
    });
    expect(detectRedirectChains(chain).find(key('redirect', '/t'))).toMatchObject({
      state: 'detected',
      measured: 2,
    });
    const loop = withFields(linked({ path: '/t', status: 301, kind: 'status' }), '/t', {
      final_url: u('/t2'),
      redirect: {
        hops: [
          hop('/t', '/t2'),
          hop('/t2', '/t'),
          hop('/t', '/t2'),
          hop('/t2', '/t'),
          hop('/t', '/t2'),
          hop('/t2', '/t'),
        ],
        loop: true,
      },
    });
    expect(detectRedirectChains(loop).find(key('redirect', '/t'))).toMatchObject({
      state: 'detected',
      conditions: ['redirect_loop'],
    });
  });

  it('canonical_mismatch: a declared canonical on another host is detected', () => {
    const input = withFields(site([{ path: '/' }, { path: '/p' }]), '/p', {
      canonical_declared: { href: 'https://other.test/p', url: 'https://other.test/p' },
    });
    expect(detectCanonicalMismatch(input).find(key('canonical', '/p'))).toMatchObject({
      state: 'detected',
      conditions: ['canonical_cross_host'],
    });
  });

  it('canonical_mismatch: a canonical to a URL robots.txt disallows for every search engine is detected', () => {
    const declares = (href: string, disallowed: { path: string; search?: string[] }[]) =>
      withFields(site([{ path: '/' }, { path: '/p' }, { path: '/c' }], { disallowed }), '/p', {
        canonical_declared: { href, url: u(href) },
      });
    const of = (input: DetectorInput) =>
      detectCanonicalMismatch(input).find(key('canonical', '/p'));
    expect(of(declares('/blocked', [{ path: '/blocked' }]))).toMatchObject({
      state: 'detected',
      conditions: ['canonical_target_disallowed'],
    });
    // Disallowed for our crawler only: the search engines can read it, and we could not.
    expect(of(declares('/ours', [{ path: '/ours', search: [] }]))).toMatchObject({
      state: 'indeterminate',
      reason: 'canonical_target_not_fetched',
    });
    // Fetched by us, and disallowed for every search engine.
    const sound = { canonical_declared: { href: u('/c'), url: u('/c') } };
    const fetched = (disallowedFor: string[]) =>
      withFields(declares('/c', []), '/c', {
        ...sound,
        robots_search: searchVerdicts(disallowedFor),
      });
    expect(of(fetched([...SEARCH_ENGINES]))).toMatchObject({
      state: 'detected',
      conditions: ['canonical_target_disallowed'],
    });
    // Fetched, and disallowed for one search engine only: a sound canonical.
    expect(of(fetched([SEARCH_ENGINES[0]!]))).toMatchObject({ state: 'not_detected' });
  });

  it('duplicate_pagination: a later page whose main-content simhash is page 1’s is detected', () => {
    const T = '/blog/page/{n}';
    const input = site([
      { path: '/', links: ['/blog'] },
      { path: '/blog', links: ['/blog/page/2'] },
      { path: '/blog/page/2', kind: 'pagination', template: T },
    ]);
    const hashed = (s: string) => ({
      content_simhash: s,
      canonical_declared: { href: null, url: null },
    });
    const dup = withFields(
      withFields(input, '/blog', hashed('0f0f0f0f0f0f0f0f')),
      '/blog/page/2',
      hashed('0f0f0f0f0f0f0f0e'),
    );
    expect(detectDuplicatePagination(dup)).toMatchObject([
      { state: 'detected', conditions: ['pagination_near_duplicate'] },
    ]);
  });

  it('hreflang_gap: a missing return is detected; the same list marked incomplete is undecided', () => {
    const input = site([{ path: '/', links: ['/en', '/fr'] }, { path: '/en' }, { path: '/fr' }]);
    const en = {
      links: [
        { hreflang: 'en', href: u('/en') },
        { hreflang: 'fr', href: u('/fr') },
        { hreflang: 'x-default', href: u('/en') },
      ],
      complete: true,
    };
    // /fr does not name /en: /en's annotation of /fr has no return, and /fr carries it.
    const fr = {
      links: [
        { hreflang: 'fr', href: u('/fr') },
        { hreflang: 'x-default', href: u('/fr') },
      ],
      complete: true,
    };
    const gap = withFields(withFields(input, '/en', { hreflang: en }), '/fr', { hreflang: fr });
    expect(detectHreflangGaps(gap).find(key('hreflang', '/en'))).toMatchObject({
      state: 'detected',
      conditions: ['hreflang_missing_return'],
      affected_urls: [u('/fr')],
    });
    const cut = withFields(gap, '/fr', { hreflang: { ...fr, complete: false } });
    expect(detectHreflangGaps(cut).find(key('hreflang', '/en'))).toMatchObject({
      state: 'indeterminate',
      reason: 'member_not_crawled',
    });
  });
});
