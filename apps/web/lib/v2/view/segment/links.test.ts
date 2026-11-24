import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FixtureDataset, PageResult } from '@crawlmouse/types/v2';
import { resultView } from '../result';
import {
  BROKEN_EMPTY,
  HEADINGS_LINE,
  LIST_MAX,
  REDIRECTS_EMPTY,
  linksView,
  shortList,
} from './links';
import { edited } from './test-helpers';

/**
 * The built site's rows, read from the JSON file itself rather than through the fixture loader or
 * the view, so the figures below are counted apart from the code under test.
 */
type RawPage = {
  check_id: string;
  url: string;
  status_code: number;
  title: { text: string } | null;
  meta_description: { text: string } | null;
  redirect: { hops: unknown[]; loop: boolean } | null;
};
type RawEdge = { check_id: string; from_url: string; to_url: string };
const RAW = JSON.parse(
  readFileSync(join(__dirname, '../../../fixtures/v2/built-site.json'), 'utf8'),
) as { checks: { id: string }[]; page_results: RawPage[]; link_edges: RawEdge[] };
const BUILT_ID = RAW.checks[0]!.id;
const rawPages = RAW.page_results.filter((p) => p.check_id === BUILT_ID);
const rawEdges = RAW.link_edges.filter((e) => e.check_id === BUILT_ID);

/** Groups of pages answering 200 by a text, keeping only the texts more than one page shares. */
function sharedPages(read: (p: RawPage) => string | null | undefined): number {
  const by = new Map<string, number>();
  for (const p of rawPages.filter((x) => x.status_code === 200)) {
    const t = read(p);
    if (t) by.set(t, (by.get(t) ?? 0) + 1);
  }
  return [...by.values()].filter((n) => n > 1).reduce((a, b) => a + b, 0);
}

const independent = (() => {
  const broken = rawPages.filter((p) => p.status_code >= 400);
  const brokenUrls = new Set(broken.map((p) => p.url));
  const served = rawPages.filter((p) => p.status_code === 200);
  return {
    checked: rawPages.length,
    served: served.length,
    broken: broken.length,
    brokenLinkedFrom: new Set(
      rawEdges.filter((e) => brokenUrls.has(e.to_url)).map((e) => e.from_url),
    ).size,
    redirects: rawPages.filter((p) => (p.redirect?.hops.length ?? 0) > 0).length,
    loops: rawPages.filter((p) => p.redirect?.loop).length,
    missingTitles: served.filter((p) => !p.title?.text).length,
    sharedTitlePages: sharedPages((p) => p.title?.text),
    missingDescriptions: served.filter((p) => !p.meta_description?.text).length,
    sharedDescriptionPages: sharedPages((p) => p.meta_description?.text),
  };
})();

const builtView = () => {
  const { d, id } = edited('built-site');
  return linksView(d, id);
};

describe('linksView on the built site', () => {
  it('counts what the fixture holds, as counted here from its JSON', () => {
    // The hand-over's sketch figures, so the fixture still has the shape this test is about.
    expect(independent).toMatchObject({
      checked: 60,
      broken: 1,
      missingDescriptions: 3,
      sharedTitlePages: 5,
      sharedDescriptionPages: 2,
    });
    expect(builtView().counts).toEqual(independent);
  });

  it('lists the page answering 404 with every page linking to it and the link text', () => {
    const v = builtView();
    const page = rawPages.find((p) => p.status_code === 404)!;
    const into = rawEdges.filter((e) => e.to_url === page.url);
    expect(v.broken.empty).toBeNull();
    expect(v.broken.rows).toEqual([
      {
        path: new URL(page.url).pathname,
        status: 404,
        linkedFrom: into.map((e) => ({
          path: new URL(e.from_url).pathname,
          anchor: (e as RawEdge & { anchor_text: string }).anchor_text,
        })),
        linkedSummary: into.map((e) => new URL(e.from_url).pathname).join(', '),
        linkedAll: into.map((e) => new URL(e.from_url).pathname).join(', '),
      },
    ]);
  });

  it('heads the page with the counts, and says headings are not checked', () => {
    const v = builtView();
    expect(v.headline.title).toBe(
      `1 broken link · ${independent.redirects} redirect · titles and descriptions for ${independent.served} pages`,
    );
    expect(v.headline.pill).toEqual({ state: 'bad', label: '1 broken link' });
    expect(v.headings).toBe(HEADINGS_LINE);
    expect(v.coverage).toEqual({ read: 'Checked 60 pages' });
  });

  it('groups shared titles and descriptions by their text, the largest group first', () => {
    const v = builtView();
    expect(v.titles.shared.shown.map((g) => [g.text, g.pageCount])).toEqual([
      ['Guide', 3],
      ['camping tents', 2],
    ]);
    expect(v.titles.missingLine).toBe('Missing: none');
    expect(v.descriptions.missingLine).toBe('Missing: 3 pages');
    expect(v.descriptions.sharedLine).toBe('Shared by more than one page: 1 description, 2 pages');
  });

  it('counts titles only over pages that answered 200, so the missing page is not "missing a title"', () => {
    const page = rawPages.find((p) => p.status_code === 404)!;
    expect(page.title).toBeNull();
    expect(builtView().titles.missing.shown).not.toContain(new URL(page.url).pathname);
  });
});

describe('linksView on a clean record', () => {
  it('says so in each empty state', () => {
    const { d, id } = edited('clean-site', (_c, data) => {
      for (const p of data.page_results) p.redirect = { hops: [], loop: false };
    });
    const v = linksView(d, id);
    expect(v.broken).toEqual({ rows: [], empty: BROKEN_EMPTY });
    expect(v.redirects).toEqual({ rows: [], empty: REDIRECTS_EMPTY });
    expect(v.headline.pill).toEqual({ state: 'neutral', label: 'no broken link' });
    expect(BROKEN_EMPTY).toBe('No internal link leads to a page that answers an error.');
    expect(REDIRECTS_EMPTY).toBe('No page we crawled redirects.');
  });
});

/** The built site with `edit` applied to its pages. */
function builtWith(edit: (pages: PageResult[], d: FixtureDataset) => void) {
  const { d, id } = edited('built-site', (_c, data) =>
    edit(
      data.page_results.filter((p) => p.check_id === BUILT_ID),
      data,
    ),
  );
  return linksView(d, id);
}

describe('redirects, built from the type', () => {
  it('writes a chain hop by hop, ends it at the final page and its status, and marks a loop', () => {
    const base = 'https://built-site.test';
    const v = builtWith((pages) => {
      for (const p of pages) p.redirect = { hops: [], loop: false };
      const [a, b] = pages.filter((p) => p.status_code === 200);
      a!.final_url = `${base}/c`;
      a!.redirect = {
        hops: [
          { from: a!.url, status: 301, location: `${base}/b` },
          { from: `${base}/b`, status: 302, location: `${base}/c` },
        ],
        loop: false,
      };
      b!.redirect = {
        hops: [
          { from: b!.url, status: 301, location: `${base}/x` },
          { from: `${base}/x`, status: 308, location: b!.url },
        ],
        loop: true,
      };
    });
    expect(v.redirects.empty).toBeNull();
    expect(v.redirects.rows.map((r) => [r.hops, r.endsText, r.loop])).toEqual(
      expect.arrayContaining([
        ['301 → /b → 302 → /c', '/c (200)', false],
        [expect.stringMatching(/^301 → \/x → 308 → \//), 'LOOP', true],
      ]),
    );
    expect(v.redirects.rows.find((r) => r.loop)!.endsAt).toBeNull();
    expect(v.counts.loops).toBe(1);
    expect(v.body).toContain('2 pages redirect, 1 in a loop.');
  });
});

describe('a list longer than ten', () => {
  it('shows ten, then "and N more" with the rest behind it', () => {
    const ten = shortList(Array.from({ length: 10 }, (_, i) => String(i)));
    expect(LIST_MAX).toBe(10);
    expect(ten).toEqual({ shown: ten.shown, rest: [], more: null, moreInApp: null });
    expect(ten.shown).toHaveLength(10);
    const eleven = shortList(Array.from({ length: 11 }, (_, i) => String(i)));
    expect(eleven.shown).toHaveLength(10);
    expect(eleven.rest).toEqual(['10']);
    expect(eleven.more).toBe('and 1 more');
    expect(eleven.moreInApp).toBe('and 1 more in the app');
  });

  it('cuts the missing descriptions at ten and eleven pages', () => {
    const missing = (n: number) =>
      builtWith((pages) => {
        const served = pages.filter((p) => p.status_code === 200);
        served.forEach((p, i) => {
          p.meta_description =
            i < n ? null : { ...(served[n]!.meta_description ?? null)!, text: `own ${i}` };
        });
      }).descriptions.missing;
    expect(missing(10)).toMatchObject({ more: null });
    expect(missing(10).shown).toHaveLength(10);
    expect(missing(11)).toMatchObject({ more: 'and 1 more' });
    expect(missing(11).shown).toHaveLength(10);
    expect(missing(11).rest).toHaveLength(1);
  });
});

describe('the overview door', () => {
  const door = (name: 'built-site' | 'clean-site') => {
    const { d, id } = edited(name);
    return resultView(d, id, { map: null }).doors.find(
      (x) => x.title === 'Broken links and page basics',
    )!;
  };

  it('pills the broken pages, and words its body from the counts', () => {
    const c = independent;
    const d = door('built-site');
    expect(d.pill).toEqual({ state: 'bad', label: `${c.broken} broken link` });
    expect(d.body).toBe(
      `${c.broken} page answers 404 and is linked from ${c.brokenLinkedFrom} page. ` +
        `${c.redirects} page redirects. ` +
        `${c.missingDescriptions} pages have no meta description; ` +
        `${c.sharedTitlePages} pages share a title with another; ` +
        `${c.sharedDescriptionPages} pages share a meta description with another.`,
    );
    expect(d.coverage).toEqual({ read: `Checked ${c.checked} pages` });
    expect(d.footer).toBe('Titles and descriptions as each page serves them');
  });

  it('is neutral with no broken page, and names no category the record does not hold', () => {
    const d = door('clean-site');
    expect(d.pill).toEqual({ state: 'neutral', label: 'no broken link' });
    expect(d.body).toMatch(/^No page we checked answers an error\./);
    expect(d.body).not.toMatch(/title/);
  });

  it('opens the Links and pages segment, after Site structure', () => {
    const { d, id } = edited('built-site');
    const doors = resultView(d, id, { map: null, segmentHref: (k) => `/seg/${k}` }).doors;
    const at = doors.findIndex((x) => x.title === 'Broken links and page basics');
    expect(doors[at - 1]!.title).toBe('Site structure');
    expect(doors[at]!.href).toBe('/seg/links');
  });
});
