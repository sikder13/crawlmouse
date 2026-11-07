import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES, type FixtureName } from '../../fixtures';
import { structureView } from './structure';
import { asFirstSeen, edited } from './test-helpers';

/**
 * Fixtures the structure view has no map drawing of yet, and why; null for one it draws. Listed in
 * CC-20a's PR under "Found by the built fixture", for CC-20b.
 */
const UNDRAWN: Record<FixtureName, string | null> = {
  'bad-site': null,
  'clean-site': null,
  'challenged-site': null,
  'built-site':
    'no drawing is stored for a built check: drawingOf finds a drawing through the synthesised crawl recordings only',
};

const view = (name: FixtureName, edit?: Parameters<typeof edited>[1]) => {
  const { d, id } = edited(name, edit);
  return structureView(d, id, { asFirstSeen: asFirstSeen(name) });
};

describe('structureView: the verdict', () => {
  it('heads the page with the orphan count, and the site-structure score as the door’s pill', () => {
    const v = view('bad-site');
    expect(v.headline.title).toBe('Seven pages have no links pointing at them.');
    expect(v.headline.pill).toEqual({ state: 'neutral', label: '74 / 100' });
    expect(view('bad-site', (c) => (c.structure!.orphan_pages = 1)).headline.title).toBe(
      'One page has no links pointing at it.',
    );
    expect(view('clean-site').headline.title).toBe('Every page crawled has a link pointing at it.');
  });

  it('says "not graded" when the check has no site-structure score', () => {
    const v = view('bad-site', (c) => (c.technical_seo!.site_structure_score = null));
    expect(v.headline.pill).toEqual({ state: 'neutral', label: 'not graded' });
  });

  it('explains the counts from the check, naming the sitemap only when the rows say so', () => {
    expect(view('bad-site').headline.body).toBe(
      "Crawlers found them only through the sitemap, so they earn no PageRank and most answer engines never see them. Five more pages are reachable only through JavaScript navigation, which a crawler that does not run scripts cannot follow. Four hub pages carry 61% of the site's internal PageRank; the average page is 2.4 clicks from the homepage, which is healthy. 38% of anchors are generic. The map below shows every page crawled: each dot a page, larger the closer it is to the homepage; each line the link that reached it.",
    );
    const linked = view('bad-site', (_, d) => {
      d.page_results.find((p) => p.is_orphan)!.found_via = 'link';
    });
    expect(linked.headline.body).toMatch(
      /^No internal link reaches them, so they earn no PageRank\./,
    );
    expect(view('clean-site').headline.body).toMatch(/^Three hub pages carry 44%/);
  });

  it('calls a deep average deep, not healthy', () => {
    const v = view('bad-site', (c) => (c.structure!.avg_click_depth = 3.6));
    expect(v.headline.body).toContain('3.6 clicks from the homepage, which is deep');
  });

  it('reads the tiles from the check', () => {
    expect(view('bad-site').tiles.map((t) => [t.label, t.value])).toEqual([
      ['Pages', '214'],
      ['Internal links', '779'],
      ['Orphan pages', '7'],
      ['Reachable only through JavaScript', '5'],
      ['Average click depth', '2.4'],
    ]);
    expect(view('challenged-site').tiles[0]!.value).toBe('96');
  });

  it('draws the coverage line from the crawl', () => {
    expect(view('bad-site').coverage).toEqual({ tested: 214, total: 214, groups: 4 });
    expect(view('challenged-site').coverage).toEqual({ tested: 96, total: 140, groups: 3 });
  });
});

describe('structureView: the map', () => {
  it('reuses the crawl’s drawing and says how much of the crawl it draws', () => {
    const v = view('bad-site');
    expect(v.map!.nodes).toHaveLength(214);
    expect(v.map!.caption).toBe('every page crawled, 214 of 214');
    expect(v.map!.explore).toBe('Explore all 214');
    expect(v.map!.legend).toEqual({ jsOnly: 5, orphans: 7, jsLinks: true });
  });

  it('counts the drawing’s orphan and JavaScript-only pages as the check does', () => {
    for (const name of FIXTURE_NAMES) {
      const v = view(name);
      // A fixture listed with a reason still has no drawing; when it gains one, the entry goes.
      if (UNDRAWN[name] !== null) {
        expect(v.map, `${name}: ${UNDRAWN[name]}`).toBeNull();
        continue;
      }
      const kinds = (k: string) => v.map!.nodes.filter((n) => n.kind === k).length;
      expect(kinds('orphan'), name).toBe(v.map!.legend.orphans);
      expect(kinds('js_only'), name).toBe(v.map!.legend.jsOnly);
    }
  });

  it('says what it draws when the drawing is short of the crawl', () => {
    const { d, id } = edited('bad-site');
    const v = structureView(d, id, {}, { nodes: [], positions: {} });
    expect(v.map).toBeNull();
    const some = structureView(
      d,
      id,
      {},
      {
        nodes: [{ id: 'a', parent: null, depth: 0, kind: 'page', via: null }],
        positions: {},
      },
    );
    expect(some.map!.caption).toBe('1 of 214 pages crawled');
  });
});

describe('structureView: the orphan table', () => {
  it('lists the check’s orphan pages with the fields the locked table shows', () => {
    const o = view('bad-site').orphans;
    expect(o.heading).toBe('The seven orphan pages, and where each belongs');
    expect(o.rows).toHaveLength(7);
    expect(o.rows[0]).toEqual({
      page: '/products/ridge-3p',
      linksIn: '0',
      foundVia: 'sitemap.xml',
      parent: '/collections/tents',
      reading: '0 of 6',
      lastChanged: '14 Sep 2026',
    });
    expect(o.rows[2]!.lastChanged).toBe('2 Aug 2026');
    expect(o.rows[5]!.parent).toBe('/');
    expect(o.sub).toBe('Found in sitemap.xml, linked from nowhere.');
    expect(o.unlisted).toBeNull();
  });

  it('explains a crawler count from the template’s own verdicts', () => {
    expect(view('bad-site').orphans.notes).toEqual([
      'Product page orphans are reached by 4 of 6 AI crawlers and read by 0: once reached, they still hit the JavaScript problem in the previous section.',
    ]);
  });

  it('says how many orphans the record lists when it lists fewer than the check counts', () => {
    const o = view('challenged-site').orphans;
    expect(o.rows).toEqual([]);
    expect(o.unlisted).toBe('0 of 2 orphan pages are listed in this record.');
    expect(view('bad-site', (c) => (c.structure!.orphan_pages = 8)).orphans.unlisted).toBe(
      '7 of 8 orphan pages are listed in this record.',
    );
  });

  it('has no table when there are no orphans', () => {
    const o = view('clean-site').orphans;
    expect(o.rows).toEqual([]);
    expect(o.unlisted).toBeNull();
    expect(o.heading).toBe('No orphan pages');
  });
});

describe('structureView: fixes and the keep bar', () => {
  it('lists the section’s fixes, and asks to keep only an unkept audit', () => {
    expect(view('bad-site').fixes.summary).toBe('1 open · 7 on Pro');
    expect(view('bad-site').keep!.title).toBe(
      'Keep this audit: an email when an orphan appears or a hub loses links, and every fix for 14 days.',
    );
    expect(view('challenged-site').keep).toBeNull();
  });
});

describe('structureView: words that follow the data at its edges', () => {
  it('names no hubs when the check found none', () => {
    const v = view('bad-site', (c) => (c.structure!.hubs = 0));
    expect(v.headline.body).toContain('No page stands out as a hub;');
    expect(v.headline.body).not.toMatch(/Zero hub/);
  });

  it('does not say an orphan was found in a link it no longer has', () => {
    const v = view('bad-site', (_, d) => {
      for (const p of d.page_results.filter((x) => x.is_orphan)) p.found_via = 'link';
    });
    expect(JSON.stringify(v)).not.toContain('Found in a link');
  });
});
