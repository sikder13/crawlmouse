import * as cheerio from 'cheerio';
import { parseRobotsTxt, type ParsedRobots } from './robots.js';

export interface FetchedResource { status: number; body: string }
export type Fetcher = (url: string) => Promise<FetchedResource>;

export interface DiscoverResult {
  sitemapUrls: string[];
  source: 'robots' | 'common_path' | 'none';
  /** Parsed robots.txt (rules + sitemaps), or null if robots.txt was absent. */
  robots: ParsedRobots | null;
}

export interface DiscoverOptions { fetcher: Fetcher }

const COMMON_SITEMAP_PATHS = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemap1.xml',
  '/sitemap-index.xml',
];

export async function discoverSitemaps(
  origin: string,
  opts: DiscoverOptions,
): Promise<DiscoverResult> {
  let robots: ParsedRobots | null = null;
  const robotsRes = await opts.fetcher(`${origin}/robots.txt`).catch(() => null);
  if (robotsRes && robotsRes.status === 200 && robotsRes.body) {
    robots = parseRobotsTxt(robotsRes.body);
    if (robots.sitemaps.length > 0) {
      return { sitemapUrls: robots.sitemaps, source: 'robots', robots };
    }
  }

  for (const path of COMMON_SITEMAP_PATHS) {
    const url = `${origin}${path}`;
    const res = await opts.fetcher(url).catch(() => null);
    if (res && res.status === 200 && res.body) {
      return { sitemapUrls: [url], source: 'common_path', robots };
    }
  }

  return { sitemapUrls: [], source: 'none', robots };
}

export interface ParseOptions {
  fetcher: Fetcher;
  depthLimit?: number;
  /** Cumulative cap on URLs collected across the whole index tree (memory/DoS bound). */
  maxUrls?: number;
}

/** Default cumulative URL cap. A sitemap index can reference many 50k-URL children;
 *  without a global bound the engine could build a multi-million-element array
 *  before the page cap is applied. Well above any v1.0 page cap, with headroom for
 *  cross-origin filtering downstream. */
const DEFAULT_MAX_SITEMAP_URLS = 10_000;

export async function parseSitemapUrls(
  sitemapUrl: string,
  opts: ParseOptions,
  depth = 0,
  collected: string[] = [],
): Promise<string[]> {
  const maxUrls = opts.maxUrls ?? DEFAULT_MAX_SITEMAP_URLS;
  if (depth > (opts.depthLimit ?? 3)) return collected;
  if (collected.length >= maxUrls) return collected;

  // A child fetch may legitimately fail or be rejected by the SSRF guard — isolate
  // it so one bad branch doesn't abort the whole audit.
  let res: FetchedResource;
  try {
    res = await opts.fetcher(sitemapUrl);
  } catch {
    return collected;
  }
  if (res.status !== 200 || !res.body) return collected;

  // Defense-in-depth: refuse XML declaring a DTD / entities (XXE / billion-laughs
  // surface) before parsing, even though cheerio's htmlparser2 does not resolve them.
  if (/<!doctype|<!entity/i.test(res.body)) return collected;

  const $ = cheerio.load(res.body, { xmlMode: true });

  // sitemap index?
  const indexLocs = $('sitemapindex > sitemap > loc')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  if (indexLocs.length > 0) {
    for (const child of indexLocs) {
      if (collected.length >= maxUrls) break;
      await parseSitemapUrls(child, opts, depth + 1, collected);
    }
    return collected;
  }

  // urlset — skip empty <loc> (would throw downstream in canonicalizeUrl) and cap.
  const locs = $('urlset > url > loc').map((_, el) => $(el).text().trim()).get();
  for (const loc of locs) {
    if (collected.length >= maxUrls) break;
    if (loc) collected.push(loc);
  }
  return collected;
}
