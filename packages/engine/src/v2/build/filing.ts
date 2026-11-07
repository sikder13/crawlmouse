/**
 * Links filed under the page they were found on. The worker records a redirected page's links from
 * where its request landed (`from_url` is the final URL), and a link to a URL that redirects names
 * that URL. The structure detectors file both back under the requested URL (detectors/scope.ts
 * `landings` and `resolve`); the graph the grade, depth and PageRank are computed on needs the same
 * filing, or a redirected page's links drop out of it (buildGraph keeps only links between nodes).
 *
 * The rule is scope.ts's: the canonical final URL of a page answering 200 stands for that page, unless
 * it is itself a page, or two pages landed on it. filing.test.ts holds the result equal to
 * `scopeOf(...).out` on the recorded fixture and on generated checks.
 */
import type { LinkEdge, PageResult } from '@crawlmouse/types/v2';
import { canonicalizeUrl } from '../../url-canonical.js';

const spell = (url: string): string | null => {
  try {
    return canonicalizeUrl(url);
  } catch {
    return null;
  }
};

/** The requested URL of each page answering 200 whose request landed on a URL no other page names. */
export function landingsOf(
  pages: readonly Pick<PageResult, 'url' | 'final_url' | 'status_code'>[],
): Map<string, string> {
  const urls = new Set(pages.map((p) => p.url));
  const by = new Map<string, string | null>();
  for (const p of pages) {
    const landed = p.final_url === null ? null : spell(p.final_url);
    if (landed === null || landed === p.url || urls.has(landed) || p.status_code !== 200) continue;
    by.set(landed, by.has(landed) ? null : p.url);
  }
  const out = new Map<string, string>();
  for (const [landed, url] of by) if (url !== null) out.set(landed, url);
  return out;
}

/** The links with both ends filed by `landings`, a link to itself left out, each pair once. */
export function fileEdges(
  edges: readonly LinkEdge[],
  landings: ReadonlyMap<string, string>,
): LinkEdge[] {
  const resolve = (u: string) => landings.get(u) ?? u;
  const seen = new Set<string>();
  const out: LinkEdge[] = [];
  for (const e of edges) {
    const filed = { ...e, from_url: resolve(e.from_url), to_url: resolve(e.to_url) };
    const key = `${filed.from_url}\u0000${filed.to_url}`;
    if (filed.from_url === filed.to_url || seen.has(key)) continue;
    seen.add(key);
    out.push(filed);
  }
  return out;
}
