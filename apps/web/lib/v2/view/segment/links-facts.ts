/**
 * Links and pages (row 5) as data: the missing pages a link from another page leads to and where
 * they are linked from, the missing pages no other page links to, the pages that answered another
 * error, the pages that redirect, and the titles and meta descriptions that are missing or shared. It
 * reads the page and link records of one check. A page's status, final URL, title and meta
 * description are read through the pages CSV's accessors (reports/csv.ts), so the screen, the CSV
 * and the PDF read the same values; its redirect chain, which the CSV has no column for, is read off
 * `page.redirect`. Which statuses are missing, and where a redirected page answered, is
 * segment/broken.ts's, which the link map reads too.
 *
 * Titles and descriptions are read over the pages that answered 200, in three kinds: not read (the
 * page's `title` or `meta_description` is null: a non-HTML page, or one read in part), missing (read,
 * and the page declares none, or text made of whitespace alone), and present. A page not read is
 * never counted missing; it is counted apart, and named where the counts are.
 */
import type { Check, LinkEdge, PageResult } from '@crawlmouse/types/v2';
import { DESCRIPTION_BYTES, TITLE_BYTES } from '@crawlmouse/types/v2';
import { siteOf } from '../../fixtures';
import { PAGE_CELLS } from '../../reports/csv';
import { capitalise, count, plural } from '../../words';
import { sectionMeasured } from '../section-measured';
import { errorGroups, isMissing, redirected } from './broken';
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
  /** Pages that answered 200: the pages whose titles and descriptions are looked for. */
  served: number;
  /** Missing pages (segment/broken.ts) at least one link from another page leads to. */
  broken: number;
  /** Distinct pages whose link leads to one of those, a page's link to itself left out. */
  brokenLinkedFrom: number;
  /** Missing pages no link from another page in the record leads to. */
  missingUnlinked: number;
  /** Pages that answered an error of 400 or more other than a missing one. */
  errors: number;
  redirects: number;
  loops: number;
  /** Pages whose redirects were recorded (`redirect` not null), whether or not they redirect. */
  redirectsRecorded: number;
  /** Of the pages that answered 200, those whose title was read. */
  titlesRead: number;
  /** Of those, the ones that declare no title, or one of whitespace alone. */
  missingTitles: number;
  sharedTitlePages: number;
  /** Titles kept cut short, left out of the shared groups. */
  cutTitles: number;
  descriptionsRead: number;
  missingDescriptions: number;
  sharedDescriptionPages: number;
  cutDescriptions: number;
}

export const HEADINGS_LINE = 'Headings are not checked yet.';
/** The empty state of each table when the record holds no page. */
export const NOT_MEASURED_LINE = 'Not measured: this check recorded no page.';
export const ERRORS_HEADING = 'Pages that answered an error';
/** The heading of the missing pages no other page links to, when links were read. */
export const UNLINKED_HEADING = 'Missing pages no other page links to';
/** Its heading when no link was read or recorded: whether a page links to them is not known. */
export const UNLINKED_UNKNOWN_HEADING = 'Missing pages';
/** The column that names the URL a redirect chain starts from. */
export const REQUESTED_AS = 'Requested as';

/** Text made of whitespace alone, Unicode's spaces and the zero-width ones included. */
export const isBlank = (text: string | null): boolean =>
  text === null || /^[\s\p{Z}​-‍⁠﻿]*$/u.test(text);

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

/** The distinct statuses of `rows`, lowest first. */
const statusesOf = (rows: readonly ErrorRowView[]) =>
  [...new Set(rows.map((r) => r.status))].sort((a, b) => a - b);

/**
 * Why no link can be named: `unread`, the check read no internal link (its structure section is not
 * measured); `unrecorded`, it read some but its record holds none. Null when the record holds links.
 */
export type LinkGap = 'unread' | 'unrecorded' | null;

export interface LinksFacts {
  counts: LinksCounts;
  linkGap: LinkGap;
  /** Missing pages a link from another page leads to: the broken links. */
  broken: ErrorRowView[];
  /** Missing pages no link from another page in the record leads to. */
  unlinked: ErrorRowView[];
  /** Its heading, which says "no other page links to" only when links were read. */
  unlinkedHeading: string;
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
  const linkGap: LinkGap = !sectionMeasured(check, 'structure')
    ? 'unread'
    : edges.length === 0
      ? 'unrecorded'
      : null;
  const noLink =
    linkGap === 'unread' ? 'no link read' : linkGap === 'unrecorded' ? 'no link recorded' : null;
  /** The same, as a clause: "No link was read". */
  const noLinkClause =
    linkGap === 'unread'
      ? 'No link was read'
      : linkGap === 'unrecorded'
        ? 'No link is in this check’s record'
        : null;

  // A page that answered an error, grouped by where it answered (segment/broken.ts): a page reached
  // by a redirect is shown at its final URL, and a final URL the record also holds is one row.
  const rowOf = (at: string, members: PageResult[]): ErrorRowView => {
    const asked = new Set([at, ...members.map((p) => p.url)]);
    const via = members.filter((p) => p.url !== at).map((p) => path(p.url));
    const into = edges.filter(
      (e) => asked.has(e.to_url) && !asked.has(e.from_url) && e.from_url !== e.to_url,
    );
    const linkedFrom = into.map((e) => ({
      url: e.from_url,
      path: path(e.from_url),
      anchor: isBlank(e.anchor_text) ? null : e.anchor_text,
    }));
    const froms = [...new Set(linkedFrom.map((l) => l.path))];
    const none = noLink ?? 'no link from another page';
    return {
      url: at,
      path: path(at),
      status: PAGE_CELLS.status_code(members[0]!),
      via,
      pageText: via.length ? `${path(at)} (redirected from ${via.join(', ')})` : path(at),
      linkedFrom,
      linkedAll: froms.length ? froms.join(', ') : none,
      linkedSummary: froms.length
        ? `${froms.filter((_, i) => i < 2).join(', ')}${froms.length > 2 ? ` and ${count(froms.length - 2)} more` : ''}`
        : none,
    };
  };
  const rows = errorGroups(pages).map(([at, members]) => ({
    missing: isMissing(members[0]!),
    row: rowOf(at, members),
  }));
  const broken = rows.filter((r) => r.missing && r.row.linkedFrom.length).map((r) => r.row);
  const unlinked = rows.filter((r) => r.missing && !r.row.linkedFrom.length).map((r) => r.row);
  const errors = rows.filter((r) => !r.missing).map((r) => r.row);
  const brokenLinkedFrom = new Set(broken.flatMap((r) => r.linkedFrom.map((l) => l.url))).size;

  const recorded = pages.filter((p) => p.redirect !== null);
  const redirects: RedirectRowView[] = pages.filter(redirected).map((p) => {
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
  const titles = column('Titles', TITLE_FIELD, served, ref);
  const descriptions = column('Meta descriptions', DESCRIPTION_FIELD, served, ref);

  const counts: LinksCounts = {
    checked: pages.length,
    served: served.length,
    broken: broken.length,
    brokenLinkedFrom,
    missingUnlinked: unlinked.length,
    errors: errors.length,
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
      ? `Checked ${count(checked)} of the ${count(crawled)} pages crawled`
      : `Checked ${pagesWord(checked)}`;
  const unlinkedHeading = linkGap === null ? UNLINKED_HEADING : UNLINKED_UNKNOWN_HEADING;

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
      body: 'This check recorded no page, so no link, redirect, title or meta description was read.',
      screenBody:
        'This check recorded no page, so no link, redirect, title or meta description was read.',
      brokenEmpty: NOT_MEASURED_LINE,
      redirectsEmpty: NOT_MEASURED_LINE,
      pill: { state: 'neutral', label: 'not measured' },
      coverage,
    };
  }

  // Each clause below is built from the rows it names, so it says only what they hold. A count of
  // missing pages is a count of pages, never of links.
  const missingPages = (n: number) => `${count(n)} missing ${plural(n, 'page', 'pages')}`;
  const brokenSentence = broken.length
    ? `${missingPages(broken.length)}, linked from ${pagesWord(brokenLinkedFrom)}, answering ${statusesOf(broken).join(' or ')}.`
    : null;
  const unlinkedSentence = unlinked.length
    ? noLinkClause === null
      ? `${missingPages(unlinked.length)}, answering ${statusesOf(unlinked).join(' or ')}, ${plural(unlinked.length, 'has', 'have')} no link from another page.`
      : `${missingPages(unlinked.length)}, answering ${statusesOf(unlinked).join(' or ')}. ${noLinkClause}, so what links to ${plural(unlinked.length, 'it', 'them')} is not known.`
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
    [brokenSentence, unlinkedSentence, errorSentence, none, redirectSentence, basicsSentence]
      .filter(Boolean)
      .join(' ');

  const partial = crawled !== null && crawled > checked;
  const notRecorded = recorded.length < checked;
  const brokenEmpty = broken.length
    ? null
    : noLinkClause !== null
      ? `${noLinkClause}, so no link to a missing page can be named.`
      : (noneSentence ??
        (unlinked.length
          ? 'No link from another page leads to a missing page.'
          : 'No link we read leads to a missing page.'));
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
    pill: broken.length
      ? {
          state: 'bad',
          label: `${missingPages(broken.length)}, linked from ${pagesWord(brokenLinkedFrom)}`,
        }
      : unlinked.length
        ? {
            state: 'neutral',
            label:
              noLink === null
                ? `${missingPages(unlinked.length)}, no link from another page`
                : `${missingPages(unlinked.length)}, ${noLink}`,
          }
        : noLink !== null
          ? { state: 'neutral', label: noLink }
          : {
              state: 'neutral',
              label: partial ? `no broken link in ${pagesWord(checked)} checked` : 'no broken link',
            },
    coverage,
  };
}
