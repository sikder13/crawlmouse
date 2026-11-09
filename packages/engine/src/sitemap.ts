import * as cheerio from 'cheerio';
import { parseRobotsTxt, type ParsedRobots } from './robots.js';

export interface FetchedResource {
  status: number;
  body: string;
}
export type Fetcher = (url: string) => Promise<FetchedResource>;

export interface DiscoverResult {
  sitemapUrls: string[];
  source: 'robots' | 'common_path' | 'none';
  /** Parsed robots.txt (rules + sitemaps), or null if robots.txt was absent. */
  robots: ParsedRobots | null;
}

export interface DiscoverOptions {
  fetcher: Fetcher;
}

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

/** One `<url>` of a urlset: its `<loc>`, and its `<lastmod>` as a calendar date (YYYY-MM-DD). */
export interface SitemapEntry {
  loc: string;
  /** Null when the url gives no `<lastmod>`, or one that does not start with a real date. */
  lastmod: string | null;
}

/** The date a W3C-datetime `<lastmod>` starts with, as written; null unless it is a real date. */
function lastmodDate(text: string): string | null {
  const date = /^(\d{4}-\d{2}-\d{2})/.exec(text.trim())?.[1];
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : null;
}

/**
 * Every url of a sitemap, following an index to its children, with each url's `<lastmod>`. The same
 * walk and the same bounds as parseSitemapUrls, which is this list's `loc`s.
 */
export async function parseSitemapEntries(
  sitemapUrl: string,
  opts: ParseOptions,
  depth = 0,
  collected: SitemapEntry[] = [],
): Promise<SitemapEntry[]> {
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
      await parseSitemapEntries(child, opts, depth + 1, collected);
    }
    return collected;
  }

  // urlset — skip empty <loc> (would throw downstream in canonicalizeUrl) and cap.
  const locs = $('urlset > url > loc')
    .map((_, el) => ({
      loc: $(el).text().trim(),
      lastmod: lastmodDate($(el).parent().children('lastmod').first().text()),
    }))
    .get();
  for (const entry of locs) {
    if (collected.length >= maxUrls) break;
    if (entry.loc) collected.push(entry);
  }
  return collected;
}

export async function parseSitemapUrls(
  sitemapUrl: string,
  opts: ParseOptions,
  depth = 0,
  collected: string[] = [],
): Promise<string[]> {
  const maxUrls = opts.maxUrls ?? DEFAULT_MAX_SITEMAP_URLS;
  const room = { ...opts, maxUrls: maxUrls - collected.length };
  if (room.maxUrls <= 0) return collected;
  const entries = await parseSitemapEntries(sitemapUrl, room, depth);
  collected.push(...entries.map((e) => e.loc));
  return collected;
}
