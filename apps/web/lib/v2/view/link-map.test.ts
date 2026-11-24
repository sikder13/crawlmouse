import { checkMap } from '@crawlmouse/engine/v2/pipeline';
import { describe, expect, it } from 'vitest';
import { findCheck, fixture } from '../fixtures';
import { generatedGraph } from '../generated-graph';
import { layoutMap } from '../map-layout';
import { linkMapView, EXPLORER_SVG_MAX } from './link-map';
import { linksView } from './segment/links';
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

  it('says "not read" for a page whose links were not all read, never its count as links out', () => {
    // A page whose links were not all read has no count: links_out is 0 for a 404, partial for a cut body.
    const d = structuredClone(fixture('bad-site'));
    const page = d.page_results.find(
      (p) => p.check_id === BAD && p.url.endsWith('/products/ridge-2p'),
    )!;
    page.links_read = false;
    const ridge = linkMapView(d, BAD, { scope: 'hubs', asFirstSeen: true, hrefs }).details[
      '/products/ridge-2p'
    ]!;
    expect(ridge.facts.find((f) => f.label === 'Links out')).toEqual({
      label: 'Links out',
      value: 'not read',
    });
    expect(ridge.linksTo.heading).toBe('Links to · not read');
    expect(ridge.linksTo.more).toBeNull();
    // What the crawl did record from it is still listed.
    expect(ridge.linksTo.paths).toEqual(v.details['/products/ridge-2p']!.linksTo.paths);
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

describe('the drawing a finished check stores (checkMap, CC-20b D10)', () => {
  const pathOf = (url: string) => {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  };

  // The built check, which the check builder made; and the bad site's, whose hubs include a
  // JavaScript-only page, the one kind the layout places by whether the map is finished.
  it.each(['built-site', 'bad-site'] as const)(
    'is the drawing the explorer draws of the %s check: the same pages, kinds, lines and places',
    (name) => {
      const d = fixture(name);
      const id = FIRST_AUDIT[name];
      const stored = checkMap(
        d.page_results.filter((p) => p.check_id === id),
        d.link_edges.filter((e) => e.check_id === id),
      );
      const fromStored = stored.nodes.map((n) => ({
        path: pathOf(n.id),
        kind: n.kind,
        x: stored.positions[n.id]!.x,
        y: stored.positions[n.id]!.y,
        parent: n.parent ? pathOf(n.parent) : null,
        js: n.via === 'javascript',
      }));
      const drawn = linkMapView(d, id, { scope: 'hubs', hrefs }).nodes.map(
        ({ path, kind, x, y, parent, js }) => ({ path, kind, x, y, parent, js }),
      );
      expect(drawn.length).toBeGreaterThan(1);
      expect(fromStored).toEqual(drawn);
    },
  );

  it('the bad site’s drawing holds a JavaScript-only page, so the comparison sees the finished layout', () => {
    const d = fixture('bad-site');
    const id = FIRST_AUDIT['bad-site'];
    const stored = checkMap(
      d.page_results.filter((p) => p.check_id === id),
      d.link_edges.filter((e) => e.check_id === id),
    );
    expect(stored.nodes.some((n) => n.kind === 'js_only')).toBe(true);
  });
});

describe('a page that answered 404 or 410', () => {
  const d = fixture('built-site');
  const id = FIRST_AUDIT['built-site'];
  // Counted here from the record, apart from the code under test.
  const gone = d.page_results.filter(
    (p) => p.check_id === id && (p.status_code === 404 || p.status_code === 410),
  );

  it('is labelled missing with its own code, not drawn as a page with a depth', () => {
    expect(gone.map((p) => p.status_code)).toEqual([404]);
    const path = new URL(gone[0]!.url).pathname;
    const v = linkMapView(d, id, { scope: 'all', hrefs });
    const node = v.nodes.find((n) => n.path === path)!;
    expect(node).toMatchObject({ missing: 'missing (404)', depth: null });
    expect(v.details[path]!.pills[0]).toEqual({ state: 'bad', label: 'missing (404)' });
    expect(v.details[path]!.depth).toBeNull();
    expect(v.nodes.filter((n) => n.missing !== null)).toHaveLength(gone.length);
  });

  it('is counted apart in the title: "N pages, M missing"', () => {
    const crawled = findCheck(d, id).coverage!.pages_crawled;
    const links = findCheck(d, id).structure!.internal_links;
    expect(linkMapView(d, id, { scope: 'all', hrefs }).title).toBe(
      `${crawled - gone.length} pages, ${gone.length} missing, ${links} links.`,
    );
  });

  it('uses the code it answered: a 410 reads "missing (410)"', () => {
    const copy = structuredClone(d);
    const page = copy.page_results.find((p) => p.url === gone[0]!.url)!;
    page.status_code = 410;
    const path = new URL(page.url).pathname;
    expect(
      linkMapView(copy, id, { scope: 'all', hrefs }).nodes.find((n) => n.path === path)!.missing,
    ).toBe('missing (410)');
  });

  it('counts a URL redirecting to a missing page the record holds once, as Links and pages does', () => {
    // /products/old-dome-tent redirects to the missing /products/retired-tent, which the record
    // also holds: one missing page, reached two ways.
    const copy = structuredClone(d);
    const at = (p: string) =>
      copy.page_results.find((x) => x.check_id === id && new URL(x.url).pathname === p)!;
    const old = at('/products/old-dome-tent');
    const retired = at('/products/retired-tent');
    Object.assign(old, {
      status_code: 404,
      final_url: retired.url,
      redirect: { hops: [{ from: old.url, status: 301, location: retired.url }], loop: false },
      links_out: 0,
      links_read: false,
      content_simhash: null,
      title: null,
      meta_description: null,
    });
    // Counted here from the record: the distinct URLs where a 404 or 410 answered.
    const answered = new Set(
      copy.page_results
        .filter((p) => p.check_id === id && (p.status_code === 404 || p.status_code === 410))
        .map((p) => ((p.redirect?.hops.length ?? 0) > 0 ? p.final_url! : p.url)),
    );
    expect(answered.size).toBe(1);
    const v = linkMapView(copy, id, { scope: 'all', hrefs });
    const links = linksView(copy, id);
    expect(v.title).toMatch(/, 1 missing, /);
    expect(links.counts.broken + links.counts.missingUnlinked).toBe(answered.size);
    const node = v.nodes.find((n) => n.path === '/products/old-dome-tent');
    expect(node).toBeDefined();
    expect(node!.missing).toBe('redirects to a missing page (404)');
  });

  it('calls a redirect to a 404 whose final URL is not recorded missing where Links lists it', () => {
    // /products/old-dome-tent redirects and answered 404, and where it ended is not recorded: the
    // request answered at its own URL as far as the record shows, so the map and Links and pages
    // both name that URL as the missing page.
    const copy = structuredClone(d);
    const old = copy.page_results.find(
      (x) => x.check_id === id && new URL(x.url).pathname === '/products/old-dome-tent',
    )!;
    expect(old.redirect?.hops.length).toBeGreaterThan(0);
    Object.assign(old, {
      status_code: 404,
      final_url: null,
      links_out: 0,
      links_read: false,
      content_simhash: null,
      title: null,
      meta_description: null,
    });
    const node = linkMapView(copy, id, { scope: 'all', hrefs }).nodes.find(
      (n) => n.path === '/products/old-dome-tent',
    );
    expect(node).toBeDefined();
    expect(node!.missing).toBe('missing (404)');
    const links = linksView(copy, id);
    expect(
      [...links.broken.rows, ...links.unlinked.rows]
        .filter((r) => r.status === 404)
        .map((r) => [r.path, r.via]),
    ).toEqual(expect.arrayContaining([['/products/old-dome-tent', []]]));
  });

  it('counts pages and missing pages the same way, so the two add up to the pages crawled', () => {
    // 10 pages crawled and recorded; /products/old-dome-tent answered 404 after a redirect to
    // /products/retired-tent, which the record also holds answering 404. Two records, one missing
    // URL: 9 pages and 1 missing, worked out by hand.
    const copy = structuredClone(d);
    const at = (p: string) =>
      copy.page_results.find((x) => x.check_id === id && new URL(x.url).pathname === p)!;
    const old = at('/products/old-dome-tent');
    const retired = at('/products/retired-tent');
    const others = copy.page_results
      .filter((p) => p.check_id === id && p.status_code === 200 && p !== old && p !== retired)
      .filter((_, i) => i < 8);
    expect(others).toHaveLength(8);
    copy.page_results = [
      ...copy.page_results.filter((p) => p.check_id !== id),
      ...others,
      old,
      retired,
    ];
    Object.assign(retired, { status_code: 404, links_out: 0, links_read: false });
    Object.assign(old, {
      status_code: 404,
      final_url: retired.url,
      redirect: { hops: [{ from: old.url, status: 301, location: retired.url }], loop: false },
      links_out: 0,
      links_read: false,
      content_simhash: null,
      title: null,
      meta_description: null,
    });
    const check = copy.checks.find((c) => c.id === id)!;
    check.coverage!.pages_crawled = 10;
    const links = check.structure!.internal_links;
    expect(linkMapView(copy, id, { scope: 'all', hrefs }).title).toBe(
      `9 pages, 1 missing, ${links} links.`,
    );
  });

  it('scopes the missing count to the pages checked when the record holds fewer than were crawled', () => {
    const copy = structuredClone(d);
    const check = copy.checks.find((c) => c.id === id)!;
    const records = copy.page_results.filter((p) => p.check_id === id).length;
    check.coverage!.pages_crawled = records + 40;
    const links = check.structure!.internal_links;
    expect(linkMapView(copy, id, { scope: 'all', hrefs }).title).toBe(
      `${records + 40 - gone.length} pages, ${gone.length} missing among the ${records} checked, ${links} links.`,
    );
  });

  it('leaves the title alone on a record with no missing page', () => {
    const bad = fixture('bad-site');
    expect(linkMapView(bad, FIRST_AUDIT['bad-site'], { scope: 'hubs', hrefs }).title).not.toMatch(
      /missing/,
    );
  });
});
