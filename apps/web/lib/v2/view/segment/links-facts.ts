/**
 * Links and pages (row 5) as data: the missing pages a link leads to and where they are linked
 * from, the missing pages no link leads to, the pages that answered another error, the pages that
 * redirect, and the titles and meta descriptions that are missing or shared. It reads the page and
 * link records of one check. A page's status, final URL, title and meta description are read
 * through the pages CSV's accessors (reports/csv.ts), so the screen, the CSV and the PDF read the
 * same values; its redirect chain, which the CSV has no column for, is read off `page.redirect`.
 * Which statuses are missing is segment/broken.ts's, which the link map reads too. Titles and
 * descriptions are counted over the pages that answered 200; missing means no text, or text made
 * of whitespace alone.
 */
import type { Check, LinkEdge, PageResult } from '@crawlmouse/types/v2';
import { siteOf } from '../../fixtures';
import { PAGE_CELLS } from '../../reports/csv';
import { capitalise, count, plural } from '../../words';
import { isMissing, isOtherError } from './broken';
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
   * The links in the record that lead here, with their text, in the record's order. A link from the
   * page itself is left out. A link's page may be one the record does not hold (where a redirect
   * landed), so this is what the record read, not a census of the site.
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
  /** Where the chain ends, with that response's status; null for a loop. */
  endsAt: { path: string; status: number } | null;
  loop: boolean;
  /** "/c (200)", or "LOOP": the end as one cell, as the PDF prints it. */
  endsText: string;
}

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
  /** Pages that answered 200: the pages whose titles and descriptions are read. */
  served: number;
  /** Missing pages (segment/broken.ts) at least one link in the record leads to. */
  broken: number;
  /** Distinct pages whose link leads to one of those, a page's link to itself left out. */
  brokenLinkedFrom: number;
  /** Missing pages no link in the record leads to (found by the sitemap, or the start URL). */
  missingUnlinked: number;
  /** Pages that answered an error of 400 or more other than a missing one. */
  errors: number;
  redirects: number;
  loops: number;
  missingTitles: number;
  sharedTitlePages: number;
  missingDescriptions: number;
  sharedDescriptionPages: number;
}

export const HEADINGS_LINE = 'Headings are not checked yet.';
/** The empty state of each table when the record holds no page. */
export const NOT_MEASURED_LINE = 'Not measured: this check recorded no page.';
export const ERRORS_HEADING = 'Pages that answered an error';
export const UNLINKED_HEADING = 'Missing pages no link leads to';

/** Text made of whitespace alone, Unicode's spaces and the zero-width ones included. */
export const isBlank = (text: string | null): boolean =>
  text === null || /^[\s\p{Z}​-‍⁠﻿]*$/u.test(text);

/** A path on the site's own host; any other host keeps its whole URL. */
function shortUrl(url: string, host: string): string {
  const u = new URL(url);
  return u.host === host ? `${u.pathname}${u.search}` : url;
}

/** The pages that answered 200, grouped by the text `read` gives, in first-seen (URL) order. */
function groupsOf(
  served: readonly PageResult[],
  read: (p: PageResult) => string | null,
): { missing: PageResult[]; shared: [string, PageResult[]][] } {
  const missing: PageResult[] = [];
  const by = new Map<string, PageResult[]>();
  for (const p of served) {
    const text = read(p);
    if (text === null || isBlank(text)) {
      missing.push(p);
      continue;
    }
    by.set(text, [...(by.get(text) ?? []), p]);
  }
  const shared = [...by.entries()]
    .filter(([, ps]) => ps.length > 1)
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { missing, shared };
}

function column(
  heading: string,
  noun: [string, string],
  served: readonly PageResult[],
  read: (p: PageResult) => string | null,
  ref: (p: PageResult) => PageRef,
): { view: BasicsColumnView; missing: number; sharedPages: number } {
  const { missing, shared } = groupsOf(served, read);
  const sharedPages = shared.reduce((n, [, ps]) => n + ps.length, 0);
  const none = served.length === 0;
  return {
    missing: missing.length,
    sharedPages,
    view: {
      heading,
      missingLine: none
        ? 'Missing: not read, as no page answered 200'
        : missing.length
          ? `Missing: ${count(missing.length)} ${plural(missing.length, 'page', 'pages')}`
          : 'Missing: none',
      missing: shortList(missing.map(ref)),
      sharedLine: none
        ? 'Shared by more than one page: not read'
        : shared.length
          ? `Shared by more than one page: ${count(shared.length)} ${plural(shared.length, noun[0], noun[1])}, ${count(sharedPages)} pages`
          : 'Shared by more than one page: none',
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

/** The distinct statuses of `rows`, lowest first. */
const statusesOf = (rows: readonly ErrorRowView[]) =>
  [...new Set(rows.map((r) => r.status))].sort((a, b) => a - b);

export interface LinksFacts {
  counts: LinksCounts;
  /** Missing pages a link leads to: the broken links. */
  broken: ErrorRowView[];
  /** Missing pages no link in the record leads to. */
  unlinked: ErrorRowView[];
  /** Pages that answered another error (a 403, a 429, a 503): they exist, so are not broken. */
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
  const hopsOf = (p: PageResult) => p.redirect?.hops ?? [];

  // A page that answered an error, grouped by where it answered: a page reached by a redirect is
  // shown at its final URL, and a final URL the record also holds as a page is one row, not two.
  const groups = new Map<string, PageResult[]>();
  for (const p of pages.filter((x) => isMissing(x) || isOtherError(x))) {
    const finalUrl = hopsOf(p).length ? PAGE_CELLS.final_url(p) : null;
    const at = finalUrl ?? p.url;
    groups.set(at, [...(groups.get(at) ?? []), p]);
  }
  const rowOf = (at: string, members: PageResult[]): ErrorRowView => {
    const asked = new Set([at, ...members.map((p) => p.url)]);
    const via = members.filter((p) => p.url !== at).map((p) => path(p.url));
    const into = edges.filter(
      (e) => asked.has(e.to_url) && e.from_url !== e.to_url && e.from_url !== at,
    );
    const linkedFrom = into.map((e) => ({
      url: e.from_url,
      path: path(e.from_url),
      anchor: isBlank(e.anchor_text) ? null : e.anchor_text,
    }));
    const froms = [...new Set(linkedFrom.map((l) => l.path))];
    return {
      url: at,
      path: path(at),
      status: PAGE_CELLS.status_code(members[0]!),
      via,
      pageText: via.length ? `${path(at)} (redirected from ${via.join(', ')})` : path(at),
      linkedFrom,
      linkedAll: froms.length ? froms.join(', ') : 'no link in the record',
      linkedSummary: froms.length
        ? `${froms.filter((_, i) => i < 2).join(', ')}${froms.length > 2 ? ` and ${count(froms.length - 2)} more` : ''}`
        : 'no link in the record',
    };
  };
  const rows = [...groups.entries()].map(([at, members]) => ({
    missing: isMissing(members[0]!),
    row: rowOf(at, members),
  }));
  const broken = rows.filter((r) => r.missing && r.row.linkedFrom.length).map((r) => r.row);
  const unlinked = rows.filter((r) => r.missing && !r.row.linkedFrom.length).map((r) => r.row);
  const errors = rows.filter((r) => !r.missing).map((r) => r.row);
  const brokenLinkedFrom = new Set(broken.flatMap((r) => r.linkedFrom.map((l) => l.url))).size;

  const redirects: RedirectRowView[] = pages
    .filter((p) => hopsOf(p).length > 0)
    .map((p) => {
      const chain = p.redirect!;
      const finalUrl = PAGE_CELLS.final_url(p);
      const endsAt =
        chain.loop || finalUrl === null
          ? null
          : { path: path(finalUrl), status: PAGE_CELLS.status_code(p) };
      return {
        ...ref(p),
        hops: chain.hops
          .map(
            (h) =>
              `${h.status} → ${h.location === null ? 'a URL too long to keep' : path(h.location)}`,
          )
          .join(' → '),
        endsAt,
        loop: chain.loop,
        endsText: chain.loop
          ? 'LOOP'
          : endsAt === null
            ? 'not recorded'
            : `${endsAt.path} (${endsAt.status})`,
      };
    });

  const served = pages.filter((p) => PAGE_CELLS.status_code(p) === 200);
  const titles = column('Titles', ['title', 'titles'], served, PAGE_CELLS.title, ref);
  const descriptions = column(
    'Meta descriptions',
    ['description', 'descriptions'],
    served,
    PAGE_CELLS.meta_description,
    ref,
  );

  const counts: LinksCounts = {
    checked: pages.length,
    served: served.length,
    broken: broken.length,
    brokenLinkedFrom,
    missingUnlinked: unlinked.length,
    errors: errors.length,
    redirects: redirects.length,
    loops: redirects.filter((r) => r.loop).length,
    missingTitles: titles.missing,
    sharedTitlePages: titles.sharedPages,
    missingDescriptions: descriptions.missing,
    sharedDescriptionPages: descriptions.sharedPages,
  };

  const pagesWord = (n: number) => `${count(n)} ${plural(n, 'page', 'pages')}`;
  const checked = pages.length;
  const crawled = check.coverage?.pages_crawled ?? null;
  const coverage =
    crawled !== null && crawled > checked
      ? `Checked ${count(checked)} of the ${count(crawled)} pages crawled`
      : `Checked ${pagesWord(checked)}`;

  if (checked === 0) {
    return {
      counts,
      broken,
      unlinked,
      errors,
      redirects,
      titles: titles.view,
      descriptions: descriptions.view,
      body: 'This check recorded no page, so no link, redirect, title or meta description was read.',
      screenBody:
        'This check recorded no page, so no link, redirect, title or meta description was read.',
      brokenEmpty: NOT_MEASURED_LINE,
      redirectsEmpty: NOT_MEASURED_LINE,
      pill: { state: 'neutral', label: 'not measured' },
      coverage,
    };
  }

  // Each clause below is built from the rows it names, so it says only what they hold.
  const brokenSentence = broken.length
    ? `${count(broken.length)} broken ${plural(broken.length, 'link', 'links')}: ${broken.length === 1 ? 'a page' : 'pages'} answering ${statusesOf(broken).join(' or ')}, linked from ${pagesWord(brokenLinkedFrom)}.`
    : null;
  const unlinkedSentence = unlinked.length
    ? `No link we read leads to ${count(unlinked.length)} missing ${plural(unlinked.length, 'page', 'pages')}, answering ${statusesOf(unlinked).join(' or ')}.`
    : null;
  const errorSentence = errors.length
    ? `${pagesWord(errors.length)} answered an error (${statusesOf(errors).join(', ')}).`
    : null;
  const noneSentence =
    broken.length || unlinked.length || errors.length
      ? null
      : checked === 1
        ? 'The page we checked answers no error.'
        : `None of the ${count(checked)} pages we checked answers an error.`;
  const redirectSentence = redirects.length
    ? `${pagesWord(redirects.length)} ${plural(redirects.length, 'redirects', 'redirect')}${counts.loops ? `, ${count(counts.loops)} in a loop` : ''}.`
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
  ].filter((s): s is string => s !== null);
  const basicsSentence = !served.length
    ? 'No page answered 200, so no title or meta description was read.'
    : basics.length
      ? `${capitalise(basics.join('; '))}.`
      : served.length === 1
        ? 'The page that answered 200 has a title and a meta description.'
        : `Each of the ${pagesWord(served.length)} that answered 200 has its own title and meta description.`;
  const sentences = (none: string | null) =>
    [brokenSentence, unlinkedSentence, errorSentence, none, redirectSentence, basicsSentence]
      .filter(Boolean)
      .join(' ');

  const partial = crawled !== null && crawled > checked;
  return {
    counts,
    broken,
    unlinked,
    errors,
    redirects,
    titles: titles.view,
    descriptions: descriptions.view,
    body: sentences(noneSentence),
    // The broken links table's empty state says the none sentence, so the screen does not twice.
    screenBody: sentences(null),
    brokenEmpty: broken.length
      ? null
      : (noneSentence ?? 'No link we read leads to a missing page.'),
    redirectsEmpty: redirects.length
      ? null
      : checked === 1
        ? 'The page we checked does not redirect.'
        : `None of the ${count(checked)} pages we checked redirects.`,
    pill: broken.length
      ? {
          state: 'bad',
          label: `${count(broken.length)} broken ${plural(broken.length, 'link', 'links')}`,
        }
      : {
          state: 'neutral',
          label: partial ? `no broken link in ${pagesWord(checked)} checked` : 'no broken link',
        },
    coverage,
  };
}
