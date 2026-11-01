import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { site, u, type PageSpec } from '../../../fixtures/v2/detectors/builders.js';
import { detectGenericAnchors, hubsOf } from './generic-anchors.js';
import { TOP_HUB_FRACTION } from './thresholds.js';
import type { Detection } from './types.js';

const of = (out: Detection[], path: string) => out.find((d) => d.key === `anchors:${u(path)}`);

/** The homepage as the one hub (highest PageRank), with `total` links of which `generic` are generic. */
function hubSite(total: number, generic: number, extra: Partial<PageSpec> = {}) {
  const links = Array.from({ length: total }, (_, i) => ({ to: `/t${i}`, generic: i < generic }));
  return site([
    { path: '/', pr: 0.6, links, ...extra },
    ...Array.from({ length: total }, (_, i) => ({ path: `/t${i}`, pr: 0.4 / total })),
  ]);
}

describe('generic_anchor_text', () => {
  it('detects a hub with more than 50 % generic anchors (3 of 5)', () => {
    expect(of(detectGenericAnchors(hubSite(5, 3)), '/')).toMatchObject({
      state: 'detected',
      measured: 0.6,
      affected_urls: [u('/')],
    });
  });

  it('exactly 50 % neither opens nor clears: indeterminate (hysteresis)', () => {
    expect(of(detectGenericAnchors(hubSite(10, 5)), '/')).toMatchObject({
      state: 'indeterminate',
      reason: 'hysteresis_band',
      measured: 0.5,
    });
  });

  it('exactly 30 % is clear; 31 % is in the band', () => {
    expect(of(detectGenericAnchors(hubSite(10, 3)), '/')).toMatchObject({
      state: 'not_detected',
      measured: 0.3,
    });
    expect(of(detectGenericAnchors(hubSite(100, 31)), '/')).toMatchObject({
      state: 'indeterminate',
      reason: 'hysteresis_band',
    });
  });

  it('51 % is detected', () => {
    expect(of(detectGenericAnchors(hubSite(100, 51)), '/')).toMatchObject({ state: 'detected' });
  });

  it('a hub with fewer than 5 outbound links is indeterminate, whatever its anchors', () => {
    expect(of(detectGenericAnchors(hubSite(4, 4)), '/')).toMatchObject({
      state: 'indeterminate',
      reason: 'too_few_links',
    });
  });

  it('cites the generic links as evidence', () => {
    const d = of(detectGenericAnchors(hubSite(5, 3)), '/')!;
    expect(d.evidence.edges).toEqual(
      [0, 1, 2].map((i) => ({ from_url: u('/'), to_url: u(`/t${i}`) })),
    );
  });

  describe('links found but not recorded', () => {
    it('cannot decide when the unrecorded links could move the share across a threshold', () => {
      // 3 of 5 recorded are generic, 5 more found: the share lies between 3/10 and 8/10.
      expect(of(detectGenericAnchors(hubSite(5, 3, { links_out: 10 })), '/')).toMatchObject({
        state: 'indeterminate',
        reason: 'links_not_fully_recorded',
      });
    });

    it('decides when no outcome of the unrecorded links changes the verdict', () => {
      // 9 of 10 recorded are generic, 1 more found: at least 9/11 = 82 %.
      expect(of(detectGenericAnchors(hubSite(10, 9, { links_out: 11 })), '/')).toMatchObject({
        state: 'detected',
      });
      // 0 of 10 recorded are generic, 2 more found: at most 2/12 = 17 %.
      expect(of(detectGenericAnchors(hubSite(10, 0, { links_out: 12 })), '/')).toMatchObject({
        state: 'not_detected',
      });
    });

    it('counts unrecorded links toward the 5-link minimum', () => {
      // 4 recorded, all generic, 2 more found: 6 links, at least 4/6 = 67 %.
      expect(of(detectGenericAnchors(hubSite(4, 4, { links_out: 6 })), '/')).toMatchObject({
        state: 'detected',
      });
    });
  });

  describe('hubs', () => {
    it('are the top 5 % of crawled pages by PageRank share, at least one, ties broken by URL', () => {
      const pages = (n: number) =>
        site(
          Array.from({ length: n }, (_, i) => ({
            path: i === 0 ? '/' : `/p${String(i).padStart(2, '0')}`,
            pr: i < 3 ? 0.1 : 0.01,
          })),
        );
      // 20 pages → ceil(1.0) = 1 hub; 21 pages → ceil(1.05) = 2 hubs (hand-computed).
      expect(hubsOf(pages(20))).toEqual([u('/')]);
      expect(hubsOf(pages(21))).toEqual([u('/'), u('/p01')]);
    });

    it('only judges hubs', () => {
      expect(of(detectGenericAnchors(hubSite(5, 5)), '/t0')).toBeUndefined();
    });

    it('excludes pages that are not 200 or have no PageRank share', () => {
      const s = site([
        { path: '/', pr: 0.1 },
        { path: '/gone', status: 404, kind: 'status', pr: 0.9 },
        { path: '/none', pr: null },
      ]);
      expect(hubsOf(s)).toEqual([u('/')]);
    });

    it('uses the hub fraction exported by the v1 structure module', () => {
      const source = readFileSync(new URL('../../analysis/structure.ts', import.meta.url), 'utf8');
      expect(source).toMatch(/^export const TOP_HUB_FRACTION = 0\.05;$/m);
      expect(TOP_HUB_FRACTION).toBe(0.05);
    });
  });

  it('judges each hub by its own anchors, not the site-wide share (truth vector)', () => {
    // Hand-computed: the hub has 6 generic links of 10 (60 %); the 20 other pages each link once,
    // descriptively, so the site-wide share is 6/30 = 20 %, under every threshold.
    const hubLinks = Array.from({ length: 10 }, (_, i) => ({ to: `/t${i}`, generic: i < 6 }));
    const others = Array.from({ length: 20 }, (_, i) => ({
      path: `/t${i}`,
      pr: 0.01,
      links: ['/'],
    }));
    const s = site([{ path: '/', pr: 0.8, links: hubLinks }, ...others]);
    const siteWide = s.edges.filter((e) => e.is_generic_anchor).length / s.edges.length;
    expect(siteWide).toBe(0.2);
    expect(of(detectGenericAnchors(s), '/')).toMatchObject({ state: 'detected', measured: 0.6 });
  });
});
