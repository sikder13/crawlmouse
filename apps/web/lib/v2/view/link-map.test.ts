import { describe, expect, it } from 'vitest';
import { findCheck, fixture } from '../fixtures';
import { generatedGraph } from '../generated-graph';
import { layoutMap } from '../map-layout';
import { linkMapView, EXPLORER_SVG_MAX } from './link-map';
import { structureView } from './segment/structure';
import { FIRST_AUDIT } from './segment/test-helpers';

const BAD = FIRST_AUDIT['bad-site'];
const hrefs = {
  overview: '/o',
  segment: (k: string) => `/s/${k}`,
  fix: (id: string) => `/f/${id}`,
  map: { hubs: '/m', all: '/m/all' },
};

describe('linkMapView: the hubs and their neighbours (Final-LinkMap)', () => {
  const v = linkMapView(fixture('bad-site'), BAD, { scope: 'hubs', asFirstSeen: true, hrefs });

  it('heads with the crawl’s pages and links, as the Structure page counts them', () => {
    const s = structureView(fixture('bad-site'), BAD, { asFirstSeen: true });
    const tile = (label: string) => s.tiles.find((t) => t.label === label)!.value;
    expect(v.title).toBe(`${tile('Pages')} pages, ${tile('Internal links')} links.`);
    expect(v.title).toBe('214 pages, 779 links.');
  });

  it('draws the hubs found among the pages the record holds, and says how many it holds', () => {
    expect(v.nodes).toHaveLength(8);
    expect(v.caption).toBe(
      'Zoomed to the hubs and their neighbours, 8 of 214. The audit’s record holds 16 of its 214 pages and 11 of its 779 links, so the hubs are found among those. Select a page to see what links to it, what it links to, and which crawlers reach it.',
    );
    expect(v.explore).toEqual({ label: 'Explore all 214', href: '/m/all' });
    expect(v.renderer).toBe('svg');
  });

  it('counts each filter as the Structure page does, and says how many are drawn', () => {
    expect(v.filters.map((f) => [f.label, f.ids.length])).toEqual([
      ['Orphans · 7', 0],
      ['JavaScript-only · 5', 1],
      ['Deeper than 3 clicks · 3', 0],
    ]);
    expect(v.filters[1]!.note).toBe('5 JavaScript-only pages; 1 of them is on this drawing.');
  });

  it('orders the pages for the keyboard by depth, then URL, with every drawn page once', () => {
    expect(v.order[0]).toBe('/');
    expect(new Set(v.order)).toEqual(new Set(v.nodes.map((n) => n.path)));
    expect(v.order).toHaveLength(v.nodes.length);
    const depths = v.order.map((p) => v.details[p]?.depth ?? Infinity);
    expect([...depths].sort((a, b) => a - b)).toEqual(depths);
  });

  it('selects first a page with crawler evidence whose template has a free fix, and links it', () => {
    expect(v.initial).toBe('/products/ridge-2p');
    const ridge = v.details['/products/ridge-2p']!;
    expect(ridge.fix).toEqual({
      label: 'Open the fix for this template',
      href: '/f/f0000000-0000-4000-8000-000000000002',
    });
  });

  it('gives a page’s figures from its record, and its links with their anchors', () => {
    const ridge = v.details['/products/ridge-2p']!;
    expect(ridge.pills).toEqual([
      { state: 'neutral', label: 'depth 2' },
      { state: 'bad', label: '12% text without JS' },
    ]);
    expect(ridge.facts).toEqual([
      { label: 'Links in', value: '3' },
      { label: 'Links out', value: '12' },
      { label: 'Share of internal PageRank', value: '0.4%' },
      { label: 'AI crawlers that reach it', value: '4 of 6' },
      { label: 'AI crawlers that read its text', value: '0 of 6' },
    ]);
    expect(ridge.linkedFrom).toEqual({
      heading: 'Linked from · 3',
      lines: [
        { path: '/collections/tents', anchor: 'Ridge 2P', generic: false },
        { path: '/collections/sleep', anchor: 'Shop now', generic: true },
        { path: '/blog/winter-camping', anchor: 'the Ridge 2P', generic: false },
      ],
      more: null,
    });
    expect(ridge.linksTo).toEqual({
      heading: 'Links to · 12',
      paths: [
        '/collections/tents',
        '/collections/sleep',
        '/products/alpine-stove',
        '/products/trail-mug',
        '/blog/winter-camping',
      ],
      more: '7 more, not in this record',
    });
  });

  it('lists the crawler requests the record holds for a page, and says how many it holds', () => {
    const access = v.details['/products/ridge-2p']!.access!;
    expect(access.rows.map((r) => [r.ua, r.verdict, r.words])).toEqual([
      // The search engines, read from robots.txt (FACTS B2), with what a renderer gets.
      ['Googlebot, Bingbot', 'allowed', 'renders 1,120 words'],
      ['OAI-SearchBot', 'allowed_thin', '134 words'],
      ['Claude-SearchBot', 'allowed_thin', '134 words'],
    ]);
    expect(access.rows[0]!.qualifier).toBe('by robots.txt');
    expect(access.note).toBe('2 of the 6 AI crawlers’ requests for this page are in the record.');
    expect(access.tagged).toBe(
      'Tested with tagged user agents from published IPs — crawlmouse.com/bot.',
    );
  });
});

describe('linkMapView: every page', () => {
  it('draws the crawl’s whole map, with the Structure page’s kinds and counts', () => {
    const v = linkMapView(fixture('bad-site'), BAD, { scope: 'all', asFirstSeen: true, hrefs });
    const s = structureView(fixture('bad-site'), BAD, { asFirstSeen: true });
    expect(v.nodes).toHaveLength(214);
    expect(v.nodes.filter((n) => n.kind === 'orphan')).toHaveLength(Number(s.tiles[2]!.value));
    expect(v.nodes.filter((n) => n.kind === 'js_only')).toHaveLength(Number(s.tiles[3]!.value));
    expect(v.filters.map((f) => f.ids.length)).toEqual([7, 5, 3]);
    expect(v.explore).toBeNull();
    // A page with no record says so, and says how much the record holds.
    const bare = v.nodes.find((n) => !v.details[n.path])!;
    expect(bare).toBeDefined();
    expect(v.reduced).toBe(
      'The audit’s record holds 16 of its 214 pages; this page’s figures are not among them.',
    );
  });

  it('draws the generated 2,000-node graph on the canvas, with no record and no fix', () => {
    const nodes = generatedGraph(2_000, 2026);
    const v = linkMapView(fixture('bad-site'), BAD, {
      scope: 'all',
      asFirstSeen: true,
      hrefs,
      generated: { nodes, positions: layoutMap(nodes) },
    });
    expect(v.renderer).toBe('canvas');
    expect(EXPLORER_SVG_MAX).toBe(500);
    expect(v.nodes).toHaveLength(2_000);
    // Every page but the home page and the 153 orphans (every 13th of 1..1,999) hangs from a link.
    expect(v.title).toBe('2,000 pages, 1,846 links.');
    expect(Object.keys(v.details)).toHaveLength(0);
    expect(v.keep).not.toBeNull();
  });

  it('shows a check whose record holds no page as its drawing alone', () => {
    const d = fixture('challenged-site');
    const id = FIRST_AUDIT['challenged-site'];
    const v = linkMapView(d, id, { scope: 'hubs' });
    // No record to find hubs in: every page is drawn instead.
    expect(v.nodes).toHaveLength(findCheck(d, id).coverage!.pages_crawled);
    expect(v.explore).toBeNull();
    expect(Object.keys(v.details)).toHaveLength(0);
  });
});
