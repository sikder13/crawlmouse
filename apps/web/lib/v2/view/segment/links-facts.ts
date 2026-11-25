/**
 * Links and pages (row 5) as data: the missing pages a link in the record leads to and the pages of
 * the record that link to them, the missing pages the record links to from 0 pages, the pages that
 * answered another error, the pages that redirect, and the titles and meta descriptions that are missing or shared. It
 * reads the page and link records of one check. A page's status, final URL, title and meta
 * description are read through the pages CSV's accessors (reports/csv.ts), so the screen, the CSV
 * and the PDF read the same values; its redirect chain, which the CSV has no column for, is read off
 * `page.redirect`. Which statuses are missing, where a redirected page answered, and the rows (one
 * per URL where a page answered and status) are segment/broken.ts's, which the link map reads too.
 *
 * The record holds some of a site's links, not all of them. A page read whole (`links_read` true)
 * can still have none or only some of its links in the record: the worker keeps the first 1,000
 * distinct links of a page, and stores none of a page's links once its batch has used its room for
 * them, while `links_out` keeps the page's full count of distinct links. A page read in part has
 * `links_read` false, a page not crawled gives none, and a fixture may hold a subset (`withheld`).
 * So what it says of links is a count over the record, "linked from 2 pages in this check’s
 * record", "linked from 0 pages", never a claim that no link exists; and the pages whose links the record does not hold in
 * full are counted from `links_out` against the links the record holds from each
 * (`linksNotAllHeld`). Of the pages checked it says which statuses none answered ("no page checked
 * answered 404 or 410"), never that a page exists. __tests__/v2/links-sentences.property.test.tsx
 * holds a list of the wordings that claimed more (FORBIDDEN) and fails when a string the feature
 * renders for the records it builds matches one.
 *
 * Titles and descriptions are read over the pages that answered 200, each page that answered once
 * however many of the record's URLs reached it (`/old` redirected to `/new`), in three kinds: not
 * read (the page's `title` or `meta_description` is null: a non-HTML page, or one read in part),
 * missing (read, and the page declares none, or text made of whitespace alone), and present. A page not read is
 * never counted missing; it is counted apart, and named where the counts are.
 */
import type { Check, LinkEdge, PageResult } from '@crawlmouse/types/v2';
import { DESCRIPTION_BYTES, REDIRECT_STATUSES, TITLE_BYTES } from '@crawlmouse/types/v2';
import { siteOf } from '../../fixtures';
import { PAGE_CELLS } from '../../reports/csv';
import { capitalise, count, plural } from '../../words';
import { sectionMeasured } from '../section-measured';
import { answeredAt, errorRows, redirected, type ErrorRow } from './broken';
import type { DoorView } from '../result';
import type { ViewDataset } from '../../fixtures';

/** The most items a list shows before "and N more"; the rest sit behind a disclosure. */
export const LIST_MAX = 10;

/** A list cut at LIST_MAX: what shows, what the disclosure holds, and the disclosure's words. */
export interface ShortList<T> {
  shown: T[];
  rest: T[];
  /** "and 3 more"; null when nothing is held back. */
  more: string | null;
  /** "and 3 more in the app", as the PDF ends a list it cuts; null when nothing is held back. */
  moreInApp: string | null;
}

export function shortList<T>(items: readonly T[], max = LIST_MAX): ShortList<T> {
  const rest = items.filter((_, i) => i >= max);
  return {
    shown: items.filter((_, i) => i < max),
    rest,
    more: rest.length ? `and ${count(rest.length)} more` : null,
    moreInApp: rest.length ? `and ${count(rest.length)} more in the app` : null,
  };
}

/** A page of the record: its full URL (a row's key) and its URL as shown. */
export interface PageRef {
  url: string;
  path: string;
}

export interface LinkingPage extends PageRef {
  /** The link's text; null when it has none, or only whitespace. */
  anchor: string | null;
}

/** What a link with no text shows in its place. */
export const NO_LINK_TEXT = '(no link text)';

export interface ErrorRowView extends PageRef {
  status: number;
  /** The record's URLs that redirect here, as shown; empty when the page was requested directly. */
  via: string[];
  /** The path, then "(redirected from /a, /b)" when it was reached by a redirect: one cell. */
  pageText: string;
  /**
   * The links in the record that lead to one of this row's URLs, with their text, in the record's
   * order. A link from one of those URLs is left out. A link's page may be one the record does not
   * hold (where a redirect landed), so this is what the record read, not a census of the site.
   */
  linkedFrom: LinkingPage[];
  /** "/blog/a, /pricing and 1 more": the first two linking pages, and how many more. */
  linkedSummary: string;
  /** The linking pages, comma-separated, as the PDF lists them. */
  linkedAll: string;
}

export interface RedirectRowView extends PageRef {
  /** "301 → /b → 302 → /c" */
  hops: string;
  /**
   * Where the chain ends, with that response's status; null for a loop, and for a chain whose last
   * response is a redirect (NOT_FOLLOWED).
   */
  endsAt: { path: string; status: number } | null;
  loop: boolean;
  /** "/c (200)", "LOOP", or NOT_FOLLOWED: the end as one cell, as the PDF prints it. */
  endsText: string;
}

/**
 * The "Ends at" cell of a chain whose last response is a redirect, not a loop. The worker
 * (packages/worker/src/batch/polite-fetch.ts `followChain`) records such a chain in two shapes the
 * record cannot tell apart: one it stopped (too many hops, off the
 * site, onto another port, into a path robots.txt disallows, the batch stopping), where `final_url`
 * is a Location it did not request and `status_code` is the 3xx of the hop before; and one whose last
 * redirect named no Location it could follow, where `final_url` was requested and the 3xx is its
 * own. PageResult keeps no stop reason (packages/types/src/v2/page-result.ts). So the cell names no
 * URL, no status and no reason.
 */
export const NOT_FOLLOWED = 'not followed to the end';

export interface SharedGroupView {
  text: string;
  /** "“Guide” · 3 pages" */
  line: string;
  pages: ShortList<PageRef>;
  pageCount: number;
}

export interface BasicsColumnView {
  heading: string;
  /** One line: the missing count, that none is missing, or that none was read. */
  missingLine: string;
  missing: ShortList<PageRef>;
  /** One line: how many texts are shared, by how many pages, that none is, or that none was read. */
  sharedLine: string;
  shared: ShortList<SharedGroupView>;
}

export interface LinksCounts {
  /** Pages in the record. */
  checked: number;
  /** Pages that answered 200: the pages whose titles and descriptions are looked for. */
  served: number;
  /** Missing pages (segment/broken.ts), by URL, that a link the record holds leads to. */
  broken: number;
  /** Distinct pages whose link in the record leads to one of those, a page's link to itself left out. */
  brokenLinkedFrom: number;
  /** Missing pages, by URL, the record links to from 0 pages. */
  missingUnlinked: number;
  /** URLs that answered an error of 400 or more other than a missing one. */
  errors: number;
  redirects: number;
  loops: number;
  /** Pages whose redirects were recorded (`redirect` not null), whether or not they redirect. */
  redirectsRecorded: number;
  /** Of the pages that answered 200, those whose title was read. */
  titlesRead: number;
  /** Pages that answered 200, whose title was read, and that declare none, or one of whitespace alone. */
  missingTitles: number;
  sharedTitlePages: number;
  /** Titles kept cut short, left out of the shared groups. */
  cutTitles: number;
  /** Of the pages that answered 200, those whose meta description was read. */
  descriptionsRead: number;
  /**
   * Pages that answered 200, whose meta description was read, and that declare none, or one of
   * whitespace alone.
   */
  missingDescriptions: number;
  sharedDescriptionPages: number;
  cutDescriptions: number;
}

export const HEADINGS_LINE = 'Headings are not checked yet.';
/** The empty state of each table when the record holds no page. */
export const NOT_MEASURED_LINE = 'Not measured: this check recorded no page.';
export const ERRORS_HEADING = 'Pages that answered an error';
/** The heading of the missing pages the record links to from 0 pages. */
export const UNLINKED_HEADING = 'Missing pages found';
/** A row's "Linked from" cell when the record holds no link to it: a count, never a claim of none. */
export const LINKED_FROM_NONE = '0 pages in this check’s record';
/** The column that names the URL a redirect chain starts from. */
export const REQUESTED_AS = 'Requested as';

/** Text made of whitespace alone, Unicode's spaces and the zero-width ones included. */
export const isBlank = (text: string | null): boolean =>
  text === null || /^[\s\p{Z}\u200b-\u200d\u2060\ufeff]*$/u.test(text);

/** A path on the site's own host; any other host keeps its whole URL. */
function shortUrl(url: string, host: string): string {
  const u = new URL(url);
  return u.host === host ? `${u.pathname}${u.search}` : url;
}

const pagesWord = (n: number) => `${count(n)} ${plural(n, 'page', 'pages')}`;

/** One of a page's head texts, read off the record: the object (null: not read) and its text. */
interface HeadField {
  head: (p: PageResult) => PageResult['title'];
  text: (p: PageResult) => string | null;
  /** The UTF-8 bytes the record keeps of it. */
  bytes: number;
  noun: [string, string];
}

const TITLE_FIELD: HeadField = {
  head: (p) => p.title,
  text: PAGE_CELLS.title,
  bytes: TITLE_BYTES,
  noun: ['title', 'titles'],
};
const DESCRIPTION_FIELD: HeadField = {
  head: (p) => p.meta_description,
  text: PAGE_CELLS.meta_description,
  bytes: DESCRIPTION_BYTES,
  noun: ['description', 'descriptions'],
};

interface ColumnFacts {
  view: BasicsColumnView;
  read: PageResult[];
  notRead: PageResult[];
  missing: number;
  sharedPages: number;
  cut: number;
}

function column(
  heading: string,
  field: HeadField,
  served: readonly PageResult[],
  ref: (p: PageResult) => PageRef,
): ColumnFacts {
  const read = served.filter((p) => field.head(p) !== null);
  const notRead = served.filter((p) => field.head(p) === null);
  const missing = read.filter((p) => isBlank(field.text(p)));
  // A text kept cut short is its first bytes only: two pages sharing those bytes may differ after
  // them, so a cut text is left out of the shared groups (and counted apart), never keyed on.
  const whole = read.filter((p) => !isBlank(field.text(p)) && !field.head(p)!.cut);
  const cut = read.filter((p) => !isBlank(field.text(p)) && field.head(p)!.cut).length;
  const by = new Map<string, PageResult[]>();
  for (const p of whole) {
    const text = field.text(p)!;
    by.set(text, [...(by.get(text) ?? []), p]);
  }
  const shared = [...by.entries()]
    .filter(([, ps]) => ps.length > 1)
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const sharedPages = shared.reduce((n, [, ps]) => n + ps.length, 0);
  const [one, many] = field.noun;

  const missingLine = !served.length
    ? 'Missing: not read, as no page answered 200'
    : !read.length
      ? `Missing: not read on the ${pagesWord(served.length)} that answered 200`
      : `Missing: ${missing.length ? pagesWord(missing.length) : 'none'}${
          notRead.length
            ? ` of the ${count(read.length)} read; not read on ${pagesWord(notRead.length)}`
            : ''
        }`;
  const cutNote = cut
    ? `; ${count(cut)} ${plural(cut, one, many)} cut short at ${count(field.bytes)} bytes, not compared`
    : '';
  const sharedLine =
    !served.length || !read.length
      ? 'Shared by more than one page: not read'
      : `Shared by more than one page: ${
          shared.length
            ? `${count(shared.length)} ${plural(shared.length, one, many)}, ${count(sharedPages)} pages`
            : 'none'
        }${cutNote}`;
  return {
    read,
    notRead,
    missing: missing.length,
    sharedPages,
    cut,
    view: {
      heading,
      missingLine,
      missing: shortList(missing.map(ref)),
      sharedLine,
      shared: shortList(
        shared.map(([text, ps]) => ({
          text,
          line: `“${text}” · ${count(ps.length)} pages`,
          pages: shortList(ps.map(ref)),
          pageCount: ps.length,
        })),
      ),
    },
  };
}

/**
 * A URL as the engine spells a link's ends (packages/engine/src/url-canonical.ts `canonicalizeUrl`,
 * with no options): the host in lower case, no fragment, the query's pairs sorted, runs of slashes
 * in the path made one, and no slash at the end of the path, the origin's included. Kept here
 * because that module reads node:crypto, which a screen built on these views cannot load;
 * __tests__/v2/links-sentences.property.test.tsx holds the two equal over a list of URLs.
 */
export function linkSpelling(input: string): string {
  const u = new URL(input);
  u.hash = '';
  if (u.search) {
    const pairs = [...u.searchParams.entries()].sort((x, y) =>
      x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0,
    );
    u.search = '';
    for (const [k, v] of pairs) u.searchParams.append(k, v);
  }
  let pathname = u.pathname.replace(/\/{2,}/g, '/');
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.replace(/\/$/, '');
  u.pathname = pathname;
  return `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname}${u.search}`;
}

/** `linkSpelling`, or the URL as given when it does not parse. */
function spell(u: string): string {
  try {
    return linkSpelling(u);
  } catch {
    return u;
  }
}

/**
 * The pages that answered 200 as HTML with more distinct links (`links_out`) than the record holds
 * from them; a page whose reader stopped (`links_read` false) counts only by that test. The worker
 * records a page's links from the URL its request ended at, in the engine's spelling, and counts in
 * `links_out` each distinct link to another URL, a link to the page itself left out; the links held
 * are counted the same way here.
 */
export function linksNotAllHeld(
  pages: readonly PageResult[],
  edges: readonly LinkEdge[],
): PageResult[] {
  const held = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.from_url === e.to_url) continue;
    const to = held.get(e.from_url) ?? new Set<string>();
    to.add(e.to_url);
    held.set(e.from_url, to);
  }
  return pages.filter((p) => {
    if (PAGE_CELLS.status_code(p) !== 200 || !p.is_html) return false;
    // `links_out` is the page's count when its reader finished (`links_read`). When the reader
    // stopped, it is the links found before it did: a floor, not a count. A floor above the links
    // held still shows a link missing from the record, so it is tested the same way below. A reader
    // that stopped having found none shows nothing: its stopping alone shows no missing link.
    if (!p.links_read && p.links_out === 0) return false;
    const from = new Set([p.url, spell(p.url)]);
    if (p.final_url !== null) [p.final_url, spell(p.final_url)].forEach((u) => from.add(u));
    const to = new Set([...from].flatMap((u) => [...(held.get(u) ?? [])]));
    return p.links_out > to.size;
  });
}

/** The distinct statuses of `rows`, lowest first. */
const statusesOf = (rows: readonly ErrorRowView[]) =>
  [...new Set(rows.map((r) => r.status))].sort((a, b) => a - b);

/**
 * Why no link can be named: `unread`, the check read no internal link (its structure section is not
 * measured and no page counts a link); `unrecorded`, the record holds none, though the check counted
 * some. Null when the record holds links.
 */
export type LinkGap = 'unread' | 'unrecorded' | null;

export interface LinksFacts {
  counts: LinksCounts;
  /** Why no link can be named: the check read none (`unread`), or its record holds none. */
  linkGap: LinkGap;
  /** The rows of the missing pages a link in the record leads to: the broken links. */
  broken: ErrorRowView[];
  /** The rows of the missing pages the record links to from 0 pages. */
  unlinked: ErrorRowView[];
  /** Their heading: "Missing pages found". */
  unlinkedHeading: string;
  /**
   * Pages that answered another error (a 403, a 429, a 503): each answered an error other than 404
   * or 410, which does not tell whether it exists.
   */
  errors: ErrorRowView[];
  redirects: RedirectRowView[];
  titles: BasicsColumnView;
  descriptions: BasicsColumnView;
  /** The door's sentence, built from the counts. */
  body: string;
  /** The screen's and the PDF's: the body without the sentence the broken table's empty state says. */
  screenBody: string;
  /** What the broken links table says when it has no row; null when it has one. */
  brokenEmpty: string | null;
  /** What the redirects table says when it has no row; null when it has one. */
  redirectsEmpty: string | null;
  /** The door's pill and the Links and pages tab's figure. */
  pill: DoorView['pill'];
  coverage: string;
}

/** What the record of a check says about its links and page basics: the door's, screen's and PDF's. */
export function linksFacts(d: ViewDataset, check: Check): LinksFacts {
  const host = siteOf(d, check).host;
  const pages = d.page_results.filter((p) => p.check_id === check.id);
  const edges: LinkEdge[] = d.link_edges.filter((e) => e.check_id === check.id);
  const path = (url: string) => shortUrl(url, host);
  const ref = (p: PageResult): PageRef => ({ url: p.url, path: path(p.url) });
  // No link read: the structure section read nothing and no page counts a link. An HTML page's
  // `links_out` is its links when they were all read (`links_read`), and the links found before
  // reading stopped when not: above 0, links were read, and a record holding none did not record them.
  const countsALink = (p: PageResult) => (p.links_read || p.is_html) && p.links_out > 0;
  const linkGap: LinkGap =
    edges.length > 0
      ? null
      : !sectionMeasured(check, 'structure') && !pages.some(countsALink)
        ? 'unread'
        : 'unrecorded';

  // One row per URL where pages answered an error and status (segment/broken.ts `errorRows`): a page
  // reached by a redirect is shown at its final URL, a final URL the record also holds with the same
  // status is one row, and a second status at that URL is a row of its own.
  const rowOf = ({ at, status, members }: ErrorRow): ErrorRowView => {
    // The worker stores a link's target in `linkSpelling`, while `at` is the final URL as served
    // (`/gone/` against a stored `/gone`): both sides are compared in that spelling.
    const asked = new Set([at, ...members.map((p) => p.url)].flatMap((u) => [u, spell(u)]));
    const via = members.filter((p) => p.url !== at).map((p) => path(p.url));
    const into = edges.filter(
      (e) => asked.has(spell(e.to_url)) && !asked.has(spell(e.from_url)) && e.from_url !== e.to_url,
    );
    // Two linking URLs that shorten to one path (`http://host/a`, `https://host/a`) are two pages
    // to the count: each is then shown whole, so the cell lists what the count counts.
    const fromUrls = [...new Set(into.map((e) => e.from_url))];
    const clash = new Set(fromUrls.map(path)).size < fromUrls.length;
    const linkedFrom = into.map((e) => ({
      url: e.from_url,
      path: clash ? e.from_url : path(e.from_url),
      anchor: isBlank(e.anchor_text) ? null : e.anchor_text,
    }));
    const froms = [...new Set(linkedFrom.map((l) => l.path))];
    const none = LINKED_FROM_NONE;
    return {
      url: at,
      path: path(at),
      status,
      via,
      pageText: via.length ? `${path(at)} (redirected from ${via.join(', ')})` : path(at),
      linkedFrom,
      linkedAll: froms.length ? froms.join(', ') : none,
      linkedSummary: froms.length
        ? `${froms.filter((_, i) => i < 2).join(', ')}${froms.length > 2 ? ` and ${count(froms.length - 2)} more` : ''}`
        : none,
    };
  };
  const rows = errorRows(pages).map((r) => ({ missing: r.missing, row: rowOf(r) }));
  // A missing page is linked when a link the record holds leads to one of its rows; all of its rows
  // are listed with it, so one page is never in both tables.
  const linkedAt = new Set(
    rows.filter((r) => r.missing && r.row.linkedFrom.length).map((r) => r.row.url),
  );
  const broken = rows.filter((r) => r.missing && linkedAt.has(r.row.url)).map((r) => r.row);
  const unlinked = rows.filter((r) => r.missing && !linkedAt.has(r.row.url)).map((r) => r.row);
  const errors = rows.filter((r) => !r.missing).map((r) => r.row);
  /** The distinct URLs of `rs`: a count of pages, however many statuses each answered. */
  const urlsOf = (rs: readonly ErrorRowView[]) => new Set(rs.map((r) => r.url)).size;
  const brokenLinkedFrom = new Set(broken.flatMap((r) => r.linkedFrom.map((l) => l.url))).size;

  const recorded = pages.filter((p) => p.redirect !== null);
  const redirects: RedirectRowView[] = pages.filter(redirected).map((p) => {
    const chain = p.redirect!;
    const finalUrl = PAGE_CELLS.final_url(p);
    const status = PAGE_CELLS.status_code(p);
    // The last response is a redirect: the chain was not followed to a page that answered.
    const notFollowed = !chain.loop && REDIRECT_STATUSES.includes(status);
    // Two URLs of the chain that shorten to one path (`http://host/a` to `https://host/a`) would
    // read as a redirect to itself: the row then shows each URL whole.
    const urls = [
      p.url,
      ...chain.hops.flatMap((h) => [h.from, ...(h.location === null ? [] : [h.location])]),
      ...(finalUrl === null ? [] : [finalUrl]),
    ];
    const clash = new Set(urls.map(path)).size < new Set(urls).size;
    const show = (u: string) => (clash ? u : path(u));
    const endsAt =
      chain.loop || notFollowed || finalUrl === null ? null : { path: show(finalUrl), status };
    return {
      url: p.url,
      path: show(p.url),
      hops: chain.hops
        .map(
          (h) =>
            `${h.status} → ${h.location === null ? 'a URL too long to keep' : show(h.location)}`,
        )
        .join(' → '),
      endsAt,
      loop: chain.loop,
      endsText: chain.loop
        ? 'LOOP'
        : notFollowed
          ? NOT_FOLLOWED
          : endsAt === null
            ? 'not recorded'
            : `${endsAt.path} (${endsAt.status})`,
    };
  });

  // The pages that answered 200, one per page that answered: rows whose requests landed at one URL
  // (`/old` redirected to `/new`, `http://` to `https://`) are one page, keyed on where it answered
  // in the worker's spelling. Its title and description are read off the row requested at that URL
  // when the record holds one, else off the first of its rows.
  const served = (() => {
    const by = new Map<string, PageResult>();
    for (const p of pages.filter((x) => PAGE_CELLS.status_code(x) === 200)) {
      const key = spell(answeredAt(p));
      const own = (x: PageResult) => !redirected(x) && spell(x.url) === key;
      const held = by.get(key);
      if (!held || (!own(held) && own(p))) by.set(key, p);
    }
    return [...by.values()];
  })();
  const titles = column('Titles', TITLE_FIELD, served, ref);
  const descriptions = column('Meta descriptions', DESCRIPTION_FIELD, served, ref);

  const counts: LinksCounts = {
    checked: pages.length,
    served: served.length,
    broken: urlsOf(broken),
    brokenLinkedFrom,
    missingUnlinked: urlsOf(unlinked),
    errors: urlsOf(errors),
    redirects: redirects.length,
    loops: redirects.filter((r) => r.loop).length,
    redirectsRecorded: recorded.length,
    titlesRead: titles.read.length,
    missingTitles: titles.missing,
    sharedTitlePages: titles.sharedPages,
    cutTitles: titles.cut,
    descriptionsRead: descriptions.read.length,
    missingDescriptions: descriptions.missing,
    sharedDescriptionPages: descriptions.sharedPages,
    cutDescriptions: descriptions.cut,
  };

  const checked = pages.length;
  const crawled = check.coverage?.pages_crawled ?? null;
  const coverage =
    crawled !== null && crawled > checked
      ? `Checked ${count(checked)} of the ${pagesWord(crawled)} crawled`
      : `Checked ${pagesWord(checked)}`;
  const unlinkedHeading = UNLINKED_HEADING;

  if (checked === 0) {
    return {
      counts,
      linkGap,
      broken,
      unlinked,
      unlinkedHeading,
      errors,
      redirects,
      titles: titles.view,
      descriptions: descriptions.view,
      body: 'This check recorded no page.',
      screenBody: 'This check recorded no page.',
      brokenEmpty: NOT_MEASURED_LINE,
      redirectsEmpty: NOT_MEASURED_LINE,
      pill: { state: 'neutral', label: 'not measured' },
      coverage,
    };
  }

  // Each clause below is built from the rows it names, so it says only what they hold. A count of
  // missing pages is a count of pages (URLs), never of links or rows; and what a link leads to is
  // said of the links the record holds, never of the site's.
  const missingPages = (n: number) => `${count(n)} missing ${plural(n, 'page', 'pages')}`;
  const nBroken = counts.broken;
  const nUnlinked = counts.missingUnlinked;
  const nErrors = counts.errors;
  const linkedFromRecord = `linked from ${pagesWord(brokenLinkedFrom)}`;
  const brokenSentence = nBroken
    ? `${missingPages(nBroken)}, ${linkedFromRecord} in this check’s record, answering ${statusesOf(broken).join(' or ')}.`
    : null;
  const unlinkedSentence = nUnlinked
    ? `${missingPages(nUnlinked)}, linked from 0 pages in this check’s record, answering ${statusesOf(unlinked).join(' or ')}.`
    : null;
  // The record holds only some of the links: say how, from the record. A `withheld` total is said
  // when the record holds links; the pages whose links it does not hold in full, whenever there are.
  const heldLinks = d.withheld.find(
    (w) => w.check_id === check.id && w.collection === 'link_edges',
  );
  const notAllHeld = linksNotAllHeld(pages, edges).length;
  const partLinks = [
    heldLinks && linkGap === null
      ? `the record holds ${count(heldLinks.included)} of the ${count(heldLinks.total)} links found`
      : null,
    notAllHeld ? `the links of ${pagesWord(notAllHeld)} are not all in this check’s record` : null,
  ].filter((x): x is string => x !== null);
  const partLinksSentence = partLinks.length ? `${capitalise(partLinks.join('; '))}.` : null;
  const errorSentence = nErrors
    ? `${pagesWord(nErrors)} answered an error (${statusesOf(errors).join(', ')}).`
    : null;
  const noneSentence =
    nBroken || nUnlinked || nErrors
      ? null
      : checked === 1
        ? 'The page we checked answers no error.'
        : `None of the ${count(checked)} pages we checked answers an error.`;
  const redirectSentence = redirects.length
    ? `${pagesWord(redirects.length)} ${plural(redirects.length, 'redirects', 'redirect')}${counts.loops ? `, ${count(counts.loops)} in a loop` : ''}.`
    : null;

  // Pages that answered 200 whose title or description was not read, said apart from the missing.
  const notReadClause = (() => {
    const t = titles.notRead;
    const m = descriptions.notRead;
    const same = t.length === m.length && t.every((p) => m.includes(p));
    if (same && t.length)
      return t.length === 1
        ? 'the title and meta description of 1 page that answered 200 were not read'
        : `the titles and meta descriptions of ${pagesWord(t.length)} that answered 200 were not read`;
    return [
      t.length
        ? t.length === 1
          ? 'the title of 1 page that answered 200 was not read'
          : `the titles of ${pagesWord(t.length)} that answered 200 were not read`
        : null,
      m.length
        ? m.length === 1
          ? 'the meta description of 1 page that answered 200 was not read'
          : `the meta descriptions of ${pagesWord(m.length)} that answered 200 were not read`
        : null,
    ]
      .filter((s): s is string => s !== null)
      .join('; ');
  })();
  const cutClause = (n: number, noun: [string, string], bytes: number) =>
    n
      ? `${count(n)} ${plural(n, noun[0], noun[1])} cut short at ${count(bytes)} bytes ${plural(n, 'was', 'were')} not compared with the others`
      : null;
  const basics = [
    counts.missingDescriptions
      ? `${pagesWord(counts.missingDescriptions)} ${plural(counts.missingDescriptions, 'has', 'have')} no meta description`
      : null,
    counts.missingTitles
      ? `${pagesWord(counts.missingTitles)} ${plural(counts.missingTitles, 'has', 'have')} no title`
      : null,
    counts.sharedTitlePages
      ? `${pagesWord(counts.sharedTitlePages)} share a title with another`
      : null,
    counts.sharedDescriptionPages
      ? `${pagesWord(counts.sharedDescriptionPages)} share a meta description with another`
      : null,
    notReadClause || null,
    cutClause(counts.cutTitles, TITLE_FIELD.noun, TITLE_BYTES),
    cutClause(counts.cutDescriptions, DESCRIPTION_FIELD.noun, DESCRIPTION_BYTES),
  ].filter((s): s is string => s !== null);
  const basicsSentence = !served.length
    ? 'No page answered 200, so no title or meta description was read.'
    : !titles.read.length && !descriptions.read.length
      ? `No title or meta description was read on the ${pagesWord(served.length)} that answered 200.`
      : basics.length
        ? `${capitalise(basics.join('; '))}.`
        : served.length === 1
          ? 'The page that answered 200 has a title and a meta description.'
          : `Each of the ${pagesWord(served.length)} that answered 200 has its own title and meta description.`;
  const sentences = (none: string | null) =>
    [
      brokenSentence,
      unlinkedSentence,
      partLinksSentence,
      errorSentence,
      none,
      redirectSentence,
      basicsSentence,
    ]
      .filter(Boolean)
      .join(' ');

  const notRecorded = recorded.length < checked;
  // What the record shows of the pages checked, by status: a 403, a 429 or a 503 does not tell
  // whether a page exists, so this says only that none answered 404 or 410.
  const noneMissing =
    checked === 1
      ? 'the page checked did not answer 404 or 410'
      : 'no page checked answered 404 or 410';
  const brokenEmpty = nBroken
    ? null
    : (noneSentence ??
      (nUnlinked
        ? nUnlinked === 1
          ? 'The missing page is linked from 0 pages in this check’s record.'
          : `Each of the ${missingPages(nUnlinked)} is linked from 0 pages in this check’s record.`
        : `${capitalise(noneMissing)}.`));
  return {
    counts,
    linkGap,
    broken,
    unlinked,
    unlinkedHeading,
    errors,
    redirects,
    titles: titles.view,
    descriptions: descriptions.view,
    body: sentences(noneSentence),
    // When the broken links table's empty state says the none sentence, the screen does not twice.
    screenBody: sentences(brokenEmpty === noneSentence ? null : noneSentence),
    brokenEmpty,
    redirectsEmpty: redirects.length
      ? null
      : !recorded.length
        ? 'Redirects were not recorded for the pages we checked.'
        : notRecorded
          ? recorded.length === 1
            ? 'The page whose redirects were recorded does not redirect.'
            : `None of the ${pagesWord(recorded.length)} whose redirects were recorded redirects.`
          : checked === 1
            ? 'The page we checked does not redirect.'
            : `None of the ${count(checked)} pages we checked redirects.`,
    // The pill is short enough for its box; the sentences above carry the scope it leaves out. It
    // counts every missing page, as the headline's "missing pages found" does, linked or not.
    pill:
      nBroken + nUnlinked
        ? { state: nBroken ? 'bad' : 'neutral', label: missingPages(nBroken + nUnlinked) }
        : { state: 'neutral', label: 'no 404 or 410' },
    coverage,
  };
}
