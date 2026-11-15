/**
 * Which page a search query belongs to, when the export cannot say. Search Console's Queries and
 * Pages tabs are separate tables, so a query is ATTRIBUTED to the page whose own words (slug,
 * title, keywords) cover the most of the query's words. A query two pages cover equally is attributed
 * to both, which is how a likely cannibal pair shows up. Anything shown from this is labelled
 * "attributed", never presented as Search Console's own page × query data.
 */
import type { QueryRow } from './search-console';

/** Words that carry no topic. Kept short: "vs", "free" and "alternative" are topic words here. */
const STOP = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'for',
  'in',
  'on',
  'and',
  'or',
  'is',
  'are',
  'my',
  'your',
  'how',
  'what',
  'do',
  'does',
  'with',
  'by',
]);

/** Lower-case words, a trailing plural "s" removed from words over three letters. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

export interface AttributablePage {
  path: string;
  /** The page's own words: its slug, title and keywords. */
  terms: readonly string[];
}

/** The share of a query's words a page's terms cover, 0–1. */
export function coverage(query: string, page: AttributablePage): number {
  const q = [...new Set(words(query))];
  if (q.length === 0) return 0;
  const p = new Set(page.terms.flatMap(words));
  return q.filter((w) => p.has(w)).length / q.length;
}

/** The least coverage at which a query is attributed at all. */
export const MIN_COVERAGE = 0.75;

/** Each page's attributed queries, by impressions, most first. Pages with none map to []. */
export function attributeQueries(
  queries: readonly QueryRow[],
  pages: readonly AttributablePage[],
): Map<string, QueryRow[]> {
  const out = new Map<string, QueryRow[]>(pages.map((p) => [p.path, []]));
  for (const row of queries) {
    const scored = pages.map((p) => ({ p, s: coverage(row[0], p) }));
    const best = Math.max(...scored.map((x) => x.s));
    if (best < MIN_COVERAGE) continue;
    for (const { p, s } of scored) if (s === best) out.get(p.path)!.push(row);
  }
  for (const list of out.values()) list.sort((a, b) => b[2] - a[2]);
  return out;
}
