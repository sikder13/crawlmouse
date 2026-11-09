/**
 * Discovery (Q8): the crawl's seeds, read from the Vercel function as v1 reads them. robots.txt's
 * `Sitemap:` lines (else the common sitemap paths) and the sitemaps, through the engine's
 * discoverSitemaps and parseSitemapEntries over safeFetch (the SSRF guard), as our identified
 * crawler, within DISCOVER_S and SITEMAP_URL_CAP. The seeds are the homepage and the sitemap's URLs,
 * each with its `<lastmod>` date (null where the sitemap gives none), which stage 2's "newest" picks
 * read.
 */
import {
  canonicalizeUrl,
  discoverSitemaps,
  parseSitemapEntries,
  type safeFetch,
  type Seed,
} from '@crawlmouse/engine/v2/pipeline';
import { DISCOVER_REQUEST_MS, DISCOVER_S, SITEMAP_URL_CAP } from './limits';

/**
 * The user agent our crawl identity sends: the worker's CRAWL_USER_AGENT
 * (packages/worker/src/identities.ts). The app does not import the worker package, which it does
 * not depend on; discover.test.ts fails when the two differ.
 */
export const CRAWL_USER_AGENT =
  'Mozilla/5.0 (compatible; Crawlmouse/2.0; +https://crawlmouse.com/bot)';

export interface DiscoverDeps {
  fetch: typeof safeFetch;
  /** CRAWL_USER_AGENT in production. */
  userAgent: string;
  /** Milliseconds since the epoch. */
  now: () => number;
}

/** `raw` in canonical spelling when it is an http(s) URL; null otherwise. */
function canonicalHttp(raw: string): string | null {
  try {
    const { protocol } = new URL(raw);
    return protocol === 'http:' || protocol === 'https:' ? canonicalizeUrl(raw) : null;
  } catch {
    return null;
  }
}

export async function discoverSeeds(
  homepageUrl: string,
  deps: DiscoverDeps,
): Promise<{ seeds: Seed[]; sitemapUrls: number }> {
  const deadline = deps.now() + DISCOVER_S * 1000;
  // A fetch that throws reads as "not there" to both engine readers, so once the deadline has
  // passed every sitemap left is skipped.
  const fetcher = async (url: string) => {
    const left = deadline - deps.now();
    if (left <= 0) throw new Error('discovery: deadline passed');
    const res = await deps.fetch(url, {
      userAgent: deps.userAgent,
      timeoutMs: DISCOVER_REQUEST_MS,
      totalDeadlineMs: Math.min(left, DISCOVER_REQUEST_MS),
    });
    return { status: res.status, body: res.body };
  };

  const { sitemapUrls } = await discoverSitemaps(new URL(homepageUrl).origin, { fetcher });
  const entries: { loc: string; lastmod: string | null }[] = [];
  for (const sitemap of sitemapUrls) {
    if (entries.length >= SITEMAP_URL_CAP) break;
    await parseSitemapEntries(sitemap, { fetcher, maxUrls: SITEMAP_URL_CAP }, 0, entries);
  }

  // The homepage is a seed whether or not the sitemap lists it; the builder keeps the sitemap's
  // seed of a URL listed as both (assemble.ts seedMap).
  const seeds: Seed[] = [{ url: homepageUrl, source: 'homepage', lastmod: null }];
  const listed = new Set<string>();
  for (const { loc, lastmod } of entries) {
    const url = canonicalHttp(loc);
    if (url === null || listed.has(url)) continue;
    listed.add(url);
    seeds.push({ url, source: 'sitemap', lastmod });
  }
  return { seeds, sitemapUrls: entries.length };
}
