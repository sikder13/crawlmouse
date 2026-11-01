import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import { site, u } from '../../../fixtures/v2/detectors/builders.js';
import { detectOrphans as v1DetectOrphans } from '../../analysis/orphans.js';
import type { SiteGraph } from '../../graph.js';
import { detectOrphans } from './orphans.js';
import type { Detection } from './types.js';

const of = (out: Detection[], path: string) => out.find((d) => d.key === `orphan:${u(path)}`);

/** Home links to /a and /b; /c has no inbound link. */
const SHAPE = [
  { path: '/', links: ['/a', '/b'] },
  { path: '/a', links: ['/'] },
  { path: '/b', links: [] },
  { path: '/c', links: ['/a'] },
];

describe('orphan_pages', () => {
  it('detects a gradeable 200 page no crawled 200 page links to, on a complete crawl', () => {
    const out = detectOrphans(site(SHAPE));
    expect(of(out, '/c')).toMatchObject({
      type: 'orphan_pages',
      state: 'detected',
      reason: null,
      measured: 0,
      affected_urls: [u('/c')],
    });
  });

  it('does not detect a page with an inbound link, and cites the link', () => {
    const d = of(detectOrphans(site(SHAPE)), '/b');
    expect(d).toMatchObject({ state: 'not_detected', measured: 1 });
    expect(d!.evidence.edges).toEqual([{ from_url: u('/'), to_url: u('/b') }]);
  });

  it('never judges the homepage', () => {
    expect(of(detectOrphans(site(SHAPE)), '/')).toBeUndefined();
  });

  it('counts only links from crawled 200 pages: one from a 404 page is no inbound link (truth vector)', () => {
    // Hand-computed: /d's only linker answers 404, so no crawled 200 page links to /d. The v1 graph
    // counts every edge between crawled nodes and reports /d as linked, so it disagrees here.
    const specs = [
      { path: '/', links: ['/gone'] },
      { path: '/gone', status: 404, kind: 'status' as const, links: ['/d'] },
      { path: '/d', links: [] },
    ];
    expect(of(detectOrphans(site(specs)), '/d')).toMatchObject({ state: 'detected', measured: 0 });
    const g: SiteGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
    for (const s of specs) g.addNode(u(s.path), { urlHash: s.path, statusCode: s.status ?? 200 });
    for (const s of specs)
      for (const t of s.links)
        g.addDirectedEdge(u(s.path), u(t), { anchorText: '', isGenericAnchor: false });
    expect(v1DetectOrphans(g, u('/')).orphans).not.toContain(u('/d'));
  });

  it('ignores a self-link', () => {
    // The worker counts neither a self-link edge nor a self-link in links_out (crawl.ts edgesFrom).
    const out = detectOrphans(
      site([
        { path: '/', links: [] },
        { path: '/s', links: ['/s'], links_out: 0 },
      ]),
    );
    expect(of(out, '/s')).toMatchObject({ state: 'detected' });
  });

  it('does not judge pages that are not gradeable content', () => {
    const out = detectOrphans(
      site([
        { path: '/', links: [] },
        { path: '/tag/x', kind: 'archive' },
      ]),
    );
    expect(of(out, '/tag/x')).toBeUndefined();
  });

  describe('the cap-safe rule: a truncated crawl never asserts an orphan', () => {
    it('coverage exactly 90 % is not truncated', () => {
      // 9 crawled of 10 discovered.
      const specs = [
        { path: '/', links: [] },
        ...Array.from({ length: 8 }, (_, i) => ({ path: `/p${i}` })),
      ];
      expect(of(detectOrphans(site(specs, { discovered: 10 })), '/p0')).toMatchObject({
        state: 'detected',
      });
    });

    it('coverage just under 90 % is truncated', () => {
      // 9 crawled of 11 discovered: 81.8 %.
      const specs = [
        { path: '/', links: [] },
        ...Array.from({ length: 8 }, (_, i) => ({ path: `/p${i}` })),
      ];
      expect(of(detectOrphans(site(specs, { discovered: 11 })), '/p0')).toMatchObject({
        state: 'indeterminate',
        reason: 'crawl_truncated',
      });
      // 90 crawled of 101 discovered: 89.1 %, the first count under the line at this size.
      const many = [
        { path: '/', links: [] },
        ...Array.from({ length: 89 }, (_, i) => ({ path: `/p${i}` })),
      ];
      expect(of(detectOrphans(site(many, { discovered: 101 })), '/p0')).toMatchObject({
        state: 'indeterminate',
      });
      expect(of(detectOrphans(site(many, { discovered: 100 })), '/p0')).toMatchObject({
        state: 'detected',
      });
    });

    it('reaching the page cap is truncated; one page under it is not', () => {
      expect(of(detectOrphans(site(SHAPE, { cap: 4 })), '/c')).toMatchObject({
        state: 'indeterminate',
        reason: 'crawl_truncated',
      });
      expect(of(detectOrphans(site(SHAPE, { cap: 5 })), '/c')).toMatchObject({ state: 'detected' });
    });

    it('a partial check (a budget spent, the site stopped) is truncated', () => {
      expect(of(detectOrphans(site(SHAPE, { status: 'partial' })), '/c')).toMatchObject({
        state: 'indeterminate',
        reason: 'crawl_truncated',
      });
    });

    it('a check without coverage is treated as truncated', () => {
      const input = site(SHAPE);
      expect(
        of(detectOrphans({ ...input, check: { ...input.check, coverage: null } }), '/c'),
      ).toMatchObject({
        state: 'indeterminate',
        reason: 'crawl_truncated',
      });
    });

    it('a truncated crawl still proves a page linked', () => {
      expect(of(detectOrphans(site(SHAPE, { cap: 4 })), '/b')).toMatchObject({
        state: 'not_detected',
      });
    });
  });

  it('is indeterminate when a crawled page had links that were not recorded', () => {
    // /a found 3 distinct links and only 1 was recorded: the 2 others could point at /c.
    const specs = SHAPE.map((s) => (s.path === '/a' ? { ...s, links_out: 3 } : s));
    expect(of(detectOrphans(site(specs)), '/c')).toMatchObject({
      state: 'indeterminate',
      reason: 'links_not_fully_recorded',
    });
  });

  it('is indeterminate when a crawled page answered 429 or 5xx, whose links were not seen', () => {
    for (const status of [429, 500, 503]) {
      const specs = [...SHAPE, { path: '/down', status, kind: 'status' as const }];
      expect(of(detectOrphans(site(specs)), '/c')).toMatchObject({
        state: 'indeterminate',
        reason: 'links_not_fully_recorded',
      });
    }
  });

  it('still decides when crawled pages answered a redirect or a 4xx, which show no links', () => {
    for (const status of [301, 403, 404]) {
      const specs = [...SHAPE, { path: '/other', status, kind: 'status' as const }];
      expect(of(detectOrphans(site(specs)), '/c')).toMatchObject({ state: 'detected' });
    }
  });

  it('reports a page that now answers 404 or 410 as gone, never as fixed', () => {
    for (const status of [404, 410] as const) {
      const out = detectOrphans(
        site([
          { path: '/', links: ['/x'] },
          { path: '/x', status, kind: 'status' },
        ]),
      );
      expect(of(out, '/x')).toMatchObject({
        state: 'indeterminate',
        reason: 'page_gone',
        page_gone: { status_code: status },
      });
    }
  });

  it('is indeterminate for a linked URL that was not crawled', () => {
    const out = detectOrphans(site([{ path: '/', links: ['/never'] }]));
    expect(of(out, '/never')).toMatchObject({ state: 'indeterminate', reason: 'not_crawled' });
  });

  it('sets page_gone only on gone pages, and a reason exactly when indeterminate', () => {
    for (const d of detectOrphans(site(SHAPE))) {
      expect(d.page_gone).toBeNull();
      expect(d.reason === null).toBe(d.state !== 'indeterminate');
    }
  });
});
