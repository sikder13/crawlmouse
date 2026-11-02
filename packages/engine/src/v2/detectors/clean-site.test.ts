import { describe, expect, it } from 'vitest';
import { simhashAway, site, u, type PageSpec } from '../../../fixtures/v2/detectors/builders.js';
import { detectStructure } from './index.js';
import type { HreflangLink } from './types.js';

const BASE = '0f0f0f0f0f0f0f0f';
const alternates: HreflangLink[] = [
  { lang: 'en', href: u('/en') },
  { lang: 'fr', href: u('/fr') },
  { lang: 'x-default', href: u('/en') },
];

/** A page with every fact read, consistent with itself: no redirect, self-canonical. */
const sound = (spec: PageSpec, n: number, extra: PageSpec['facts'] = {}): PageSpec => ({
  ...spec,
  facts: {
    final_url: u(spec.path),
    redirect: { hops: 0, loop: false },
    canonical: { href: u(spec.path) },
    simhash: simhashAway(BASE, n * 8),
    ...extra,
  },
});

/** Every fact read, nothing wrong: a complete crawl of a small, well-linked site. */
const CLEAN = site([
  sound({ path: '/', pr: 0.4, links: ['/blog', '/about', '/en', '/fr', '/post-1', '/post-2'] }, 0),
  sound({ path: '/about', pr: 0.05, links: ['/'] }, 1),
  sound({ path: '/blog', pr: 0.2, links: ['/post-1', '/post-2', '/blog/page/2', '/'] }, 2),
  sound(
    {
      path: '/blog/page/2',
      kind: 'pagination',
      template: '/blog/page/{n}',
      pr: 0.05,
      links: ['/post-3', '/blog'],
    },
    3,
  ),
  sound({ path: '/post-1', pr: 0.07, links: ['/blog'] }, 4),
  sound({ path: '/post-2', pr: 0.07, links: ['/blog'] }, 5),
  sound({ path: '/post-3', pr: 0.06, links: ['/blog'] }, 6),
  sound({ path: '/en', pr: 0.05, links: ['/'] }, 7, { hreflang: alternates }),
  sound({ path: '/fr', pr: 0.05, links: ['/'] }, 8, { hreflang: alternates }),
]);

describe('a clean site', () => {
  it('no detector fires, and every fingerprint is decided', () => {
    const out = detectStructure(CLEAN);
    expect(out.filter((d) => d.state !== 'not_detected')).toEqual([]);
    expect(new Set(out.map((d) => d.type))).toEqual(
      new Set([
        'orphan_pages',
        'deep_pages',
        'generic_anchor_text',
        'redirect_chain',
        'duplicate_pagination',
        'canonical_mismatch',
        'hreflang_gap',
      ]),
    );
  });

  it('is sorted by type, then key', () => {
    const out = detectStructure(CLEAN);
    const order = out.map((d) => `${d.type}\u0000${d.key}`);
    expect(order).toEqual([...order].sort());
  });

  it('does not read the PageResult fields the detectors recompute (links_in, is_orphan, depth)', () => {
    const lying = {
      ...CLEAN,
      pages: CLEAN.pages.map((p) => ({ ...p, links_in: 0, is_orphan: true, depth: 99 })),
    };
    expect(detectStructure(lying)).toEqual(detectStructure(CLEAN));
  });

  it('rejects an input that lists one URL twice', () => {
    expect(() => detectStructure({ ...CLEAN, pages: [...CLEAN.pages, CLEAN.pages[1]!] })).toThrow(
      /twice/,
    );
    const cart = { url: u('/cart'), robots_search: CLEAN.pages[0]!.robots_search };
    expect(() => detectStructure({ ...CLEAN, disallowed: [cart, cart] })).toThrow(/twice/);
  });

  it('rejects a URL that is both crawled and disallowed, or an exclusion count the list does not give', () => {
    const crawled = { url: CLEAN.pages[1]!.url, robots_search: CLEAN.pages[1]!.robots_search };
    expect(() => detectStructure({ ...CLEAN, disallowed: [crawled] })).toThrow(/both crawled/);
    const coverage = { ...CLEAN.check.coverage!, excluded_by_robots: 1 };
    expect(() => detectStructure({ ...CLEAN, check: { ...CLEAN.check, coverage } })).toThrow(
      /excluded by robots/,
    );
  });
});
