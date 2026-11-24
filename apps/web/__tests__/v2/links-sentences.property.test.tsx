/**
 * Every sentence the Links and pages view produces, held to the record it was built from.
 *
 * Records are built from the types (PageResultSchema and LinkEdgeSchema parse each one): a table of
 * named shapes, then records fast-check generates over the same axes (status, redirect, whether a
 * title or description was read, blank or cut, and links between pages, self-links included). For
 * each record, the strings checked are the headline, the pill, the body, the screen's body, the
 * tiles, the empty states, the table headings and cells, the title and description columns, the
 * overview door, the tab's figure, the link map's title, the PDF section and the rendered screen.
 *
 * The truth each assertion compares with is computed here from the record, with no helper of the
 * view under test (segment/broken.ts, links-facts.ts, reports/csv.ts) imported.
 */
import fc from 'fast-check';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  LinkEdgeSchema,
  PageResultSchema,
  type FixtureDataset,
  type LinkEdge,
  type PageResult,
} from '@crawlmouse/types/v2';
import { LinksScreen } from '../../components/v2/screens/segment/LinksScreen';
import { REPORT_DOC_COPY } from '../../lib/v2/copy/report-doc';
import { fixture } from '../../lib/v2/fixtures';
import { auditDoc } from '../../lib/v2/reports/generate-doc';
import { linkMapView } from '../../lib/v2/view/link-map';
import { resultView } from '../../lib/v2/view/result';
import { segmentFrame } from '../../lib/v2/view/segment/frame';
import { linksView } from '../../lib/v2/view/segment/links';

const BASE = fixture('built-site');
const ID = BASE.checks[0]!.id;
const TEMPLATE = BASE.page_results.find((p) => p.check_id === ID && p.status_code === 200)!;
const ORIGIN = new URL(TEMPLATE.url).origin;
const url = (path: string) => `${ORIGIN}${path}`;
const DOOR = 'Broken links and page basics';

type Head = PageResult['title'];
const text = (t: string | null, cut = false, chars?: number): Head => ({
  text: t,
  chars: t === null ? 0 : (chars ?? [...t].length),
  cut,
});
const LONG = 'x'.repeat(512);

/** A page answering `status` at `path`, read whole as HTML, with its own title and description. */
function page(path: string, status: number, over: Partial<PageResult> = {}): PageResult {
  return {
    ...TEMPLATE,
    url: url(path),
    status_code: status,
    final_url: url(path),
    redirect: { hops: [], loop: false },
    title: text(`Title of ${path}`),
    meta_description: text(`About ${path}`),
    ...over,
  };
}
/** `from` redirects (301) to `to`, and answered `status` there. */
const redirecting = (from: string, to: string, status: number, over: Partial<PageResult> = {}) =>
  page(from, status, {
    final_url: url(to),
    redirect: { hops: [{ from: url(from), status: 301, location: url(to) }], loop: false },
    title: status === 200 ? text(`Title of ${to}`) : null,
    meta_description: status === 200 ? text(`About ${to}`) : null,
    ...over,
  });
const edge = (from: string, to: string, anchor = `to ${to}`): LinkEdge => ({
  check_id: ID,
  from_url: url(from),
  to_url: url(to),
  anchor_text: anchor,
  is_generic_anchor: false,
  js_only: false,
});

/**
 * The built site's dataset with its one check's record replaced: `pages` and `edges`, all of the
 * crawl held (nothing withheld), and a structure that read the links the record holds.
 */
function dataset(pages: PageResult[], edges: LinkEdge[]): FixtureDataset {
  for (const p of pages) PageResultSchema.parse(p);
  for (const e of edges) LinkEdgeSchema.parse(e);
  const d = structuredClone(BASE);
  d.page_results = [...d.page_results.filter((p) => p.check_id !== ID), ...pages];
  d.link_edges = [...d.link_edges.filter((e) => e.check_id !== ID), ...edges];
  d.withheld = d.withheld.filter((w) => w.check_id !== ID);
  const check = d.checks.find((c) => c.id === ID)!;
  check.coverage!.pages_crawled = pages.length;
  check.structure!.internal_links = edges.length;
  check.structure!.orphan_pages = 0;
  check.structure!.js_only_pages = 0;
  return d;
}

// ---- The truth, computed here from the record alone -------------------------------------------

const BLANK = /^[\s\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]*$/;
const isBlankText = (t: string | null) => t === null || BLANK.test(t);
const path = (u: string) => {
  const x = new URL(u);
  return x.origin === ORIGIN ? `${x.pathname}${x.search}` : u;
};

function truthOf(pages: PageResult[], edges: LinkEdge[]) {
  // Where each request answered: the final URL of a recorded redirect chain, else its own URL.
  const at = (p: PageResult) =>
    p.redirect && p.redirect.hops.length > 0 && p.final_url !== null ? p.final_url : p.url;
  const gone = pages.filter((p) => p.status_code === 404 || p.status_code === 410);
  const other = pages.filter(
    (p) => p.status_code >= 400 && p.status_code !== 404 && p.status_code !== 410,
  );
  const missingAt = [...new Set(gone.map(at))];
  /** The URLs a missing page at `target` was asked for at. */
  const askedFor = (target: string) =>
    new Set([target, ...gone.filter((p) => at(p) === target).map((p) => p.url)]);
  const fromOthers = (target: string) => {
    const asked = askedFor(target);
    return edges.filter((e) => asked.has(e.to_url) && !asked.has(e.from_url));
  };
  /** The links from another page into the other error (not missing) answered at `target`. */
  const intoOther = (target: string) => {
    const asked = new Set([target, ...other.filter((p) => at(p) === target).map((p) => p.url)]);
    return edges.filter((e) => asked.has(e.to_url) && !asked.has(e.from_url));
  };
  const linkedMissing = missingAt.filter((t) => fromOthers(t).length > 0);
  const unlinkedMissing = missingAt.filter((t) => fromOthers(t).length === 0);
  const selfLinked = unlinkedMissing.filter((t) =>
    edges.some((e) => askedFor(t).has(e.to_url) && askedFor(t).has(e.from_url)),
  );
  const served = pages.filter((p) => p.status_code === 200);
  const headOf = (key: 'title' | 'meta_description') => {
    const read = served.filter((p) => p[key] !== null);
    const missing = read.filter((p) => isBlankText(p[key]!.text));
    const cut = read.filter((p) => !isBlankText(p[key]!.text) && p[key]!.cut);
    const whole = read.filter((p) => !isBlankText(p[key]!.text) && !p[key]!.cut);
    const byText = new Map<string, PageResult[]>();
    for (const p of whole) byText.set(p[key]!.text!, [...(byText.get(p[key]!.text!) ?? []), p]);
    const shared = [...byText.values()].filter((ps) => ps.length > 1);
    return {
      read: read.length,
      notRead: served.length - read.length,
      missing: missing.map((p) => path(p.url)).sort(),
      cut: cut.length,
      sharedPages: shared.reduce((n, ps) => n + ps.length, 0),
      cutPaths: new Set(cut.map((p) => path(p.url))),
    };
  };
  return {
    checked: pages.length,
    served: served.length,
    linksHeld: edges.length,
    missingAt,
    linkedMissing,
    unlinkedMissing,
    selfLinked,
    linkingPages: new Set(linkedMissing.flatMap((t) => fromOthers(t).map((e) => e.from_url))).size,
    fromOthers,
    intoOther,
    otherErrorsAt: [...new Set(other.map(at))],
    anyError: pages.some((p) => p.status_code >= 400),
    redirectsRecorded: pages.filter((p) => p.redirect !== null).length,
    redirecting: pages.filter((p) => (p.redirect?.hops.length ?? 0) > 0).length,
    titles: headOf('title'),
    descriptions: headOf('meta_description'),
  };
}

// ---- Every string the record's pages say -------------------------------------------------------

const hrefs = {
  overview: '/o',
  segment: (k: string) => `/s/${k}`,
  map: { hubs: '/m', all: '/m/a' },
};

function said(d: FixtureDataset) {
  const v = linksView(d, ID);
  const door = resultView(d, ID, { map: null }).doors.find((x) => x.title === DOOR)!;
  const tab = segmentFrame(d, ID, 'structure').next.label;
  const map = linkMapView(d, ID, { scope: 'all', hrefs });
  const pdf = auditDoc({ dataset: d, checkId: ID }, { home: 'https://h.test' }).sections.find(
    (s) => s.heading === REPORT_DOC_COPY.links,
  )!;
  const pdfStrings = pdf.blocks.flatMap((b) =>
    b.type === 'text'
      ? [b.text]
      : b.type === 'table'
        ? [b.caption, ...b.columns, ...b.rows.flat()]
        : [],
  );
  const screen = new JSDOM(`<body>${renderToStaticMarkup(<LinksScreen data={v} />)}</body>`).window
    .document;
  const rows = [...v.broken.rows, ...v.unlinked.rows, ...v.errors.rows];
  const strings = [
    v.headline.title,
    v.headline.pill?.label ?? '',
    v.body,
    ...v.tiles.flatMap((t) => [t.label, t.value]),
    v.broken.empty ?? '',
    v.redirects.empty ?? '',
    v.unlinked.heading,
    v.errors.heading,
    ...[v.titles, v.descriptions].flatMap((c) => [c.heading, c.missingLine, c.sharedLine]),
    ...rows.flatMap((r) => [r.pageText, r.linkedSummary, r.linkedAll]),
    ...v.redirects.rows.flatMap((r) => [r.path, r.hops, r.endsText]),
    door.body,
    door.pill.label,
    tab,
    map.title,
    ...pdfStrings,
    ...[...screen.querySelectorAll('h2, th, p, td, li, summary')].map((n) => n.textContent ?? ''),
  ].filter((s) => s !== '');
  return { v, door, tab, map, strings, screenText: screen.body.textContent ?? '' };
}

const num = (s: string) => Number(s.replace(/,/g, ''));
const matchesOf = (strings: readonly string[], re: RegExp) =>
  strings.flatMap((s) => [...s.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))]);

/** The assertions: no sentence contradicts the record. */
function expectTrueToTheRecord(pages: PageResult[], edges: LinkEdge[]) {
  const t = truthOf(pages, edges);
  const d = dataset(pages, edges);
  const { v, door, tab, map, strings, screenText } = said(d);
  const pill = v.headline.pill?.label ?? 'not measured';

  // The door, the tab and the screen say the same figure.
  expect(door.pill.label).toBe(pill);
  expect(tab).toBe(`Next: Links and pages · ${pill}`);

  if (t.checked === 0) {
    expect(v.tiles.map((x) => x.value)).toEqual(Array(4).fill('not measured'));
    expect(pill).toBe('not measured');
    return;
  }

  // A count of links is never a count of pages: missing pages are counted as pages, and no string
  // counts "broken links".
  expect(matchesOf(strings, /\d[\d,]* broken links?\b/)).toEqual([]);
  for (const m of matchesOf(strings, /(\d[\d,]*) missing pages?, linked from (\d[\d,]*) pages?/)) {
    expect([num(m[1]!), num(m[2]!)]).toEqual([t.linkedMissing.length, t.linkingPages]);
  }

  // No link held: nothing claims what links lead to, and the linked tile says it was not read.
  const tile = (label: string) => v.tiles.find((x) => x.label === label)!.value;
  if (t.linksHeld === 0) {
    for (const s of strings) {
      expect(s).not.toMatch(
        /no broken link|No link we read|no link from another page|no other page links to|linked from \d/i,
      );
    }
    expect(tile('Linked missing pages')).toMatch(/^not (read|recorded)$/);
  } else {
    // A link the record holds is never called absent.
    for (const s of strings) {
      expect(s).not.toMatch(
        /no link (was )?(read|recorded)|No link is in this check|no link in the record/i,
      );
    }
    expect(tile('Linked missing pages')).toBe(String(t.linkedMissing.length));
  }
  if (t.linkedMissing.length || t.unlinkedMissing.length || t.linksHeld === 0) {
    for (const s of strings) expect(s).not.toMatch(/no broken link/);
  }
  // "No link from another page" is said of the missing pages only when one has none, and of a row
  // only when no other page's link in the record leads to it.
  const sentences = [v.headline.title, pill, v.body, door.body, tab, v.broken.empty ?? ''];
  if (matchesOf(sentences, /no link from another page/i).length) {
    expect(t.unlinkedMissing.length).toBeGreaterThan(0);
  }
  const rowsWithTruth = [
    ...[...v.broken.rows, ...v.unlinked.rows].map((r) => [r, t.fromOthers(r.url)] as const),
    ...v.errors.rows.map((r) => [r, t.intoOther(r.url)] as const),
  ];
  for (const [r, into] of rowsWithTruth) {
    const truth = [...new Set(into.map((e) => path(e.from_url)))];
    expect(r.linkedFrom.map((l) => l.path).filter((x, i, a) => a.indexOf(x) === i)).toEqual(truth);
    if (r.linkedAll === 'no link from another page') {
      expect([truth, t.linksHeld > 0]).toEqual([[], true]);
    }
  }
  expect(v.broken.rows.map((r) => r.url).sort()).toEqual([...t.linkedMissing].sort());
  expect(v.unlinked.rows.map((r) => r.url).sort()).toEqual([...t.unlinkedMissing].sort());

  // The map counts the missing pages as the Links screen does.
  if (!map.noneServed) {
    const m = map.title.match(/(\d[\d,]*) missing/);
    expect(m ? num(m[1]!) : 0).toBe(t.missingAt.length);
    expect(t.missingAt.length).toBe(v.counts.broken + v.counts.missingUnlinked);
  }

  // "No error" and "no redirect" only when the record shows none.
  if (
    strings.some((s) => /answers an error\.|answers no error/.test(s) && /None|no error/.test(s))
  ) {
    expect(t.anyError).toBe(false);
  }
  for (const m of matchesOf(strings, /(\d[\d,]*) pages? answered an error/)) {
    expect(num(m[1]!)).toBe(t.otherErrorsAt.length);
  }
  const noRedirect = strings.filter(
    (s) => /redirects\.$|does not redirect/.test(s) && /None|does not/.test(s),
  );
  if (noRedirect.length) expect(t.redirecting).toBe(0);
  for (const s of noRedirect) {
    const scoped = s.match(/(\d[\d,]*) pages? whose redirects were recorded/);
    if (scoped) expect(num(scoped[1]!)).toBe(t.redirectsRecorded);
    else if (/whose redirects were recorded/.test(s)) expect(t.redirectsRecorded).toBe(1);
    else expect(t.redirectsRecorded).toBe(t.checked);
  }
  if (t.redirectsRecorded === 0) expect(tile('Redirects')).toBe('not recorded');
  else expect(tile('Redirects')).toBe(String(t.redirecting));

  // Titles and descriptions: a page not read is never counted missing; a tile never shows a number
  // where its column says "not read"; a cut text is never grouped as shared.
  for (const [key, col, label] of [
    ['titles', v.titles, 'Missing titles'],
    ['descriptions', v.descriptions, 'Missing descriptions'],
  ] as const) {
    const h = t[key];
    expect(
      col.missing.shown
        .concat(col.missing.rest)
        .map((p) => p.path)
        .sort(),
    ).toEqual(h.missing);
    if (/^Missing: not read/.test(col.missingLine)) expect(tile(label)).not.toMatch(/\d/);
    if (h.read === 0) {
      expect(col.missingLine).toMatch(/not read/);
      expect(tile(label)).toBe('not read');
    } else {
      expect(tile(label)).toBe(String(h.missing.length));
      if (/^Missing: none/.test(col.missingLine)) expect(h.missing).toEqual([]);
      if (h.notRead) expect(col.missingLine).toContain(`not read on ${h.notRead} page`);
    }
    for (const g of col.shared.shown.concat(col.shared.rest)) {
      for (const p of g.pages.shown.concat(g.pages.rest))
        expect(h.cutPaths.has(p.path)).toBe(false);
    }
    const sharedTotal = col.shared.shown
      .concat(col.shared.rest)
      .reduce((n, g) => n + g.pageCount, 0);
    expect(sharedTotal).toBe(h.sharedPages);
  }
  for (const m of matchesOf(strings, /(\d[\d,]*) pages? (?:has|have) no title/)) {
    expect(num(m[1]!)).toBe(t.titles.missing.length);
  }
  for (const m of matchesOf(strings, /(\d[\d,]*) pages? (?:has|have) no meta description/)) {
    expect(num(m[1]!)).toBe(t.descriptions.missing.length);
  }
  if (
    strings.some((s) =>
      /has its own title and meta description|has a title and a meta description/.test(s),
    )
  ) {
    for (const h of [t.titles, t.descriptions]) {
      expect([h.notRead, h.missing.length, h.cut, h.sharedPages]).toEqual([0, 0, 0, 0]);
    }
  }

  // The redirect table names where a chain started as requested, never as linked.
  expect(screenText).not.toContain('Linked as');
  if (t.redirecting) expect(screenText).toContain('Requested as');
}

// ---- The shapes the reviewer ran ---------------------------------------------------------------

const PDF = page('/guide.pdf', 200, {
  is_html: false,
  links_read: false,
  title: null,
  meta_description: null,
});

const SHAPES: [string, PageResult[], LinkEdge[]][] = [
  ['no page', [], []],
  ['pages with no link edges', [page('/', 200), page('/a', 200), page('/b', 200)], []],
  ['only 503', [page('/', 503, { title: null, meta_description: null })], []],
  [
    'only 429',
    [
      page('/', 429, { title: null, meta_description: null }),
      page('/a', 429, { title: null, meta_description: null }),
    ],
    [],
  ],
  [
    'a 404 linked only from itself',
    [page('/', 200), page('/gone', 404, { title: null, meta_description: null })],
    [edge('/gone', '/gone')],
  ],
  [
    'a redirect chain ending at a 404 that is also in the record',
    [
      page('/', 200),
      redirecting('/old', '/new', 404),
      page('/new', 404, { title: null, meta_description: null }),
    ],
    [edge('/', '/old')],
  ],
  [
    'a redirect loop',
    [
      page('/', 200),
      page('/loop', 301, {
        final_url: null,
        title: null,
        meta_description: null,
        redirect: {
          hops: [
            { from: url('/loop'), status: 301, location: url('/loop2') },
            { from: url('/loop2'), status: 301, location: url('/loop') },
          ],
          loop: true,
        },
      }),
    ],
    [edge('/', '/loop')],
  ],
  [
    'all titles blank',
    [
      page('/', 200, { title: text(null) }),
      page('/a', 200, { title: text('\u00a0') }),
      page('/b', 200, { title: text('\u2003 ') }),
    ],
    [edge('/', '/a'), edge('/a', '/b')],
  ],
  ['one page', [page('/', 200)], [edge('/', '/')]],
  [
    'mixed 404 and 410',
    [
      page('/', 200),
      page('/a', 404, { title: null, meta_description: null }),
      page('/b', 410, { title: null, meta_description: null }),
      page('/c', 404, { title: null, meta_description: null }),
    ],
    [edge('/', '/a'), edge('/', '/b')],
  ],
  [
    'a 200 non-HTML page (PDF) with no title or description read',
    [page('/', 200), PDF],
    [edge('/', '/guide.pdf')],
  ],
  [
    'two long titles cut at 512 bytes sharing a prefix',
    [
      page('/', 200),
      page('/a', 200, { title: text(LONG, true, 600) }),
      page('/b', 200, { title: text(LONG, true, 700) }),
    ],
    [edge('/', '/a'), edge('/', '/b')],
  ],
  [
    'a URL redirected to a page got a 429 while the page itself answered 410',
    [
      page('/', 200),
      redirecting('/old', '/gone', 429),
      page('/gone', 410, { title: null, meta_description: null }),
    ],
    [edge('/', '/old')],
  ],
];

describe('every sentence of Links and pages is true to the record: the named shapes', () => {
  it.each(SHAPES)('%s', (_name, pages, edges) => expectTrueToTheRecord(pages, edges));
});

// ---- Generated records -------------------------------------------------------------------------

const PATHS = ['/', '/a', '/b', '/c', '/d', '/e'];
const headArb = fc.oneof(
  fc.constant<Head>(null),
  fc.constant(text(null)),
  fc.constant(text('\u00a0')),
  fc.constantFrom('Home', 'Guide', 'Tents').map((s) => text(s)),
  fc.integer({ min: 513, max: 900 }).map((n) => text(LONG, true, n)),
);
const pageArb = (p: string) =>
  fc
    .record({
      status: fc.constantFrom(200, 200, 200, 404, 410, 429, 503, 301),
      title: headArb,
      desc: headArb,
      redirect: fc.oneof(
        fc.constant<'none' | 'null'>('none'),
        fc.constant<'none' | 'null'>('null'),
        fc.constantFrom(...PATHS.filter((x) => x !== p)),
      ),
      pdf: fc.boolean(),
    })
    .map(({ status, title, desc, redirect, pdf }): PageResult => {
      if (status === 301) {
        return page(p, 301, {
          final_url: null,
          title: null,
          meta_description: null,
          redirect: {
            hops: [
              { from: url(p), status: 301, location: url(`${p}x`) },
              { from: url(`${p}x`), status: 301, location: url(p) },
            ],
            loop: true,
          },
        });
      }
      const head =
        status === 200
          ? { title, meta_description: desc }
          : { title: null, meta_description: null };
      const html =
        status === 200 && pdf
          ? { is_html: false, links_read: false, title: null, meta_description: null }
          : {};
      if (redirect === 'null') return page(p, status, { ...head, ...html, redirect: null });
      if (redirect === 'none') return page(p, status, { ...head, ...html });
      return redirecting(p, redirect, status, { ...head, ...html });
    });

const recordArb = fc
  .subarray(PATHS, { minLength: 0 })
  .chain((paths) =>
    fc.tuple(
      fc.tuple(...paths.map(pageArb)),
      fc.uniqueArray(fc.tuple(fc.constantFrom(...PATHS), fc.constantFrom(...PATHS)), {
        maxLength: 10,
        selector: ([a, b]) => `${a} ${b}`,
      }),
    ),
  )
  .map(([pages, links]) => {
    const held = new Set(pages.map((p) => p.url));
    return {
      pages,
      // A link is held only from a page the record holds and read as HTML.
      edges: links
        .filter(([a]) => held.has(url(a)) && pages.find((p) => p.url === url(a))!.is_html)
        .map(([a, b]) => edge(a, b)),
    };
  });

describe('every sentence of Links and pages is true to the record: generated records', () => {
  it('holds for each generated record', () => {
    fc.assert(
      fc.property(recordArb, ({ pages, edges }) => expectTrueToTheRecord(pages, edges)),
      { numRuns: 120 },
    );
  });
});
