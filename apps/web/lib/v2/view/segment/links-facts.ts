/**
 * Links and pages (row 5) as data: the pages that answer an error and where they are linked from,
 * the pages that redirect, and the titles and meta descriptions that are missing or shared. It reads
 * the page and link records of one check, through the pages CSV's own accessors (reports/csv.ts), so
 * the screen, the CSV and the PDF read the same values. Titles and descriptions are counted over the
 * pages that answered 200; missing means no text or empty text.
 */
import type { Check, LinkEdge, PageResult } from '@crawlmouse/types/v2';
import { siteOf } from '../../fixtures';
import { listOf } from '../../format';
import { PAGE_CELLS } from '../../reports/csv';
import { capitalise, count, plural } from '../../words';
import { brokenPagesOf } from './broken';
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

export interface LinkingPage {
  path: string;
  anchor: string;
}

export interface BrokenRowView {
  path: string;
  status: number;
  /** Every page whose link leads to it, with that link's text, in the record's order. */
  linkedFrom: LinkingPage[];
  /** "/blog/a, /pricing and 1 more": the first two linking pages, and how many more. */
  linkedSummary: string;
  /** Every linking page, comma-separated, as the PDF lists it. */
  linkedAll: string;
}

export interface RedirectRowView {
  path: string;
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
  pages: ShortList<string>;
  pageCount: number;
}

export interface BasicsColumnView {
  heading: string;
  /** One line: the missing count, or that none is missing. */
  missingLine: string;
  missing: ShortList<string>;
  /** One line: how many texts are shared, by how many pages, or that none is. */
  sharedLine: string;
  shared: ShortList<SharedGroupView>;
}

export interface LinksCounts {
  /** Pages in the record. */
  checked: number;
  /** Pages that answered 200: the pages whose titles and descriptions are read. */
  served: number;
  broken: number;
  /** Distinct pages that link to a broken page. */
  brokenLinkedFrom: number;
  redirects: number;
  loops: number;
  missingTitles: number;
  sharedTitlePages: number;
  missingDescriptions: number;
  sharedDescriptionPages: number;
}

export const BROKEN_EMPTY = 'No internal link leads to a page that answers an error.';
export const REDIRECTS_EMPTY = 'No page we crawled redirects.';
export const HEADINGS_LINE = 'Headings are not checked yet.';

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
    if (!text) {
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
  host: string,
): { view: BasicsColumnView; missing: number; sharedPages: number } {
  const { missing, shared } = groupsOf(served, read);
  const sharedPages = shared.reduce((n, [, ps]) => n + ps.length, 0);
  const path = (p: PageResult) => shortUrl(p.url, host);
  return {
    missing: missing.length,
    sharedPages,
    view: {
      heading,
      missingLine: missing.length
        ? `Missing: ${count(missing.length)} ${plural(missing.length, 'page', 'pages')}`
        : 'Missing: none',
      missing: shortList(missing.map(path)),
      sharedLine: shared.length
        ? `Shared by more than one page: ${count(shared.length)} ${plural(shared.length, noun[0], noun[1])}, ${count(sharedPages)} pages`
        : 'Shared by more than one page: none',
      shared: shortList(
        shared.map(([text, ps]) => ({
          text,
          line: `“${text}” · ${count(ps.length)} pages`,
          pages: shortList(ps.map(path)),
          pageCount: ps.length,
        })),
      ),
    },
  };
}

/** "1 page answers 404" / "2 pages answer 404 and 1 page answers 410", by status. */
function brokenWords(broken: readonly PageResult[]): string {
  const by = new Map<number, number>();
  for (const p of broken) by.set(p.status_code, (by.get(p.status_code) ?? 0) + 1);
  return listOf(
    [...by.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([status, n]) => `${count(n)} ${plural(n, 'page answers', 'pages answer')} ${status}`),
  );
}

export interface LinksFacts {
  counts: LinksCounts;
  broken: BrokenRowView[];
  redirects: RedirectRowView[];
  titles: BasicsColumnView;
  descriptions: BasicsColumnView;
  /** The sentence the door and the screen open with, built from the counts. */
  body: string;
  pill: DoorView['pill'];
  coverage: string;
}

/** What the record of a check says about its links and page basics: the door's, screen's and PDF's. */
export function linksFacts(d: ViewDataset, check: Check): LinksFacts {
  const host = siteOf(d, check).host;
  const pages = d.page_results.filter((p) => p.check_id === check.id);
  const edges: LinkEdge[] = d.link_edges.filter((e) => e.check_id === check.id);
  const path = (url: string) => shortUrl(url, host);

  const brokenPages = brokenPagesOf(d, check.id);
  const broken: BrokenRowView[] = brokenPages.map((p) => {
    const into = edges.filter((e) => e.to_url === p.url);
    const linkedFrom = into.map((e) => ({ path: path(e.from_url), anchor: e.anchor_text }));
    const froms = [...new Set(linkedFrom.map((l) => l.path))];
    return {
      path: path(p.url),
      status: PAGE_CELLS.status_code(p),
      linkedFrom,
      linkedAll: froms.length ? froms.join(', ') : 'no link in the record',
      linkedSummary: froms.length
        ? `${froms.filter((_, i) => i < 2).join(', ')}${froms.length > 2 ? ` and ${count(froms.length - 2)} more` : ''}`
        : 'no link in the record',
    };
  });
  const brokenUrls = new Set(brokenPages.map((p) => p.url));
  const brokenLinkedFrom = new Set(
    edges.filter((e) => brokenUrls.has(e.to_url)).map((e) => e.from_url),
  ).size;

  const redirects: RedirectRowView[] = pages
    .filter((p) => (p.redirect?.hops.length ?? 0) > 0)
    .map((p) => {
      const chain = p.redirect!;
      const finalUrl = PAGE_CELLS.final_url(p);
      const endsAt =
        chain.loop || finalUrl === null
          ? null
          : { path: path(finalUrl), status: PAGE_CELLS.status_code(p) };
      return {
        path: path(p.url),
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
  const titles = column('Titles', ['title', 'titles'], served, PAGE_CELLS.title, host);
  const descriptions = column(
    'Meta descriptions',
    ['description', 'descriptions'],
    served,
    PAGE_CELLS.meta_description,
    host,
  );

  const counts: LinksCounts = {
    checked: pages.length,
    served: served.length,
    broken: brokenPages.length,
    brokenLinkedFrom,
    redirects: redirects.length,
    loops: redirects.filter((r) => r.loop).length,
    missingTitles: titles.missing,
    sharedTitlePages: titles.sharedPages,
    missingDescriptions: descriptions.missing,
    sharedDescriptionPages: descriptions.sharedPages,
  };

  const linkWords = (n: number) => `${count(n)} ${plural(n, 'page', 'pages')}`;
  const brokenSentence = brokenPages.length
    ? `${brokenWords(brokenPages)}${brokenLinkedFrom ? ` and ${plural(brokenPages.length, 'is', 'are')} linked from ${linkWords(brokenLinkedFrom)}` : ''}.`
    : null;
  const redirectSentence = redirects.length
    ? `${linkWords(redirects.length)} ${plural(redirects.length, 'redirects', 'redirect')}${counts.loops ? `, ${count(counts.loops)} in a loop` : ''}.`
    : null;
  const basics = [
    counts.missingDescriptions
      ? `${linkWords(counts.missingDescriptions)} ${plural(counts.missingDescriptions, 'has', 'have')} no meta description`
      : null,
    counts.missingTitles
      ? `${linkWords(counts.missingTitles)} ${plural(counts.missingTitles, 'has', 'have')} no title`
      : null,
    counts.sharedTitlePages
      ? `${linkWords(counts.sharedTitlePages)} share a title with another`
      : null,
    counts.sharedDescriptionPages
      ? `${linkWords(counts.sharedDescriptionPages)} share a meta description with another`
      : null,
  ].filter((s): s is string => s !== null);
  const basicsSentence = !served.length
    ? 'No page answered 200, so no title or meta description was read.'
    : basics.length
      ? `${capitalise(basics.join('; '))}.`
      : `Each of the ${linkWords(served.length)} that answered 200 has its own title and meta description.`;
  const body = [
    brokenSentence ?? 'No page we checked answers an error.',
    redirectSentence,
    basicsSentence,
  ]
    .filter(Boolean)
    .join(' ');

  const crawled = check.coverage?.pages_crawled ?? null;
  return {
    counts,
    broken,
    redirects,
    titles: titles.view,
    descriptions: descriptions.view,
    body,
    pill: brokenPages.length
      ? {
          state: 'bad',
          label: `${count(brokenPages.length)} broken ${plural(brokenPages.length, 'link', 'links')}`,
        }
      : { state: 'neutral', label: 'no broken link' },
    coverage:
      crawled !== null && crawled > pages.length
        ? `Checked ${count(pages.length)} of the ${count(crawled)} pages crawled`
        : `Checked ${linkWords(pages.length)}`,
  };
}
