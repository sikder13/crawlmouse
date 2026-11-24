import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FixtureDataset, PageResult } from '@crawlmouse/types/v2';
import { resultView } from '../result';
import { segmentFrame } from './frame';
import {
  HEADINGS_LINE,
  LIST_MAX,
  NOT_MEASURED_LINE,
  NO_LINK_TEXT,
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
type RawEdge = { check_id: string; from_url: string; to_url: string; anchor_text: string };
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
  const gone = rawPages.filter((p) => p.status_code === 404 || p.status_code === 410);
  const into = (url: string) => rawEdges.filter((e) => e.to_url === url && e.from_url !== url);
  const linked = gone.filter((p) => into(p.url).length > 0);
  const served = rawPages.filter((p) => p.status_code === 200);
  return {
    checked: rawPages.length,
    served: served.length,
    broken: linked.length,
    brokenLinkedFrom: new Set(linked.flatMap((p) => into(p.url).map((e) => e.from_url))).size,
    missingUnlinked: gone.length - linked.length,
    errors: rawPages.filter((p) => p.status_code >= 400 && !gone.includes(p)).length,
    redirects: rawPages.filter((p) => (p.redirect?.hops.length ?? 0) > 0).length,
    loops: rawPages.filter((p) => p.redirect?.loop).length,
    redirectsRecorded: rawPages.filter((p) => p.redirect !== null).length,
    // A title or description not read (null) is not missing: missing is read, and blank.
    titlesRead: served.filter((p) => p.title !== null).length,
    missingTitles: served.filter((p) => p.title !== null && !p.title.text?.trim()).length,
    sharedTitlePages: sharedPages((p) => p.title?.text),
    cutTitles: 0,
    descriptionsRead: served.filter((p) => p.meta_description !== null).length,
    missingDescriptions: served.filter(
      (p) => p.meta_description !== null && !p.meta_description.text?.trim(),
    ).length,
    sharedDescriptionPages: sharedPages((p) => p.meta_description?.text),
    cutDescriptions: 0,
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

  it('lists the page answering 404 with the links in the record that lead to it, and their text', () => {
    const v = builtView();
    const page = rawPages.find((p) => p.status_code === 404)!;
    const into = rawEdges.filter((e) => e.to_url === page.url);
    expect(v.broken.empty).toBeNull();
    expect(v.broken.rows).toEqual([
      {
        url: page.url,
        path: new URL(page.url).pathname,
        status: 404,
        via: [],
        pageText: new URL(page.url).pathname,
        linkedFrom: into.map((e) => ({
          url: e.from_url,
          path: new URL(e.from_url).pathname,
          anchor: e.anchor_text,
        })),
        linkedSummary: into.map((e) => new URL(e.from_url).pathname).join(', '),
        linkedAll: into.map((e) => new URL(e.from_url).pathname).join(', '),
      },
    ]);
    expect(v.unlinked.rows).toEqual([]);
    expect(v.errors.rows).toEqual([]);
  });

  it('heads the page with the counts, and says headings are not checked', () => {
    const v = builtView();
    expect(v.headline.title).toBe(
      `1 missing page found · ${independent.redirects} redirect · titles and descriptions read on ${independent.served} pages`,
    );
    expect(v.headline.pill).toEqual({
      state: 'bad',
      label: '1 missing page',
    });
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

describe('linksView on the clean preview: 2 pages recorded of 38 crawled', () => {
  const { d, id } = edited('clean-site');
  const v = linksView(d, id);

  it('scopes each empty state and the pill to the pages checked', () => {
    // Counted here from the fixture, apart from the code under test.
    const recorded = d.page_results.filter((p) => p.check_id === id).length;
    expect(recorded).toBe(2);
    expect(v.broken).toEqual({
      rows: [],
      empty: 'None of the 2 pages we checked answers an error.',
    });
    expect(v.redirects).toEqual({ rows: [], empty: 'None of the 2 pages we checked redirects.' });
    expect(v.headline.pill).toEqual({
      state: 'neutral',
      label: 'no 404 or 410',
    });
    expect(v.headline.title).toMatch(/^2 pages checked: 0 missing pages found/);
    expect(v.coverage).toEqual({ read: 'Checked 2 of the 38 pages crawled' });
  });

  it('says that no page answers an error once: in the empty state, not again in the body', () => {
    expect(v.body).not.toMatch(/answers an error|answers no error/);
    const door = resultView(d, id, { map: null }).doors.find(
      (x) => x.title === 'Broken links and page basics',
    )!;
    // The fixture holds 2 of the check's 412 links (`withheld`): said first, from the record.
    expect(door.body).toMatch(
      /^The record holds 2 of the 412 links found; the links of 2 pages are not all in this check’s record\. None of the 2 pages we checked answers an error\./,
    );
  });

  it('words a record of one page in the singular', () => {
    const one = edited('clean-site', (_c, data) => {
      const keep = data.page_results.find((p) => p.check_id === id)!;
      data.page_results = data.page_results.filter((p) => p.check_id !== id || p === keep);
    });
    const w = linksView(one.d, one.id);
    expect(w.broken.empty).toBe('The page we checked answers no error.');
    expect(w.redirects.empty).toBe('The page we checked does not redirect.');
    expect(w.body).toBe(
      'The record holds 2 of the 412 links found; the links of 1 page are not all in this check’s record. ' +
        'The page that answered 200 has a title and a meta description.',
    );
    expect(w.headline.pill).toEqual({
      state: 'neutral',
      label: 'no 404 or 410',
    });
    expect(w.body).not.toMatch(/Each of the 1/);
  });
});

describe('linksView on the challenged preview: no page recorded of 96 crawled', () => {
  const { d, id } = edited('challenged-site');
  const v = linksView(d, id);

  it('says nothing was measured, and pills nothing', () => {
    expect(d.page_results.filter((p) => p.check_id === id)).toHaveLength(0);
    expect(v.headline).toEqual({ title: 'Links and pages were not measured', pill: null });
    expect(v.broken).toEqual({ rows: [], empty: NOT_MEASURED_LINE });
    expect(v.redirects).toEqual({ rows: [], empty: NOT_MEASURED_LINE });
    expect(v.tiles.map((t) => t.value)).toEqual(Array(4).fill('not measured'));
    expect(v.titles.missingLine).toBe('Missing: not read, as no page answered 200');
    expect(v.body).not.toMatch(/answers an error|no broken|redirects\./);
  });

  it('gives the door and the tab "not measured", not a count', () => {
    const door = resultView(d, id, { map: null }).doors.find(
      (x) => x.title === 'Broken links and page basics',
    )!;
    expect(door.pill).toEqual({ state: 'neutral', label: 'not measured' });
    expect(segmentFrame(d, id, 'structure').next.label).toBe(
      'Next: Links and pages · not measured',
    );
  });
});

/** The built site, with `edit` applied to its whole dataset. */
const builtEdited = (edit: (d: FixtureDataset) => void) => {
  const { d, id } = edited('built-site', (_c, data) => edit(data));
  return { d, id, v: linksView(d, id) };
};
const at = (d: FixtureDataset, path: string) =>
  d.page_results.find((p) => p.check_id === BUILT_ID && new URL(p.url).pathname === path)!;

describe('missing is 404 or 410; any other error is a page that answered an error', () => {
  for (const status of [404, 410]) {
    it(`a linked page answering ${status} is a broken link`, () => {
      const { v } = builtEdited((d) => (at(d, '/products/retired-tent').status_code = status));
      expect(v.counts).toMatchObject({ broken: 1, errors: 0 });
      expect(v.headline.pill).toEqual({
        state: 'bad',
        label: '1 missing page',
      });
    });
  }

  for (const status of [400, 401, 403, 429, 500, 503]) {
    it(`a linked page answering ${status} is not called broken or missing`, () => {
      const { d, id, v } = builtEdited(
        (data) => (at(data, '/products/retired-tent').status_code = status),
      );
      expect(v.counts).toMatchObject({ broken: 0, missingUnlinked: 0, errors: 1 });
      expect(v.errors.rows.map((r) => [r.path, r.status])).toEqual([
        ['/products/retired-tent', status],
      ]);
      expect(v.headline.pill).toEqual({
        state: 'neutral',
        label: 'no 404 or 410',
      });
      expect(v.broken.empty).toBe('No page checked answered 404 or 410.');
      expect(v.body).toMatch(new RegExp(`^1 page answered an error \\(${status}\\)\\.`));
      expect(v.body).not.toMatch(/broken|missing/);
      const door = resultView(d, id, { map: null }).doors.find(
        (x) => x.title === 'Broken links and page basics',
      )!;
      expect(door.pill).toEqual({
        state: 'neutral',
        label: 'no 404 or 410',
      });
      expect(segmentFrame(d, id, 'structure').next.label).toBe(
        'Next: Links and pages · no 404 or 410',
      );
    });
  }
});

describe('a hand-counted record: a blank title, a 503, a self-linked 410, blank link text', () => {
  const { v } = builtEdited((d) => {
    at(d, '/blog/rainy-day-camping').title!.text = '\u00a0\u2003 ';
    at(d, '/products/camp-kitchen-item-1').status_code = 503;
    const gone = at(d, '/products/sleeping-bags-item-1');
    gone.status_code = 410;
    d.link_edges = d.link_edges.filter((e) => e.to_url !== gone.url);
    const edge = d.link_edges.find((e) => e.check_id === BUILT_ID)!;
    const retired = at(d, '/products/retired-tent').url;
    d.link_edges.push(
      { ...edge, from_url: gone.url, to_url: gone.url, anchor_text: 'itself' },
      {
        ...edge,
        from_url: at(d, '/blog/tent-care-guide').url,
        to_url: retired,
        anchor_text: '\u00a0',
      },
    );
  });

  it('counts what was worked out by hand', () => {
    // 60 pages; 59 answered 200 and two of those now answer 503 and 410, so 57. The 404 is linked
    // from /blog/first-night-outdoors and now /blog/tent-care-guide: 2 pages. The 410's one link is
    // its own, so no link the record holds from another page leads to it. The rainy-day title is whitespace alone: 1 missing title.
    // Shared titles: "Guide" x3 and "camping tents" x2 = 5. Missing descriptions: the 3 guides.
    expect(v.counts).toEqual({
      checked: 60,
      served: 57,
      broken: 1,
      brokenLinkedFrom: 2,
      missingUnlinked: 1,
      errors: 1,
      redirects: 1,
      loops: 0,
      redirectsRecorded: 60,
      titlesRead: 57,
      missingTitles: 1,
      sharedTitlePages: 5,
      cutTitles: 0,
      descriptionsRead: 57,
      missingDescriptions: 3,
      sharedDescriptionPages: 2,
      cutDescriptions: 0,
    });
  });

  it('writes each clause once, each true of every page it names', () => {
    expect(v.body).toBe(
      '1 missing page, linked from 2 pages in this check’s record, answering 404. ' +
        '1 missing page, linked from 0 pages in this check’s record, answering 410. ' +
        // The links to the 410 were taken out of the record; the page they were on keeps its count.
        'The links of 1 page are not all in this check’s record. ' +
        '1 page answered an error (503). ' +
        '1 page redirects. ' +
        '3 pages have no meta description; 1 page has no title; ' +
        '5 pages share a title with another; 2 pages share a meta description with another.',
    );
  });

  it('lists the 410 apart, under "Missing pages found", never as linked from itself', () => {
    expect(v.unlinked.heading).toBe('Missing pages found');
    expect(
      v.unlinked.rows.map((r) => [r.path, r.status, r.linkedFrom, r.linkedAll, r.linkedSummary]),
    ).toEqual([
      [
        '/products/sleeping-bags-item-1',
        410,
        [],
        '0 pages in this check’s record',
        '0 pages in this check’s record',
      ],
    ]);
    expect(v.titles.missing.shown.map((p) => p.path)).toEqual(['/blog/rainy-day-camping']);
  });

  it('shows a link with no text as having none', () => {
    const anchors = v.broken.rows[0]!.linkedFrom.map((l) => l.anchor);
    expect(anchors).toEqual(['retired tent', null]);
    expect(NO_LINK_TEXT).toBe('(no link text)');
  });
});

describe('a page that redirects to a missing page', () => {
  it('is shown at its final URL, with the URL that redirects to it', () => {
    // The chain's final URL, which the record does not hold, answered 404: nothing of the page was
    // read, so it has no title, description or links.
    const { v } = builtEdited((d) => {
      const p = at(d, '/products/old-dome-tent');
      Object.assign(p, {
        status_code: 404,
        links_out: 0,
        links_read: false,
        content_simhash: null,
        title: null,
        meta_description: null,
      });
      expect(d.page_results.some((x) => x.url === p.final_url)).toBe(false);
    });
    const row = [...v.broken.rows, ...v.unlinked.rows].find((r) => r.via.length)!;
    expect(row).toMatchObject({
      path: '/products/dome-tent-classic',
      via: ['/products/old-dome-tent'],
      pageText: '/products/dome-tent-classic (redirected from /products/old-dome-tent)',
    });
  });

  it('is one row, not two, when the record also holds its final URL as a page', () => {
    const { v } = builtEdited((d) => {
      const p = at(d, '/products/old-dome-tent');
      const retired = at(d, '/products/retired-tent').url;
      Object.assign(p, {
        status_code: 404,
        final_url: retired,
        redirect: { hops: [{ from: p.url, status: 301, location: retired }], loop: false },
        links_out: 0,
        links_read: false,
        content_simhash: null,
        title: null,
        meta_description: null,
      });
    });
    expect(v.broken.rows.map((r) => [r.path, r.via])).toEqual([
      ['/products/retired-tent', ['/products/old-dome-tent']],
    ]);
    expect(v.counts.broken + v.counts.missingUnlinked).toBe(1);
  });
});

describe('two statuses at one URL are two rows: no status is hidden', () => {
  /** /products/old-dome-tent redirects to /products/retired-tent and got `via`; the page got `own`. */
  const twoStatuses = (via: number, own: number) =>
    builtEdited((d) => {
      const old = at(d, '/products/old-dome-tent');
      const retired = at(d, '/products/retired-tent');
      retired.status_code = own;
      Object.assign(old, {
        status_code: via,
        final_url: retired.url,
        redirect: { hops: [{ from: old.url, status: 301, location: retired.url }], loop: false },
        links_out: 0,
        links_read: false,
        content_simhash: null,
        title: null,
        meta_description: null,
      });
    }).v;
  const rowsOf = (v: ReturnType<typeof twoStatuses>) =>
    [...v.broken.rows, ...v.unlinked.rows, ...v.errors.rows].map((r) => [r.path, r.status, r.via]);

  it('lists a 429 reached by a redirect and the 503 the page itself answered', () => {
    const v = twoStatuses(429, 503);
    expect(rowsOf(v)).toEqual([
      ['/products/retired-tent', 429, ['/products/old-dome-tent']],
      ['/products/retired-tent', 503, []],
    ]);
    expect(v.counts.errors).toBe(1);
    expect(v.body).toMatch(/^1 page answered an error \(429, 503\)\./);
  });

  it('lists a 404 reached by a redirect and the 410 the page itself answered, as one missing page', () => {
    const v = twoStatuses(404, 410);
    expect(rowsOf(v)).toEqual([
      ['/products/retired-tent', 404, ['/products/old-dome-tent']],
      ['/products/retired-tent', 410, []],
    ]);
    expect(v.counts.broken + v.counts.missingUnlinked).toBe(1);
    expect(v.body).toMatch(
      /^1 missing page, linked from \d+ pages? in this check’s record, answering 404 or 410\./,
    );
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
          // Read, and declaring none: missing. (A null description was not read, so is not.)
          p.meta_description =
            i < n
              ? { text: null, chars: 0, cut: false }
              : { ...(served[n]!.meta_description ?? null)!, text: `own ${i}` };
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
    expect(d.pill).toEqual({
      state: 'bad',
      label: `${c.broken + c.missingUnlinked} missing page`,
    });
    expect(d.body).toBe(
      `${c.broken} missing page, linked from ${c.brokenLinkedFrom} page in this check’s record, answering 404. ` +
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
    expect(d.pill).toEqual({ state: 'neutral', label: 'no 404 or 410' });
    expect(d.body).toMatch(
      /^The record holds 2 of the 412 links found; the links of 2 pages are not all in this check’s record\. None of the 2 pages we checked answers an error\./,
    );
    // The clean record has no redirect, loop, missing or shared title, or other error: none named.
    for (const word of [/redirect/, /loop/, /title/, /missing/, /answered an error/, /broken/]) {
      expect(d.body).not.toMatch(word);
    }
  });

  it('opens the Links and pages segment, after Site structure', () => {
    const { d, id } = edited('built-site');
    const doors = resultView(d, id, { map: null, segmentHref: (k) => `/seg/${k}` }).doors;
    const at = doors.findIndex((x) => x.title === 'Broken links and page basics');
    expect(doors[at - 1]!.title).toBe('Site structure');
    expect(doors[at]!.href).toBe('/seg/links');
  });
});
