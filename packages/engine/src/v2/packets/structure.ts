/**
 * What the seven structure packets share: reading a record's subject and the rows it names, the
 * crawl's links filed as the detectors file them, and the sentences more than one packet writes.
 */
import type { LinkEdge, PageResult } from '@crawlmouse/types/v2';
import { fileEdges, landingsOf } from '../build/filing.js';
import { subjectOfKey } from '../detectors/fingerprint.js';
import { byText } from '../detectors/scope.js';
import type { Detection } from '../detectors/types.js';
import { code, line, list, ours, type Line, type Safe } from './text.js';
import type { PacketFacts } from './types.js';

/** The page URL, or template key, a structure record is about. */
export const subjectOf = (fix: Pick<Detection, 'key'>): string => subjectOfKey(fix.key);

/**
 * The check's row for a page a detected record names. The detectors judge crawled pages only, so a
 * record that names a page the check does not hold is a fault in the caller, and throws.
 */
export function rowOf(facts: Pick<PacketFacts, 'pages'>, url: string): PageResult {
  const row = facts.pages.get(url);
  if (row === undefined)
    throw new Error('packets: a structure record names a page the check does not hold');
  return row;
}

/**
 * The crawl's links filed under the page they were found on, as the detectors and the grade file
 * them (build/filing.ts), read in the detectors' order (by source, then target), so that of two
 * links that file to one pair the same one is kept.
 */
export function filedLinks(facts: Pick<PacketFacts, 'pages' | 'edges'>): LinkEdge[] {
  const ordered = [...facts.edges].sort(
    (a, b) => byText(a.from_url, b.from_url) || byText(a.to_url, b.to_url),
  );
  return fileEdges(ordered, landingsOf([...facts.pages.values()]));
}

/** Up to `max` URLs in code spans; a longer list says how many pages it leaves out. */
export const pagesShown = (urls: readonly string[], max = 8): Safe =>
  list(
    urls.map((u) => code(u)),
    max,
    'page',
  );

/** "page" or "pages", and the like, for a count. */
export const plural = (n: number, one: string, many: string): Safe => ours(n === 1 ? one : many);

/** A page's title as read, or null when the crawl read none. */
export const titleOf = (page: PageResult | undefined): string | null => {
  const text = page?.title?.text ?? null;
  return text === null || text.trim() === '' ? null : text;
};

/** The step every packet that adds a link carries: what makes the link one a crawler follows. */
export const CRAWLABLE_LINK: Line = line`Write the link as an <a> element with an href, in the HTML the server sends. A link that only JavaScript adds is not there for a crawler that does not run scripts.`;

/** The pages Google's documentation is cited from, as the packets print them. */
export const GOOGLE_DOCS = {
  links: 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable',
  canonical:
    'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
  pagination:
    'https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading',
  hreflang: 'https://developers.google.com/search/docs/specialty/international/localized-versions',
} as const;

/** The date the documentation pages the stack bodies cite were read. */
export const DOCS_READ = '2026-11-12';
