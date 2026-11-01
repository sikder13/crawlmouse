/**
 * docs/tickets/2026-08-07-orphan-under-cap.md as a CI case: the page cap must not manufacture orphans.
 */
import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import { PAGES, wordpressUnderCap } from '../../../fixtures/v2/detectors/wordpress-under-cap.js';
import { detectOrphans as v1DetectOrphans } from '../../analysis/orphans.js';
import type { SiteGraph } from '../../graph.js';
import { detectOrphans } from './orphans.js';
import type { DetectorInput } from './types.js';

/** The v1 rule over the same crawl: a crawled page with no inbound edge from a crawled page. */
function v1Orphans(input: DetectorInput): string[] {
  const g: SiteGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
  for (const p of input.pages) g.addNode(p.url, { urlHash: p.url, statusCode: p.status_code });
  for (const e of input.edges) {
    if (g.hasNode(e.to_url) && !g.hasEdge(e.from_url, e.to_url)) {
      g.addDirectedEdge(e.from_url, e.to_url, {
        anchorText: e.anchor_text,
        isGenericAnchor: e.is_generic_anchor,
      });
    }
  }
  return v1DetectOrphans(g, input.homepage_url).orphans;
}

const count = (input: DetectorInput, state: string) =>
  detectOrphans(input).filter((d) => d.state === state).length;

describe('orphan-under-cap: the WordPress shape from the ticket', () => {
  it.each([500, 2000])('reports zero detected orphans at cap %i', (cap) => {
    const input = wordpressUnderCap(cap);
    // The fixture reproduces the class: the v1 rule finds a hundred or more false orphans here.
    expect(v1Orphans(input).length).toBeGreaterThanOrEqual(100);
    expect(count(input, 'detected')).toBe(0);
    expect(count(input, 'indeterminate')).toBeGreaterThanOrEqual(100);
  });

  it("a complete crawl (a cap above the site's size) finds none either, and proves every post linked", () => {
    const input = wordpressUnderCap(PAGES + 1);
    expect(v1Orphans(input)).toEqual([]);
    expect(count(input, 'detected')).toBe(0);
    expect(count(input, 'not_detected')).toBe(5000);
  });

  it('a complete crawl still finds a real orphan (the rule is not "never detect")', () => {
    const input = wordpressUnderCap(PAGES + 1);
    const cut = 'https://a.test/post-4321';
    // Remove the link from the page as well as the edge, so the page's link count still agrees.
    const linkers = new Set(input.edges.filter((e) => e.to_url === cut).map((e) => e.from_url));
    const edges = input.edges.filter((e) => e.to_url !== cut);
    const pages = input.pages.map((p) =>
      linkers.has(p.url) ? { ...p, links_out: p.links_out - 1 } : p,
    );
    const out = detectOrphans({ ...input, pages, edges });
    expect(out.filter((d) => d.state === 'detected').map((d) => d.affected_urls[0])).toEqual([cut]);
  });
});
