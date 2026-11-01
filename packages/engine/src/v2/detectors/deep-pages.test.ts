import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import {
  coverageOf,
  page,
  site,
  u,
  type PageSpec,
} from '../../../fixtures/v2/detectors/builders.js';
import { computeDepth } from '../../analysis/depth.js';
import type { SiteGraph } from '../../graph.js';
import { detectDeepPages, strataOverlap } from './deep-pages.js';
import type { Detection } from './types.js';

const of = (out: Detection[], path: string) => out.find((d) => d.key === `depth:${u(path)}`);

/** A chain: / → /d1 → /d2 → /d3 → /d4 → /d5. */
const CHAIN: PageSpec[] = [
  { path: '/', links: ['/d1'] },
  { path: '/d1', links: ['/d2'] },
  { path: '/d2', links: ['/d3'] },
  { path: '/d3', links: ['/d4'] },
  { path: '/d4', links: ['/d5'] },
  { path: '/d5', links: [] },
];

describe('deep_pages', () => {
  it('is not detected at exactly 3 clicks and detected at 4', () => {
    const out = detectDeepPages(site(CHAIN));
    expect(of(out, '/d3')).toMatchObject({ state: 'not_detected', measured: 3 });
    expect(of(out, '/d4')).toMatchObject({
      state: 'detected',
      measured: 4,
      affected_urls: [u('/d4')],
    });
    expect(of(out, '/d5')).toMatchObject({ state: 'detected', measured: 5 });
  });

  it('cites the path from the homepage as evidence', () => {
    const d = of(detectDeepPages(site(CHAIN)), '/d4')!;
    expect(d.evidence.pages).toEqual([u('/'), u('/d1'), u('/d2'), u('/d3'), u('/d4')].sort());
  });

  it('takes the shortest path (truth vector: a shortcut makes /d5 two clicks deep)', () => {
    const specs = CHAIN.map((s) => (s.path === '/d1' ? { ...s, links: ['/d2', '/d5'] } : s));
    expect(of(detectDeepPages(site(specs)), '/d5')).toMatchObject({
      state: 'not_detected',
      measured: 2,
    });
  });

  it('detects a page no path from the homepage reaches, with no measured depth', () => {
    const out = detectDeepPages(
      site([
        { path: '/', links: [] },
        { path: '/island', links: [] },
      ]),
    );
    expect(of(out, '/island')).toMatchObject({ state: 'detected', measured: null });
  });

  it('is indeterminate everywhere when the homepage was not crawled (truth vector against v1 re-rooting)', () => {
    // v1's computeDepth re-roots at pages with no inbound link when the homepage is missing, so it
    // puts /d2 one click deep. The depth from the homepage is unknown, so nothing can be claimed.
    const specs = CHAIN.filter((s) => s.path !== '/');
    const out = detectDeepPages(site(specs));
    expect(out.length).toBeGreaterThan(0);
    for (const d of out) expect(d).toMatchObject({ state: 'indeterminate' });
    expect(of(out, '/d2')).toMatchObject({ reason: 'homepage_not_crawled' });
    const g: SiteGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
    for (const s of specs) g.addNode(u(s.path), { urlHash: s.path, statusCode: 200 });
    for (const s of specs)
      for (const t of s.links ?? [])
        g.addDirectedEdge(u(s.path), u(t as string), { anchorText: '', isGenericAnchor: false });
    expect(computeDepth(g, u('/')).get(u('/d2'))).toBe(1);
  });

  it('on a truncated crawl, a deep page is indeterminate but a shallow one is still proven shallow', () => {
    // Unfetched pages can only add links, which can only shorten a path.
    const out = detectDeepPages(site(CHAIN, { cap: CHAIN.length }));
    expect(of(out, '/d4')).toMatchObject({ state: 'indeterminate', reason: 'crawl_truncated' });
    expect(of(out, '/d2')).toMatchObject({ state: 'not_detected', measured: 2 });
  });

  it('is indeterminate for a deep page when links were not recorded', () => {
    const specs = CHAIN.map((s) => (s.path === '/' ? { ...s, links_out: 2 } : s));
    expect(of(detectDeepPages(site(specs)), '/d4')).toMatchObject({
      state: 'indeterminate',
      reason: 'links_not_fully_recorded',
    });
  });

  describe('comparing samples', () => {
    const counts = (n: Record<string, number>) =>
      coverageOf(
        Object.entries(n).flatMap(([t, k]) =>
          Array.from({ length: k }, (_, i) => page({ path: `${t}-${i}`, template: t })),
        ),
        Object.values(n).reduce((a, b) => a + b, 0),
      );

    it('measures overlap as the template-weighted Jaccard of page counts', () => {
      // Hand-computed: min 9+1 = 10, max 10+1 = 11 → 10/11.
      expect(
        strataOverlap(counts({ '/a': 10, '/b': 1 }), counts({ '/a': 9, '/b': 1 })),
      ).toBeCloseTo(10 / 11, 12);
      expect(strataOverlap(counts({ '/a': 10 }), counts({ '/b': 10 }))).toBe(0);
    });

    it('is indeterminate under 90 % overlap and decides at exactly 90 %', () => {
      const current = site(CHAIN).check.coverage!; // 6 templates: '/' and '/d1/{slug}'..'/d5/{slug}', 1 page each
      // Previous: the same six, plus '/x/{slug}' with 1 page → 6/7 = 85.7 %.
      const below = {
        ...current,
        templates: [...current.templates, { template_key: '/x/{slug}', label: 'x', pages: 1 }],
      };
      expect(of(detectDeepPages(site(CHAIN, { previous: below })), '/d4')).toMatchObject({
        state: 'indeterminate',
        reason: 'sample_changed',
      });
      expect(of(detectDeepPages(site(CHAIN, { previous: below })), '/d2')).toMatchObject({
        state: 'indeterminate',
        reason: 'sample_changed',
      });
      // A previous sample of 9 of these 10 templates, one page each: 9/10, exactly 90 %.
      const nine = site([
        ...CHAIN,
        { path: '/e1' },
        { path: '/e2' },
        { path: '/e3' },
        { path: '/e4' },
      ]);
      const prevNine = {
        ...nine.check.coverage!,
        templates: nine.check.coverage!.templates.slice(0, 9),
      };
      expect(strataOverlap(prevNine, nine.check.coverage!)).toBe(0.9);
      expect(of(detectDeepPages({ ...nine, previous_coverage: prevNine }), '/d4')).toMatchObject({
        state: 'detected',
      });
    });
  });

  it('reports a gone page as gone and a linked uncrawled URL as not crawled', () => {
    const out = detectDeepPages(
      site([
        { path: '/', links: ['/x', '/never'] },
        { path: '/x', status: 410, kind: 'status' },
      ]),
    );
    expect(of(out, '/x')).toMatchObject({
      state: 'indeterminate',
      reason: 'page_gone',
      page_gone: { status_code: 410 },
    });
    expect(of(out, '/never')).toMatchObject({ state: 'indeterminate', reason: 'not_crawled' });
  });
});
