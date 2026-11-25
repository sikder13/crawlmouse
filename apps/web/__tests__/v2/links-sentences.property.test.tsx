/**
 * The strings the Links and pages feature renders, held to the record they were built from.
 *
 * Records are built from the types (PageResultSchema and LinkEdgeSchema parse each one): a table of
 * named shapes, then records fast-check generates. The generator varies a page's status (200, 404,
 * 410, 429, 503, a 301 loop); its redirect (none, not recorded, one hop, a two-hop 301 chain, a
 * chain whose final URL is not recorded, to a URL in the record or to a landing URL outside it);
 * whether it is a PDF, an HTML page whose links were not all read, or an HTML page read whole whose
 * `links_out` counts more links than the record holds from it; its title and description
 * (not read, declared empty, blank with Unicode or zero-width spaces, text, cut short); the links
 * between pages, from the record's pages and from the landing URLs outside it, self-links included;
 * how many links and pages the check found beyond those the record holds (`withheld`); and whether
 * the structure section was measured at all.
 *
 * For each record, `expectTrueToTheRecord` checks, against a truth computed here:
 * - the rows of the missing-page and error tables, as (page, status) pairs, and each row's linking
 *   pages, its "and N more" summary, and the count (0) that stands in when the record holds none;
 * - the missing-page, error, redirect and loop counts and the status lists of the body's sentences;
 * - the clause on the pages whose links the record does not hold in full (`links_read` false, or
 *   `links_out` above the distinct links the record holds from the page), the clause on links
 *   withheld, and the clauses on titles and descriptions not read, cut short, missing and shared;
 * - the pill, the headline's parts, the tiles, the coverage line, the door and the tab, and the link
 *   map's missing count and its scope;
 * - that no string of the view, the door, the tab, the map's title, the PDF section or the rendered
 *   screen matches a wording in FORBIDDEN.
 *
 * The truth is computed from the record, with no helper of the view under test (segment/broken.ts,
 * links-facts.ts, reports/csv.ts) used by it; `linkSpelling` is imported from links-facts.ts only to
 * be held equal to the engine's `canonicalizeUrl`. The hand-counted vectors below also carry their
 * expected pill, body, tab, empty state and headline as literals, so a rule this truth shares with
 * the view cannot pass both.
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
import { linkSpelling } from '../../lib/v2/view/segment/links-facts';
import { canonicalizeUrl } from '@crawlmouse/engine/v2/pipeline';

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
    links_out: 0,
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

/** What the check found beyond the record, and whether it measured the structure section. */
interface Scope {
  /** Links the check found that the record does not hold (a `withheld` row for link_edges). */
  extraLinks?: number;
  /** Pages crawled that the record does not hold (a `withheld` row for page_results). */
  extraCrawled?: number;
  /** The structure section read nothing: no link counted, and the record holds none. */
  unmeasured?: boolean;
}

/** The built site's dataset with its one check's record replaced by `pages` and `edges`. */
function dataset(pages: PageResult[], edges: LinkEdge[], scope: Scope = {}): FixtureDataset {
  for (const p of pages) PageResultSchema.parse(p);
  for (const e of edges) LinkEdgeSchema.parse(e);
  const extraLinks = scope.unmeasured ? 0 : (scope.extraLinks ?? 0);
  const extraCrawled = scope.extraCrawled ?? 0;
  const d = structuredClone(BASE);
  d.page_results = [...d.page_results.filter((p) => p.check_id !== ID), ...pages];
  d.link_edges = [...d.link_edges.filter((e) => e.check_id !== ID), ...edges];
  d.withheld = d.withheld.filter((w) => w.check_id !== ID);
  if (extraLinks) {
    d.withheld.push({
      check_id: ID,
      collection: 'link_edges',
      included: edges.length,
      total: edges.length + extraLinks,
    });
  }
  if (extraCrawled) {
    d.withheld.push({
      check_id: ID,
      collection: 'page_results',
      included: pages.length,
      total: pages.length + extraCrawled,
    });
  }
  const check = d.checks.find((c) => c.id === ID)!;
  check.coverage!.pages_crawled = pages.length + extraCrawled;
  check.structure!.internal_links = scope.unmeasured ? 0 : edges.length + extraLinks;
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
const distinct = <T,>(xs: readonly T[]) => [...new Set(xs)];
const sortNum = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);

/** The engine's own spelling of a URL (the worker stores link targets in it), or the URL as given. */
const canon = (u: string): string => {
  try {
    return canonicalizeUrl(u);
  } catch {
    return u;
  }
};

/** The distinct URLs other than `from` the record holds a link to from `from` or its final URL. */
const heldFrom = (p: PageResult, edges: readonly LinkEdge[]) => {
  const own = new Set([p.url, ...(p.final_url === null ? [] : [p.final_url])].map(canon));
  return new Set(
    edges
      .filter((e) => own.has(canon(e.from_url)) && e.to_url !== e.from_url)
      .map((e) => canon(e.to_url)),
  ).size;
};

/** Each page's `links_out` raised to at least the distinct links the record holds from it. */
const settle = (pages: PageResult[], edges: LinkEdge[]) =>
  pages.map((p) => ({ ...p, links_out: Math.max(p.links_out, heldFrom(p, edges)) }));

function truthOf(pages: PageResult[], edges: LinkEdge[], scope: Scope) {
  const internalLinks = scope.unmeasured ? 0 : edges.length + (scope.extraLinks ?? 0);
  const linkGap =
    edges.length > 0
      ? null
      : internalLinks === 0 && pages.every((p) => p.links_out === 0)
        ? 'unread'
        : 'unrecorded';
  // Where each request answered: the final URL of a recorded redirect chain, else its own URL.
  const at = (p: PageResult) =>
    p.redirect && p.redirect.hops.length > 0 && p.final_url !== null ? p.final_url : p.url;
  const isGone = (p: PageResult) => p.status_code === 404 || p.status_code === 410;
  // A row per URL where an error answered and its status.
  const rowMap = new Map<
    string,
    { at: string; status: number; gone: boolean; asked: Set<string> }
  >();
  for (const p of pages.filter((x) => x.status_code >= 400)) {
    const key = `${p.status_code} ${at(p)}`;
    const r = rowMap.get(key) ?? {
      at: at(p),
      status: p.status_code,
      gone: isGone(p),
      asked: new Set([at(p), canon(at(p))]),
    };
    r.asked.add(p.url).add(canon(p.url));
    rowMap.set(key, r);
  }
  const rows = [...rowMap.values()].map((r) => ({
    ...r,
    into: edges.filter(
      (e) =>
        r.asked.has(canon(e.to_url)) && !r.asked.has(canon(e.from_url)) && e.from_url !== e.to_url,
    ),
  }));
  const goneRows = rows.filter((r) => r.gone);
  const missingAt = distinct(goneRows.map((r) => r.at));
  const linkedAt = new Set(goneRows.filter((r) => r.into.length).map((r) => r.at));
  const brokenRows = goneRows.filter((r) => linkedAt.has(r.at));
  const unlinkedRows = goneRows.filter((r) => !linkedAt.has(r.at));
  const otherRows = rows.filter((r) => !r.gone);
  // One per page that answered 200, keyed on where it answered in the engine's spelling: `/old`
  // redirected to `/new` and `/new` itself are one page, read off the row requested at that URL
  // when the record holds one, else off the first. Keyed on the page, never on the rows.
  const servedBy = new Map<string, PageResult>();
  for (const p of pages.filter((x) => x.status_code === 200)) {
    const key = canon(at(p));
    const direct = (x: PageResult) => (x.redirect?.hops.length ?? 0) === 0 && canon(x.url) === key;
    const held = servedBy.get(key);
    if (!held || (!direct(held) && direct(p))) servedBy.set(key, p);
  }
  const served = [...servedBy.values()];
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
      notRead: served.filter((p) => p[key] === null).map((p) => p.url),
      missing: missing.map((p) => path(p.url)).sort(),
      cut: cut.length,
      sharedPages: shared.reduce((n, ps) => n + ps.length, 0),
      cutPaths: new Set(cut.map((p) => path(p.url))),
    };
  };
  const pair = (r: { at: string; status: number }) => `${path(r.at)} ${r.status}`;
  return {
    checked: pages.length,
    crawled: pages.length + (scope.extraCrawled ?? 0),
    served: served.length,
    linksHeld: edges.length,
    linkGap,
    heldLinks: scope.extraLinks && !scope.unmeasured ? edges.length + scope.extraLinks : null,
    // Over every row that answered 200: each row's links are its own request's.
    notAllHeld: pages.filter(
      (p) => p.status_code === 200 && p.is_html && p.links_out > heldFrom(p, edges),
    ).length,
    rows,
    missingAt,
    broken: linkedAt.size,
    unlinked: missingAt.length - linkedAt.size,
    brokenPairs: brokenRows.map(pair).sort(),
    unlinkedPairs: unlinkedRows.map(pair).sort(),
    otherPairs: otherRows.map(pair).sort(),
    brokenStatuses: sortNum(distinct(brokenRows.map((r) => r.status))),
    unlinkedStatuses: sortNum(distinct(unlinkedRows.map((r) => r.status))),
    otherStatuses: sortNum(distinct(otherRows.map((r) => r.status))),
    linkingPages: new Set(brokenRows.flatMap((r) => r.into.map((e) => e.from_url))).size,
    otherErrorsAt: distinct(otherRows.map((r) => r.at)),
    anyError: pages.some((p) => p.status_code >= 400),
    redirectsRecorded: pages.filter((p) => p.redirect !== null).length,
    redirecting: pages.filter((p) => (p.redirect?.hops.length ?? 0) > 0).length,
    loops: pages.filter((p) => (p.redirect?.hops.length ?? 0) > 0 && p.redirect!.loop).length,
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
    v.coverage.read,
    v.broken.empty ?? '',
    v.redirects.empty ?? '',
    v.unlinked.heading,
    v.errors.heading,
    ...[v.titles, v.descriptions].flatMap((c) => [c.heading, c.missingLine, c.sharedLine]),
    ...rows.flatMap((r) => [r.pageText, r.linkedSummary, r.linkedAll]),
    ...v.redirects.rows.flatMap((r) => [r.path, r.hops, r.endsText]),
    door.body,
    door.pill.label,
    door.coverage && 'read' in door.coverage ? door.coverage.read : '',
    tab,
    map.title,
    ...pdfStrings,
    ...[...screen.querySelectorAll('h2, th, p, td, li, summary')].map((n) => n.textContent ?? ''),
    screen.body.textContent ?? '',
  ].filter((s) => s !== '');
  return { v, door, tab, map, strings, screenText: screen.body.textContent ?? '' };
}

const num = (s: string) => Number(s.replace(/,/g, ''));
const matchesOf = (strings: readonly string[], re: RegExp) =>
  strings.flatMap((s) => [...s.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))]);
const statusList = (s: string) => sortNum(s.split(/ or |, /).map(Number));
const nPages = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'page' : 'pages'}`;

/**
 * Wordings that claim more than the record holds: that no page links to a page, that the site has
 * no broken link, that we read a page's links (the record may hold some of them), a link claim not
 * scoped to the record, or that a page exists or is missing beyond the status it answered.
 */
const FORBIDDEN: readonly RegExp[] = [
  /no link from another page/i,
  /no other page links/i,
  /no broken link/i,
  /unlinked/i,
  /we read/i,
  /leads to/i,
  /\bno link(?! text)/i,
  /no (internal )?link (in|read|recorded|found|was|is)\b/i,
  /no (internal )?link leads to/i,
  /no link found/i,
  /missing pages no/i,
  /not missing/i,
  /\b(is|are) missing\b/i,
];

/** The assertions: no string contradicts the record. */
function expectTrueToTheRecord(given: PageResult[], edges: LinkEdge[], scope: Scope = {}) {
  const pages = settle(given, edges);
  const t = truthOf(pages, edges, scope);
  const d = dataset(pages, edges, scope);
  const { v, door, tab, map, strings, screenText } = said(d);
  const pill = v.headline.pill?.label ?? 'not measured';

  for (const s of strings) for (const re of FORBIDDEN) expect(s).not.toMatch(re);

  // The door, the tab and the screen say the same figure.
  expect(door.pill.label).toBe(pill);
  expect(tab).toBe(`Next: Links and pages · ${pill}`);

  // The coverage line: the pages checked, of the pages crawled when the record holds fewer.
  expect(v.coverage.read).toBe(
    t.crawled > t.checked
      ? `Checked ${t.checked} of the ${nPages(t.crawled)} crawled`
      : `Checked ${nPages(t.checked)}`,
  );
  expect(door.coverage).toEqual({ read: v.coverage.read });

  if (t.checked === 0) {
    expect(v.tiles.map((x) => x.value)).toEqual(Array(4).fill('not measured'));
    expect(pill).toBe('not measured');
    return;
  }

  // The tables: one row per (page, status), each in the table its page's links put it in.
  const pairs = (rs: readonly { path: string; status: number }[]) =>
    rs.map((r) => `${r.path} ${r.status}`).sort();
  expect(pairs(v.broken.rows)).toEqual(t.brokenPairs);
  expect(pairs(v.unlinked.rows)).toEqual(t.unlinkedPairs);
  expect(pairs(v.errors.rows)).toEqual(t.otherPairs);
  expect([v.counts.broken, v.counts.missingUnlinked, v.counts.errors]).toEqual([
    t.broken,
    t.unlinked,
    t.otherErrorsAt.length,
  ]);

  // Each row's linking pages, its summary ("/a, /b and N more"), and what stands in for none.
  const stand = '0 pages in this check’s record';
  for (const r of [...v.broken.rows, ...v.unlinked.rows, ...v.errors.rows]) {
    const truth = t.rows.find((x) => path(x.at) === r.path && x.status === r.status)!;
    // Each distinct linking URL once; shown whole when two of them differ only in their scheme, so
    // the cell lists as many pages as the count counts.
    const fromUrls = distinct(truth.into.map((e) => e.from_url));
    const noScheme = (u: string) => {
      const x = new URL(u);
      return `${x.host}${x.pathname}${x.search}`;
    };
    const spellOut = new Set(fromUrls.map(noScheme)).size < fromUrls.length;
    const froms = fromUrls.map((u) => (spellOut ? u : path(u)));
    expect(distinct(r.linkedFrom.map((l) => l.path))).toEqual(froms);
    if (!froms.length) {
      expect([r.linkedSummary, r.linkedAll]).toEqual([stand, stand]);
    } else {
      expect(r.linkedAll).toBe(froms.join(', '));
      expect(r.linkedSummary.startsWith(froms.slice(0, 2).join(', '))).toBe(true);
      const more = r.linkedSummary.match(/ and (\d+) more$/);
      expect(more ? num(more[1]!) : 0).toBe(Math.max(0, froms.length - 2));
    }
  }

  // The body's sentences: counts and status lists, each said exactly when the record has it.
  const bodies = [v.body, door.body];
  for (const body of bodies) {
    const b = matchesOf(
      [body],
      /(\d[\d,]*) missing pages?, linked from ([1-9][\d,]*) pages? in this check’s record, answering ([\d or]+)\./,
    );
    expect(b.map((m) => [num(m[1]!), num(m[2]!), statusList(m[3]!)])).toEqual(
      t.broken ? [[t.broken, t.linkingPages, t.brokenStatuses]] : [],
    );
    const u = matchesOf(
      [body],
      /(\d[\d,]*) missing pages?, linked from 0 pages in this check’s record, answering ([\d or]+)\./,
    );
    expect(u.map((m) => [num(m[1]!), statusList(m[2]!)])).toEqual(
      t.unlinked ? [[t.unlinked, t.unlinkedStatuses]] : [],
    );
    const e = matchesOf([body], /(\d[\d,]*) pages? answered an error \(([\d, ]+)\)\./);
    expect(e.map((m) => [num(m[1]!), statusList(m[2]!)])).toEqual(
      t.otherErrorsAt.length ? [[t.otherErrorsAt.length, t.otherStatuses]] : [],
    );
    const r = matchesOf([body], /(\d[\d,]*) pages? redirects?(?:, (\d[\d,]*) in a loop)?\./);
    expect(r.map((m) => [num(m[1]!), m[2] === undefined ? 0 : num(m[2])])).toEqual(
      t.redirecting ? [[t.redirecting, t.loops]] : [],
    );
    // The record holds only some of the links: said, from the record, when links were read.
    const held = matchesOf([body], /[Tt]he record holds (\d[\d,]*) of the (\d[\d,]*) links found/);
    expect(held.map((m) => [num(m[1]!), num(m[2]!)])).toEqual(
      t.linkGap === null && t.heldLinks !== null ? [[t.linksHeld, t.heldLinks]] : [],
    );
    const notAll = matchesOf(
      [body],
      /the links of (\d[\d,]*) pages? are not all in this check’s record/i,
    );
    expect(notAll.map((m) => num(m[1]!))).toEqual(t.notAllHeld ? [t.notAllHeld] : []);
  }

  // The pill: a count of the missing pages, linked or not, or that no page checked answered 404 or
  // 410. The body's sentences carry the scope the pill leaves out.
  const missingCount = t.broken + t.unlinked;
  expect(pill).toBe(
    missingCount
      ? `${missingCount} missing ${missingCount === 1 ? 'page' : 'pages'}`
      : 'no 404 or 410',
  );
  // "Answered 404 or 410" is said of none only when no page checked answered either.
  if (
    strings.some((x) =>
      /did not answer 404 or 410|no page checked answered|^no 404 or 410$/i.test(x),
    )
  )
    expect(t.missingAt).toEqual([]);

  // The headline: the scope, the missing pages found, whether links were read, the redirects and
  // the titles and descriptions read.
  const h = v.headline.title.match(
    /^(?:(\d+) pages? checked: )?(\d+) missing pages? found · (?:(\d+) redirects?|redirects not recorded) · (?:titles and descriptions read on (\d+) pages?|titles read on (\d+) pages?, descriptions on (\d+))$/,
  );
  expect(h).not.toBeNull();
  expect(h![1] === undefined ? null : num(h![1])).toBe(t.crawled > t.checked ? t.checked : null);
  expect(num(h![2]!)).toBe(t.missingAt.length);
  expect(h![3] === undefined ? null : num(h![3])).toBe(t.redirectsRecorded ? t.redirecting : null);
  const readOn = h![4] !== undefined ? [num(h![4]), num(h![4])] : [num(h![5]!), num(h![6]!)];
  expect(readOn).toEqual([t.titles.read, t.descriptions.read]);

  // The tiles.
  const tile = (label: string) => v.tiles.find((x) => x.label === label)!.value;
  expect(tile('Missing pages found')).toBe(String(t.missingAt.length));
  if (t.redirectsRecorded === 0) expect(tile('Redirects')).toBe('not recorded');
  else expect(tile('Redirects')).toBe(String(t.redirecting));

  // With no link held, no string names a page a link comes from.
  if (t.linksHeld === 0) {
    for (const s of strings) expect(s).not.toMatch(/linked from [1-9]/i);
  }

  // The map counts the missing pages as the Links screen does, scoped to the pages checked.
  if (!map.noneServed) {
    const m = map.title.match(/(\d[\d,]*) missing( among the (\d[\d,]*) checked)?,/);
    expect(m ? num(m[1]!) : 0).toBe(t.missingAt.length);
    if (m)
      expect(m[3] === undefined ? null : num(m[3])).toBe(t.crawled > t.checked ? t.checked : null);
  }

  // "No error" and "no redirect" only when the record shows none.
  if (
    strings.some((s) => /answers an error\.|answers no error/.test(s) && /None|no error/.test(s))
  ) {
    expect(t.anyError).toBe(false);
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

  // Titles and descriptions: a page not read is never counted missing; a tile never shows a number
  // where its column says "not read"; a cut text is never grouped as shared.
  for (const [key, col, label] of [
    ['titles', v.titles, 'Missing titles'],
    ['descriptions', v.descriptions, 'Missing descriptions'],
  ] as const) {
    const hd = t[key];
    expect(
      col.missing.shown
        .concat(col.missing.rest)
        .map((p) => p.path)
        .sort(),
    ).toEqual(hd.missing);
    if (/^Missing: not read/.test(col.missingLine)) expect(tile(label)).not.toMatch(/\d/);
    if (hd.read === 0) {
      expect(col.missingLine).toMatch(/not read/);
      expect(tile(label)).toBe('not read');
    } else {
      expect(tile(label)).toBe(String(hd.missing.length));
      if (/^Missing: none/.test(col.missingLine)) expect(hd.missing).toEqual([]);
      if (hd.notRead.length) {
        expect(col.missingLine).toContain(`not read on ${nPages(hd.notRead.length)}`);
      }
    }
    for (const g of col.shared.shown.concat(col.shared.rest)) {
      for (const p of g.pages.shown.concat(g.pages.rest))
        expect(hd.cutPaths.has(p.path)).toBe(false);
    }
    const sharedTotal = col.shared.shown
      .concat(col.shared.rest)
      .reduce((n, g) => n + g.pageCount, 0);
    expect(sharedTotal).toBe(hd.sharedPages);
  }

  // The body's clauses on titles and descriptions, each said exactly when the record has it.
  const anyRead = t.served > 0 && (t.titles.read > 0 || t.descriptions.read > 0);
  for (const body of [v.body, door.body]) {
    const count1 = (re: RegExp) => matchesOf([body], re).map((m) => num(m[1]!));
    const when = (n: number) => (anyRead && n ? [n] : []);
    expect(count1(/(\d[\d,]*) pages? (?:has|have) no title/)).toEqual(
      when(t.titles.missing.length),
    );
    expect(count1(/(\d[\d,]*) pages? (?:has|have) no meta description/)).toEqual(
      when(t.descriptions.missing.length),
    );
    expect(count1(/(\d[\d,]*) pages share a title with another/)).toEqual(
      when(t.titles.sharedPages),
    );
    expect(count1(/(\d[\d,]*) pages share a meta description with another/)).toEqual(
      when(t.descriptions.sharedPages),
    );
    expect(
      count1(/(\d[\d,]*) titles? cut short at [\d,]+ bytes (?:was|were) not compared/),
    ).toEqual(when(t.titles.cut));
    expect(
      count1(/(\d[\d,]*) descriptions? cut short at [\d,]+ bytes (?:was|were) not compared/),
    ).toEqual(when(t.descriptions.cut));
    // Not read: one clause for both when the same pages, else one for each.
    const notRead = { title: 0, description: 0 };
    for (const m of matchesOf(
      [body],
      /the (titles? and meta descriptions?|titles?|meta descriptions?) of (\d[\d,]*) pages? that answered 200 (?:was|were) not read/i,
    )) {
      if (/and/.test(m[1]!)) {
        // One clause for both only when the same pages were not read.
        expect([...t.titles.notRead].sort()).toEqual([...t.descriptions.notRead].sort());
        notRead.title += num(m[2]!);
        notRead.description += num(m[2]!);
      } else if (/title/.test(m[1]!)) notRead.title += num(m[2]!);
      else notRead.description += num(m[2]!);
    }
    expect(notRead).toEqual(
      anyRead
        ? { title: t.titles.notRead.length, description: t.descriptions.notRead.length }
        : { title: 0, description: 0 },
    );
  }
  if (
    strings.some((s) =>
      /has its own title and meta description|has a title and a meta description/.test(s),
    )
  ) {
    for (const hd of [t.titles, t.descriptions]) {
      expect([hd.notRead.length, hd.missing.length, hd.cut, hd.sharedPages]).toEqual([0, 0, 0, 0]);
    }
  }

  // A chain whose last response is a redirect names no URL and no status where it ends: the record
  // cannot say whether that URL was requested. Any other chain ends at the status it answered.
  for (const r of v.redirects.rows) {
    const p = pages.find((x) => x.url === r.url)!;
    if (p.redirect!.loop) expect(r.endsText).toBe('LOOP');
    else if ([301, 302, 303, 307, 308].includes(p.status_code))
      expect(r.endsText).toBe('not followed to the end');
    else if (p.final_url !== null) expect(r.endsText.endsWith(` (${p.status_code})`)).toBe(true);
  }

  // The redirect table names where a chain started as requested, never as linked.
  expect(screenText).not.toContain('Linked as');
  if (t.redirecting) expect(screenText).toContain('Requested as');
}

// ---- The named shapes ---------------------------------------------------------------------------

const PDF = page('/guide.pdf', 200, {
  is_html: false,
  links_read: false,
  title: null,
  meta_description: null,
});
const gone = (path: string, status: number, over: Partial<PageResult> = {}) =>
  page(path, status, { title: null, meta_description: null, links_read: false, ...over });

const SHAPES: [string, PageResult[], LinkEdge[], Scope][] = [
  ['no page', [], [], {}],
  ['pages with no link edges', [page('/', 200), page('/a', 200), page('/b', 200)], [], {}],
  ['links found but none recorded', [page('/', 200), page('/a', 200)], [], { extraLinks: 5 }],
  [
    'structure not measured, with a missing page',
    [page('/', 200), gone('/gone', 404)],
    [],
    { unmeasured: true },
  ],
  ['only 503', [gone('/', 503)], [], {}],
  ['only 429', [gone('/', 429), gone('/a', 429)], [], {}],
  [
    'a 404 linked only from itself',
    [page('/', 200), gone('/gone', 404)],
    [edge('/gone', '/gone')],
    {},
  ],
  [
    'a redirect chain ending at a 404 that is also in the record',
    [page('/', 200), redirecting('/old', '/new', 404), gone('/new', 404)],
    [edge('/', '/old')],
    {},
  ],
  [
    'a redirect to a 404 whose final URL is not recorded',
    [page('/', 200), redirecting('/old', '/new', 404, { final_url: null })],
    [edge('/', '/old')],
    {},
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
    {},
  ],
  [
    'all titles blank, with zero-width characters',
    [
      page('/', 200, { title: text(null) }),
      page('/a', 200, { title: text('\u00a0') }),
      page('/b', 200, { title: text('\u2003 ') }),
      page('/c', 200, { title: text('\u200b\u2060\ufeff') }),
    ],
    [edge('/', '/a'), edge('/a', '/b'), edge('/b', '/c')],
    {},
  ],
  ['one page', [page('/', 200)], [edge('/', '/')], {}],
  [
    'mixed 404 and 410, linked from three pages and more',
    [
      page('/', 200),
      page('/p', 200),
      page('/q', 200),
      page('/r', 200),
      gone('/a', 404),
      gone('/b', 410),
      gone('/c', 404),
    ],
    [edge('/', '/a'), edge('/p', '/a'), edge('/q', '/a'), edge('/r', '/a'), edge('/', '/b')],
    {},
  ],
  [
    'a 200 non-HTML page (PDF) with no title or description read',
    [page('/', 200), PDF],
    [edge('/', '/guide.pdf')],
    {},
  ],
  [
    'an HTML page whose links were not all read, in a record holding some of the links',
    [page('/', 200, { links_read: false }), page('/a', 200), gone('/gone', 404)],
    [edge('/', '/a'), edge('/a', '/gone')],
    { extraLinks: 760, extraCrawled: 198 },
  ],
  [
    'a title not read on one page and a description not read on another',
    [page('/', 200), page('/a', 200, { title: null }), page('/b', 200, { meta_description: null })],
    [edge('/', '/a'), edge('/', '/b')],
    {},
  ],
  [
    'two long titles cut at 512 bytes sharing a prefix',
    [
      page('/', 200),
      page('/a', 200, { title: text(LONG, true, 600) }),
      page('/b', 200, { title: text(LONG, true, 700) }),
    ],
    [edge('/', '/a'), edge('/', '/b')],
    {},
  ],
  [
    'a URL redirected to a page got a 429 while the page itself answered 410',
    [page('/', 200), redirecting('/old', '/gone', 429), gone('/gone', 410)],
    [edge('/', '/old')],
    {},
  ],
  [
    'a URL redirected to a page got a 429 while the page itself answered 503',
    [page('/', 200), redirecting('/a', '/x', 429), gone('/x', 503)],
    [edge('/', '/a'), edge('/', '/x')],
    {},
  ],
  [
    'a URL redirected to a page got a 404 while the page itself answered 410',
    [page('/', 200), redirecting('/a', '/x', 404), gone('/x', 410)],
    [edge('/', '/a')],
    {},
  ],
  [
    'links from a redirect landing URL outside the record',
    [page('/', 200), redirecting('/moved', '/landing', 200), gone('/gone', 404)],
    [edge('/', '/moved'), edge('/landing', '/gone')],
    {},
  ],
];

describe('Links and pages: counts, rows, pills and clauses agree with the truth computed here, and no string matches FORBIDDEN: the named shapes', () => {
  it.each(SHAPES)('%s', (_name, pages, edges, scope) => expectTrueToTheRecord(pages, edges, scope));
});

// ---- Hand-counted vectors: the expected strings are written out, not computed ------------------

/** A page read whole as HTML, counting `linksOut` distinct links. */
const whole = (path: string, linksOut: number) =>
  page(path, 200, { is_html: true, links_read: true, links_out: linksOut });
const pdf = (path: string) =>
  page(path, 200, { is_html: false, links_read: false, title: null, meta_description: null });

interface Said {
  pill: string;
  /** The screen's body. */
  body: string;
  /** The door's body: the screen's, with the sentence the empty state says when it says it. */
  doorBody: string;
  tab: string;
  brokenEmpty: string | null;
  headline: string;
  /** The redirects table, as [Requested as, Hops, Ends at]: the screen's rows and the PDF's. */
  redirects?: string[][];
  /** The missing-page rows that a link leads to, as [page, linked summary, linked from]. */
  broken?: string[][];
  /** Each column's two lines: [missing, shared]. */
  titles?: [string, string];
  descriptions?: [string, string];
}

/** The same site at http://, as an old internal link spells it. */
const HTTP_ORIGIN = ORIGIN.replace(/^https:/, 'http:');
/**
 * A chain the worker stopped before its last Location (packages/worker/src/batch/polite-fetch.ts
 * `followChain`): `final_url` is that Location, which was not requested, and the status is the 3xx
 * of the hop before it. The row was not read, and its response was a redirect, not HTML.
 */
const stopped = (from: string, hops: [string, number, string][]) =>
  page(from, hops.at(-1)![1], {
    final_url: hops.at(-1)![2],
    title: null,
    meta_description: null,
    links_read: false,
    is_html: false,
    redirect: {
      hops: hops.map(([f, status, location]) => ({ from: f, status, location })),
      loop: false,
    },
  });
const SEVEN = ['/r1', '/r2', '/r3', '/r4', '/r5', '/r6', '/r7'];

const VECTORS: [string, PageResult[], LinkEdge[], Said][] = [
  [
    '(a) the cap: / read whole counts 1,500 links and the record keeps one; /gone 404 with no kept link',
    [whole('/', 1500), gone('/gone', 404)],
    [edge('/', '/a')],
    {
      pill: '1 missing page',
      body:
        '1 missing page, linked from 0 pages in this check’s record, answering 404. ' +
        'The links of 1 page are not all in this check’s record. ' +
        'The page that answered 200 has a title and a meta description.',
      doorBody:
        '1 missing page, linked from 0 pages in this check’s record, answering 404. ' +
        'The links of 1 page are not all in this check’s record. ' +
        'The page that answered 200 has a title and a meta description.',
      tab: 'Next: Links and pages · 1 missing page',
      brokenEmpty: 'The missing page is linked from 0 pages in this check’s record.',
      headline: '1 missing page found · 0 redirects · titles and descriptions read on 1 page',
    },
  ],
  [
    '(b) the batch out of room: / read whole counts 3 links and the record keeps none; /gone 410',
    [whole('/', 3), gone('/gone', 410)],
    [],
    {
      pill: '1 missing page',
      body:
        '1 missing page, linked from 0 pages in this check’s record, answering 410. ' +
        'The links of 1 page are not all in this check’s record. ' +
        'The page that answered 200 has a title and a meta description.',
      doorBody:
        '1 missing page, linked from 0 pages in this check’s record, answering 410. ' +
        'The links of 1 page are not all in this check’s record. ' +
        'The page that answered 200 has a title and a meta description.',
      tab: 'Next: Links and pages · 1 missing page',
      brokenEmpty: 'The missing page is linked from 0 pages in this check’s record.',
      headline: '1 missing page found · 0 redirects · titles and descriptions read on 1 page',
    },
  ],
  [
    '(c) two pages link to /gone and the record keeps the link of one',
    [whole('/', 1), whole('/a', 1), gone('/gone', 404)],
    [edge('/', '/gone')],
    {
      pill: '1 missing page',
      body:
        '1 missing page, linked from 1 page in this check’s record, answering 404. ' +
        'The links of 1 page are not all in this check’s record. ' +
        'Each of the 2 pages that answered 200 has its own title and meta description.',
      doorBody:
        '1 missing page, linked from 1 page in this check’s record, answering 404. ' +
        'The links of 1 page are not all in this check’s record. ' +
        'Each of the 2 pages that answered 200 has its own title and meta description.',
      tab: 'Next: Links and pages · 1 missing page',
      brokenEmpty: null,
      headline: '1 missing page found · 0 redirects · titles and descriptions read on 2 pages',
    },
  ],
  [
    '(d) / answers 200 and three pages answer 429',
    [whole('/', 1), gone('/a', 429), gone('/b', 429), gone('/c', 429)],
    [edge('/', '/a')],
    {
      pill: 'no 404 or 410',
      body:
        '3 pages answered an error (429). ' +
        'The page that answered 200 has a title and a meta description.',
      doorBody:
        '3 pages answered an error (429). ' +
        'The page that answered 200 has a title and a meta description.',
      tab: 'Next: Links and pages · no 404 or 410',
      brokenEmpty: 'No page checked answered 404 or 410.',
      headline: '0 missing pages found · 0 redirects · titles and descriptions read on 1 page',
    },
  ],
  [
    '(e) two PDFs answering 200',
    [pdf('/a.pdf'), pdf('/b.pdf')],
    [],
    {
      pill: 'no 404 or 410',
      body: 'No title or meta description was read on the 2 pages that answered 200.',
      doorBody:
        'None of the 2 pages we checked answers an error. ' +
        'No title or meta description was read on the 2 pages that answered 200.',
      tab: 'Next: Links and pages · no 404 or 410',
      brokenEmpty: 'None of the 2 pages we checked answers an error.',
      headline: '0 missing pages found · 0 redirects · titles and descriptions read on 0 pages',
    },
  ],
  [
    '(f) a redirect lands on /gone/ answering 404, and the record holds a link from / to /gone',
    [
      whole('/', 1),
      redirecting('/old', '/gone/', 404, {
        links_read: false,
        title: null,
        meta_description: null,
      }),
    ],
    [edge('/', '/gone')],
    {
      pill: '1 missing page',
      body:
        '1 missing page, linked from 1 page in this check’s record, answering 404. ' +
        '1 page redirects. ' +
        'The page that answered 200 has a title and a meta description.',
      doorBody:
        '1 missing page, linked from 1 page in this check’s record, answering 404. ' +
        '1 page redirects. ' +
        'The page that answered 200 has a title and a meta description.',
      tab: 'Next: Links and pages · 1 missing page',
      brokenEmpty: null,
      headline: '1 missing page found · 1 redirect · titles and descriptions read on 1 page',
    },
  ],
  [
    '(g) a page whose reader stopped counts no link: no clause on links not in the record',
    [whole('/', 1), page('/a', 200, { is_html: true, links_read: false, links_out: 0 })],
    [edge('/', '/a')],
    {
      pill: 'no 404 or 410',
      body: 'Each of the 2 pages that answered 200 has its own title and meta description.',
      doorBody:
        'None of the 2 pages we checked answers an error. ' +
        'Each of the 2 pages that answered 200 has its own title and meta description.',
      tab: 'Next: Links and pages · no 404 or 410',
      brokenEmpty: 'None of the 2 pages we checked answers an error.',
      headline: '0 missing pages found · 0 redirects · titles and descriptions read on 2 pages',
    },
  ],
  [
    '(h) a chain stopped after six hops: /r1 301s six times to /r7, which was never requested',
    [
      whole('/', 1),
      stopped(
        '/r1',
        SEVEN.slice(0, 6).map((p, i): [string, number, string] => [
          url(p),
          301,
          url(SEVEN[i + 1]!),
        ]),
      ),
    ],
    [edge('/', '/r1')],
    {
      pill: 'no 404 or 410',
      body: '1 page redirects. The page that answered 200 has a title and a meta description.',
      doorBody:
        'None of the 2 pages we checked answers an error. ' +
        '1 page redirects. The page that answered 200 has a title and a meta description.',
      tab: 'Next: Links and pages · no 404 or 410',
      brokenEmpty: 'None of the 2 pages we checked answers an error.',
      headline: '0 missing pages found · 1 redirect · titles and descriptions read on 1 page',
      redirects: [
        [
          '/r1',
          '301 → /r2 → 301 → /r3 → 301 → /r4 → 301 → /r5 → 301 → /r6 → 301 → /r7',
          'not followed to the end',
        ],
      ],
    },
  ],
  [
    '(i) a chain stopped off the site: /go 301s to https://partner.example/x, which was never requested',
    [whole('/', 1), stopped('/go', [[url('/go'), 301, 'https://partner.example/x']])],
    [edge('/', '/go')],
    {
      pill: 'no 404 or 410',
      body: '1 page redirects. The page that answered 200 has a title and a meta description.',
      doorBody:
        'None of the 2 pages we checked answers an error. ' +
        '1 page redirects. The page that answered 200 has a title and a meta description.',
      tab: 'Next: Links and pages · no 404 or 410',
      brokenEmpty: 'None of the 2 pages we checked answers an error.',
      headline: '0 missing pages found · 1 redirect · titles and descriptions read on 1 page',
      redirects: [['/go', '301 → https://partner.example/x', 'not followed to the end']],
    },
  ],
  [
    '(j) a chain stopped by robots.txt: /account 302s to /login, a disallowed path never requested',
    [whole('/', 1), stopped('/account', [[url('/account'), 302, url('/login')]])],
    [edge('/', '/account')],
    {
      pill: 'no 404 or 410',
      body: '1 page redirects. The page that answered 200 has a title and a meta description.',
      doorBody:
        'None of the 2 pages we checked answers an error. ' +
        '1 page redirects. The page that answered 200 has a title and a meta description.',
      tab: 'Next: Links and pages · no 404 or 410',
      brokenEmpty: 'None of the 2 pages we checked answers an error.',
      headline: '0 missing pages found · 1 redirect · titles and descriptions read on 1 page',
      redirects: [['/account', '302 → /login', 'not followed to the end']],
    },
  ],
  [
    '(k) /old 301s to /new, which answers 200, and /new is in the record too: one page',
    [whole('/', 2), redirecting('/old', '/new', 200), whole('/new', 0)],
    [edge('/', '/old'), edge('/', '/new')],
    {
      pill: 'no 404 or 410',
      body:
        '1 page redirects. ' +
        'Each of the 2 pages that answered 200 has its own title and meta description.',
      doorBody:
        'None of the 3 pages we checked answers an error. 1 page redirects. ' +
        'Each of the 2 pages that answered 200 has its own title and meta description.',
      tab: 'Next: Links and pages · no 404 or 410',
      brokenEmpty: 'None of the 3 pages we checked answers an error.',
      headline: '0 missing pages found · 1 redirect · titles and descriptions read on 2 pages',
      redirects: [['/old', '301 → /new', '/new (200)']],
      titles: ['Missing: none', 'Shared by more than one page: none'],
      descriptions: ['Missing: none', 'Shared by more than one page: none'],
    },
  ],
  [
    '(l) http:// 301s to https:// for /a, both in the record, the page with no description: one page',
    [
      whole('/', 2),
      page('/a', 200, {
        url: `${HTTP_ORIGIN}/a`,
        final_url: url('/a'),
        redirect: {
          hops: [{ from: `${HTTP_ORIGIN}/a`, status: 301, location: url('/a') }],
          loop: false,
        },
        meta_description: text(null),
      }),
      page('/a', 200, { meta_description: text(null) }),
    ],
    [edge('/', '/a'), { ...edge('/', '/a'), to_url: `${HTTP_ORIGIN}/a` }],
    {
      pill: 'no 404 or 410',
      body: '1 page redirects. 1 page has no meta description.',
      doorBody:
        'None of the 3 pages we checked answers an error. ' +
        '1 page redirects. 1 page has no meta description.',
      tab: 'Next: Links and pages · no 404 or 410',
      brokenEmpty: 'None of the 3 pages we checked answers an error.',
      headline: '0 missing pages found · 1 redirect · titles and descriptions read on 2 pages',
      redirects: [[`${HTTP_ORIGIN}/a`, `301 → ${ORIGIN}/a`, `${ORIGIN}/a (200)`]],
      titles: ['Missing: none', 'Shared by more than one page: none'],
      descriptions: ['Missing: 1 page', 'Shared by more than one page: none'],
    },
  ],
  [
    '(n) /old and /new reach one page whose two answers differ: it is read off /new, the row requested there',
    [
      whole('/', 2),
      redirecting('/old', '/new', 200),
      page('/new', 200, { meta_description: text(null) }),
    ],
    [edge('/', '/old'), edge('/', '/new')],
    {
      pill: 'no 404 or 410',
      body: '1 page redirects. 1 page has no meta description.',
      doorBody:
        'None of the 3 pages we checked answers an error. ' +
        '1 page redirects. 1 page has no meta description.',
      tab: 'Next: Links and pages · no 404 or 410',
      brokenEmpty: 'None of the 3 pages we checked answers an error.',
      headline: '0 missing pages found · 1 redirect · titles and descriptions read on 2 pages',
      titles: ['Missing: none', 'Shared by more than one page: none'],
      descriptions: ['Missing: 1 page', 'Shared by more than one page: none'],
    },
  ],
  [
    '(o) https://host/a and http://host/a, each answering 200, both link to /gone (404): two pages',
    [
      page('/a', 200),
      page('/a', 200, { url: `${HTTP_ORIGIN}/a`, final_url: `${HTTP_ORIGIN}/a` }),
      gone('/gone', 404),
    ],
    [edge('/a', '/gone'), { ...edge('/a', '/gone'), from_url: `${HTTP_ORIGIN}/a` }],
    {
      pill: '1 missing page',
      body:
        '1 missing page, linked from 2 pages in this check’s record, answering 404. ' +
        '2 pages share a title with another; 2 pages share a meta description with another.',
      doorBody:
        '1 missing page, linked from 2 pages in this check’s record, answering 404. ' +
        '2 pages share a title with another; 2 pages share a meta description with another.',
      tab: 'Next: Links and pages · 1 missing page',
      brokenEmpty: null,
      headline: '1 missing page found · 0 redirects · titles and descriptions read on 2 pages',
      broken: [['/gone', `${ORIGIN}/a, ${HTTP_ORIGIN}/a`, `${ORIGIN}/a, ${HTTP_ORIGIN}/a`]],
    },
  ],
  [
    '(p) a page whose reader stopped counts 3 links and the record holds 1 from it: not all held',
    [page('/', 200, { is_html: true, links_read: false, links_out: 3 }), page('/a', 200)],
    [edge('/', '/a')],
    {
      pill: 'no 404 or 410',
      body:
        'The links of 1 page are not all in this check’s record. ' +
        'Each of the 2 pages that answered 200 has its own title and meta description.',
      doorBody:
        'The links of 1 page are not all in this check’s record. ' +
        'None of the 2 pages we checked answers an error. ' +
        'Each of the 2 pages that answered 200 has its own title and meta description.',
      tab: 'Next: Links and pages · no 404 or 410',
      brokenEmpty: 'None of the 2 pages we checked answers an error.',
      headline: '0 missing pages found · 0 redirects · titles and descriptions read on 2 pages',
    },
  ],
  [
    '(m) the control: /a and /b are two pages, each answering 200 with the title "Same"',
    [
      whole('/', 2),
      page('/a', 200, { title: text('Same') }),
      page('/b', 200, { title: text('Same') }),
    ],
    [edge('/', '/a'), edge('/', '/b')],
    {
      pill: 'no 404 or 410',
      body: '2 pages share a title with another.',
      doorBody:
        'None of the 3 pages we checked answers an error. 2 pages share a title with another.',
      tab: 'Next: Links and pages · no 404 or 410',
      brokenEmpty: 'None of the 3 pages we checked answers an error.',
      headline: '0 missing pages found · 0 redirects · titles and descriptions read on 3 pages',
      titles: ['Missing: none', 'Shared by more than one page: 1 title, 2 pages'],
      descriptions: ['Missing: none', 'Shared by more than one page: none'],
    },
  ],
];

describe('Links and pages on hand-counted records: the pill, body, tab, empty state and headline, as written', () => {
  it.each(VECTORS)('%s', (_name, pages, edges, want) => {
    const d = dataset(settle(pages, edges), edges);
    const { v, door, tab } = said(d);
    const col = (c: typeof v.titles): [string, string] => [c.missingLine, c.sharedLine];
    const pdfRedirects = auditDoc({ dataset: d, checkId: ID }, { home: 'https://h.test' })
      .sections.find((s) => s.heading === REPORT_DOC_COPY.links)!
      .blocks.flatMap((b) =>
        b.type === 'table' && b.columns.includes(REPORT_DOC_COPY.endsAt) ? b.rows : [],
      );
    expect({
      pill: v.headline.pill?.label,
      body: v.body,
      doorBody: door.body,
      tab,
      brokenEmpty: v.broken.empty,
      headline: v.headline.title,
      ...(want.redirects
        ? { redirects: v.redirects.rows.map((r) => [r.path, r.hops, r.endsText]) }
        : {}),
      ...(want.broken
        ? { broken: v.broken.rows.map((r) => [r.pageText, r.linkedSummary, r.linkedAll]) }
        : {}),
      ...(want.titles ? { titles: col(v.titles) } : {}),
      ...(want.descriptions ? { descriptions: col(v.descriptions) } : {}),
    }).toEqual(want);
    expect(door.pill.label).toBe(want.pill);
    if (want.redirects) expect(pdfRedirects).toEqual(want.redirects);
    // The literals first, so a vector that goes red says which string changed; then the truth.
    expectTrueToTheRecord(pages, edges);
  });
});

// ---- Generated records -------------------------------------------------------------------------

const PATHS = ['/', '/a', '/b', '/c', '/d', '/e'];
/** Landing URLs no generated record holds as a page: a redirect may end there and links leave them. */
const LANDINGS = ['/x1', '/x2'];
const headArb = fc.oneof(
  fc.constant<Head>(null),
  fc.constant(text(null)),
  fc.constantFrom('\u00a0', '\u200b', '\u2060\ufeff ', '\u200d\u200c').map((s) => text(s)),
  fc.constantFrom('Home', 'Guide', 'Tents').map((s) => text(s)),
  fc.integer({ min: 513, max: 900 }).map((n) => text(LONG, true, n)),
);
type RedirectKind =
  | { kind: 'none' }
  | { kind: 'null' }
  | { kind: 'hop'; to: string }
  | { kind: 'chain'; to: string }
  | { kind: 'lost'; to: string };
const redirectArb = (p: string): fc.Arbitrary<RedirectKind> => {
  const to = fc.constantFrom(...[...PATHS, ...LANDINGS].filter((x) => x !== p));
  return fc.oneof(
    fc.constant<RedirectKind>({ kind: 'none' }),
    fc.constant<RedirectKind>({ kind: 'null' }),
    to.map((t): RedirectKind => ({ kind: 'hop', to: t })),
    to.map((t): RedirectKind => ({ kind: 'chain', to: t })),
    to.map((t): RedirectKind => ({ kind: 'lost', to: t })),
  );
};
const pageArb = (p: string) =>
  fc
    .record({
      status: fc.constantFrom(200, 200, 200, 404, 410, 429, 503, 301, 302),
      title: headArb,
      desc: headArb,
      redirect: redirectArb(p),
      kind: fc.constantFrom('html', 'html', 'pdf', 'partial'),
    })
    .map(({ status, title, desc, redirect, kind }): PageResult => {
      if (status === 302) {
        // A chain the worker stopped: `final_url` is the Location it did not request, and the status
        // is the 302 of the hop before it.
        return page(p, 302, {
          final_url: url(`${p}-stop`),
          title: null,
          meta_description: null,
          links_read: false,
          is_html: false,
          redirect: {
            hops: [{ from: url(p), status: 302, location: url(`${p}-stop`) }],
            loop: false,
          },
        });
      }
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
      const read =
        status !== 200
          ? { links_read: false }
          : kind === 'pdf'
            ? { is_html: false, links_read: false, title: null, meta_description: null }
            : kind === 'partial'
              ? { links_read: false }
              : {};
      const over = { ...head, ...read };
      switch (redirect.kind) {
        case 'none':
          return page(p, status, over);
        case 'null':
          return page(p, status, { ...over, redirect: null });
        case 'hop':
          return redirecting(p, redirect.to, status, over);
        case 'chain':
        case 'lost':
          return page(p, status, {
            ...over,
            final_url: redirect.kind === 'lost' ? null : url(redirect.to),
            redirect: {
              hops: [
                { from: url(p), status: 301, location: url(`${p}-mid`) },
                { from: url(`${p}-mid`), status: 301, location: url(redirect.to) },
              ],
              loop: false,
            },
          });
      }
    });

const recordArb = fc
  .subarray(PATHS, { minLength: 0 })
  .chain((paths) =>
    fc.tuple(
      fc.tuple(...paths.map(pageArb)),
      fc.uniqueArray(
        fc.tuple(fc.constantFrom(...PATHS, ...LANDINGS), fc.constantFrom(...PATHS, ...LANDINGS)),
        { maxLength: 12, selector: ([a, b]) => `${a} ${b}` },
      ),
      fc.array(fc.constantFrom(0, 0, 0, 2, 1000), { minLength: 6, maxLength: 6 }),
      fc.record({
        extraLinks: fc.constantFrom(0, 0, 1, 3, 700),
        extraCrawled: fc.constantFrom(0, 0, 1, 2, 200),
        unmeasured: fc.constantFrom(false, false, false, false, true),
      }),
    ),
  )
  .map(([pages, links, extraOut, scope]) => {
    // A link is held only from a page the record holds and read as HTML, or from the URL where a
    // redirect of one of them landed, outside the record.
    const from = new Set([
      ...pages.filter((p) => p.is_html).map((p) => p.url),
      ...pages
        .filter((p) => p.is_html && p.final_url !== null && (p.redirect?.hops.length ?? 0) > 0)
        .map((p) => p.final_url!),
    ]);
    const edges = scope.unmeasured
      ? []
      : links.filter(([a]) => from.has(url(a))).map(([a, b]) => edge(a, b));
    // A page read whole may count more links than the record holds from it: the worker keeps the
    // first 1,000 of a page, and none once its batch has used its room.
    // A page whose reader stopped counts the links found before it did: a floor that may be above
    // the links held from it.
    const counted = pages.map((p, i) =>
      p.is_html && p.links_read
        ? { ...p, links_out: heldFrom(p, edges) + extraOut[i]! }
        : p.is_html && extraOut[i] === 2
          ? { ...p, links_out: heldFrom(p, edges) + 2 }
          : { ...p, links_out: heldFrom(p, edges) },
    );
    return { pages: counted, edges, scope };
  });

describe('Links and pages: counts, rows, pills and clauses agree with the truth computed here, and no string matches FORBIDDEN: generated records', () => {
  it('holds for 200 generated records', () => {
    fc.assert(
      fc.property(recordArb, ({ pages, edges, scope }) =>
        expectTrueToTheRecord(pages, edges, scope),
      ),
      { numRuns: 200 },
    );
  });

  it('reaches each axis listed here, over a fixed sample of 400 records', () => {
    // Each key below is an axis the generator varies; each is asserted reached in the sample.
    const sample = fc.sample(recordArb, { numRuns: 400, seed: 7 });
    const some = (pred: (r: (typeof sample)[number]) => boolean) => sample.some(pred);
    const twoStatuses = (r: (typeof sample)[number]) => {
      const t = truthOf(r.pages, r.edges, r.scope);
      const at = t.rows.map((x) => x.at);
      return at.length > new Set(at).size;
    };
    expect({
      withheldLinks: some((r) => (r.scope.extraLinks ?? 0) > 0 && r.edges.length > 0),
      unmeasured: some((r) => r.scope.unmeasured === true && r.pages.length > 0),
      partialHtml: some((r) =>
        r.pages.some((p) => p.is_html && p.status_code === 200 && !p.links_read),
      ),
      fromLanding: some((r) => r.edges.some((e) => LANDINGS.includes(path(e.from_url)))),
      chain: some((r) =>
        r.pages.some(
          (p) =>
            p.redirect !== null &&
            p.redirect.hops.length === 2 &&
            !p.redirect.loop &&
            p.final_url !== null,
        ),
      ),
      lostChain: some((r) =>
        r.pages.some(
          (p) => (p.redirect?.hops.length ?? 0) > 0 && !p.redirect!.loop && p.final_url === null,
        ),
      ),
      twoStatuses: some(twoStatuses),
      zeroWidth: some((r) =>
        r.pages.some((p) => /[\u200b-\u200d\u2060\ufeff]/.test(p.title?.text ?? '')),
      ),
      moreThanTwoLinking: some((r) =>
        truthOf(r.pages, r.edges, r.scope).rows.some(
          (x) => new Set(x.into.map((e) => e.from_url)).size > 2,
        ),
      ),
      unrecorded: some((r) => truthOf(r.pages, r.edges, r.scope).linkGap === 'unrecorded'),
      gone410: some((r) => r.pages.some((p) => p.status_code === 410)),
      loop: some((r) => r.pages.some((p) => p.redirect?.loop === true)),
      stopped: some((r) => r.pages.some((p) => p.status_code === 302 && !p.redirect?.loop)),
      onePageTwoUrls: some((r) => {
        const at = r.pages
          .filter((p) => p.status_code === 200)
          .map((p) =>
            canon((p.redirect?.hops.length ?? 0) > 0 && p.final_url ? p.final_url : p.url),
          );
        return at.length > new Set(at).size;
      }),
      redirectNotRecorded: some((r) => r.pages.some((p) => p.redirect === null)),
      extraCrawled: some((r) => (r.scope.extraCrawled ?? 0) > 0 && r.pages.length > 0),
      cutTitle: some((r) => r.pages.some((p) => p.title?.cut === true)),
      partialAboveHeld: some((r) =>
        r.pages.some(
          (p) =>
            p.status_code === 200 &&
            p.is_html &&
            !p.links_read &&
            p.links_out > heldFrom(p, r.edges),
        ),
      ),
      readWholeNotAllHeld: some((r) =>
        r.pages.some(
          (p) =>
            p.status_code === 200 &&
            p.is_html &&
            p.links_read &&
            p.links_out > heldFrom(p, r.edges),
        ),
      ),
    }).toEqual({
      withheldLinks: true,
      unmeasured: true,
      partialHtml: true,
      fromLanding: true,
      chain: true,
      lostChain: true,
      twoStatuses: true,
      zeroWidth: true,
      moreThanTwoLinking: true,
      unrecorded: true,
      gone410: true,
      loop: true,
      stopped: true,
      onePageTwoUrls: true,
      redirectNotRecorded: true,
      extraCrawled: true,
      cutTitle: true,
      partialAboveHeld: true,
      readWholeNotAllHeld: true,
    });
  });
});

describe('the spelling the record’s links are counted in', () => {
  it('is the engine’s canonicalizeUrl, over URLs that vary each part it rewrites', () => {
    const urls = [
      'https://Example.COM/',
      'https://example.com',
      'https://example.com/a/',
      'https://example.com//a///b/',
      'https://example.com/a?b=2&a=1&a=0',
      'https://example.com/a#part',
      'https://example.com:443/a/?z=1#x',
      'http://example.com:80/',
      'http://example.com:8080/a/',
      'https://example.com/%7Euser/?q=a%20b',
    ];
    expect(urls.map(linkSpelling)).toEqual(urls.map((u) => canonicalizeUrl(u)));
  });
});
