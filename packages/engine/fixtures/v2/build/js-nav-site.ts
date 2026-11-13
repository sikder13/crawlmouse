/**
 * A site whose product pages add their navigation in the browser: the `js_only_navigation` fixture
 * (CC-32 D6). The host is a reserved, fictional one.
 *
 * Pages, by template: `/` (the homepage), `/products/{slug}` (`/products/camp-stove`, `/products/dome-tent`),
 * `/guides/{slug}` (`/guides/camp-cooking`, `/guides/tent-pitching`). In the HTML the server sends, the homepage
 * links to both products and to `/guides/tent-pitching`, and every other page links to the homepage only, so
 * nothing in the crawl links to `/guides/camp-cooking`. Once rendered, each product page also holds a menu
 * linking to both guides and to `/blog/latest-news`, a URL the crawl never fetched. Every other page renders as
 * it is served. The crawl's rows and edges are the served HTML's; the Browser Run replies
 * (`JS_NAV_REPLIES`) are each page's two sides.
 */
import { CrawlPageSchema, type CrawlPage } from '@crawlmouse/types/v2';
import type { ReplyFixture } from '../../../src/v2/render/fakes.js';
import type { BuildInput } from '../../../src/v2/build/types.js';
import { crawlRow, edge, oneBatchBuild } from './rows.js';

export const JS_NAV_HOST = 'https://js-nav.test';
export const jsNavUrl = (path: string): string =>
  path === '/' ? JS_NAV_HOST : `${JS_NAV_HOST}${path}`;

export const PRODUCTS = ['/products/camp-stove', '/products/dome-tent'] as const;
export const GUIDES = ['/guides/camp-cooking', '/guides/tent-pitching'] as const;
/** The menu a product page's script adds: both guides, and a URL the crawl never fetched. */
export const MENU = ['/guides/camp-cooking', '/guides/tent-pitching', '/blog/latest-news'] as const;

/** Where each page links in the HTML the server sends. */
const SERVED_LINKS: Readonly<Record<string, readonly string[]>> = {
  '/': [...PRODUCTS, '/guides/tent-pitching'],
  ...Object.fromEntries([...PRODUCTS, ...GUIDES].map((p) => [p, ['/']])),
};

const words = (n: number, stem: string) =>
  Array.from({ length: n }, (_, i) => `${stem}${i}`).join(' ');
const anchors = (paths: readonly string[]) => paths.map((p) => `<a href="${p}">${p}</a>`).join(' ');
const page = (path: string, nav: string) =>
  `<html><head><title>${path}</title></head><body>${nav}<main><h1>${path}</h1><p>${words(120, 'w')}</p>${anchors(SERVED_LINKS[path]!)}</main></body></html>`;

function row(path: string): CrawlPage {
  return CrawlPageSchema.parse({
    ...crawlRow({
      url: jsNavUrl(path),
      outcome: 'fetched',
      status: 200,
      links_out: SERVED_LINKS[path]!.length,
    }),
  });
}

const PATHS = ['/', ...PRODUCTS, ...GUIDES];

/** The site's BuildInput: one crawl batch of every page, with the served HTML's links; no render. */
export const jsNavBuild = (): BuildInput =>
  oneBatchBuild(
    JS_NAV_HOST,
    PATHS.map(row),
    PATHS.flatMap((from) => SERVED_LINKS[from]!.map((to) => edge(jsNavUrl(from), jsNavUrl(to)))),
  );

/** What the fake Browser Run client answers for each page. */
export const JS_NAV_REPLIES: ReplyFixture[] = PATHS.map((path) => ({
  provenance: 'js-nav-site',
  url: jsNavUrl(path),
  static: { html: page(path, ''), browser_ms: 800 },
  rendered: {
    html: page(
      path,
      (PRODUCTS as readonly string[]).includes(path) ? `<nav>${anchors(MENU)}</nav>` : '',
    ),
    browser_ms: 1200,
  },
}));
