import * as cheerio from 'cheerio';
import { parseRobotsTxt } from './robots.js';

export interface FetchedResource { status: number; body: string }
export type Fetcher = (url: string) => Promise<FetchedResource>;

export interface DiscoverResult {
  sitemapUrls: string[];
  source: 'robots' | 'common_path' | 'none';
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
  const robotsRes = await opts.fetcher(`${origin}/robots.txt`).catch(() => null);
  if (robotsRes && robotsRes.status === 200 && robotsRes.body) {
    const parsed = parseRobotsTxt(robotsRes.body);
    if (parsed.sitemaps.length > 0) {
      return { sitemapUrls: parsed.sitemaps, source: 'robots' };
    }
  }

  for (const path of COMMON_SITEMAP_PATHS) {
    const url = `${origin}${path}`;
    const res = await opts.fetcher(url).catch(() => null);
    if (res && res.status === 200 && res.body) {
      return { sitemapUrls: [url], source: 'common_path' };
    }
  }

  return { sitemapUrls: [], source: 'none' };
}

export interface ParseOptions { fetcher: Fetcher; depthLimit?: number }

export async function parseSitemapUrls(
  sitemapUrl: string,
  opts: ParseOptions,
  depth = 0,
): Promise<string[]> {
  if (depth > (opts.depthLimit ?? 3)) return [];
  const res = await opts.fetcher(sitemapUrl);
  if (res.status !== 200 || !res.body) return [];

  const $ = cheerio.load(res.body, { xmlMode: true });

  // sitemap index?
  const indexLocs = $('sitemapindex > sitemap > loc').map((_, el) => $(el).text().trim()).get();
  if (indexLocs.length > 0) {
    const all: string[] = [];
    for (const child of indexLocs) {
      const childUrls = await parseSitemapUrls(child, opts, depth + 1);
      for (const u of childUrls) all.push(u);
    }
    return all;
  }

  // urlset
  return $('urlset > url > loc').map((_, el) => $(el).text().trim()).get();
}
