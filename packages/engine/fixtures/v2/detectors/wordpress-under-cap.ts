/**
 * The shape from docs/tickets/2026-08-07-orphan-under-cap.md: a WordPress site with no orphans by
 * construction, whose linking pages fall outside the crawl budget.
 *
 * 5,500 pages (the ticket's site had 5,501): the homepage, 5,000 posts declared in the sitemap, and
 * 499 `/page/N` archives the sitemap does not declare. Ten posts to a page: the homepage is page 1 and
 * carries the first ten, `/page/N` carries the next, so every post has an inbound link. The crawl
 * fetches in the order a sitemap-seeded frontier does: the homepage, then the declared posts, then the
 * archives it finds late. Any cap under the site's size therefore drops archives first, and with them
 * the only inbound link most posts have, which is the class the ticket measured. The fixture
 * requirement in the ticket is met: the linking pages are outside the budget.
 */
import type { DetectorInput } from '../../../src/v2/detectors/types.js';
import { coverageOf, edge, page, u, type PageSpec } from './builders.js';

export const POSTS = 5000;
export const POSTS_PER_ARCHIVE = 10;
/** `/page/2` to `/page/500`: the homepage is page 1. */
export const ARCHIVES = POSTS / POSTS_PER_ARCHIVE - 1;
export const PAGES = 1 + POSTS + ARCHIVES;

const post = (i: number) => `/post-${i}`;
const archive = (n: number) => `/page/${n}`;
const postsOn = (archivePage: number) =>
  Array.from({ length: POSTS_PER_ARCHIVE }, (_, k) =>
    post((archivePage - 1) * POSTS_PER_ARCHIVE + k),
  );

/** Every page, in fetch order. */
function wordpress(): PageSpec[] {
  const home: PageSpec = { path: '/', links: [...postsOn(1), archive(2)] };
  const posts = Array.from(
    { length: POSTS },
    (_, i): PageSpec => ({ path: post(i), template: '/{slug}', links: ['/'] }),
  );
  const archives = Array.from({ length: ARCHIVES }, (_, k): PageSpec => {
    const n = k + 2;
    return {
      path: archive(n),
      template: '/page/{n}',
      kind: 'pagination',
      links: [...postsOn(n), ...(n < ARCHIVES + 1 ? [archive(n + 1)] : [])],
    };
  });
  return [home, ...posts, ...archives];
}

/** The check a crawl with `cap` makes of the site. */
export function wordpressUnderCap(cap: number): DetectorInput {
  const crawled = wordpress().slice(0, cap);
  const pages = crawled.map((s) => page(s));
  const edges = crawled.flatMap((s) => (s.links ?? []).map((l) => edge(s.path, l)));
  // Discovered: the sitemap's posts and the homepage, plus every URL a crawled page links to.
  const discovered = new Set([u('/'), ...Array.from({ length: POSTS }, (_, i) => u(post(i)))]);
  for (const e of edges) discovered.add(e.to_url);
  for (const p of pages) discovered.add(p.url);
  return {
    check: { status: 'finished', coverage: coverageOf(pages, discovered.size) },
    page_cap: cap,
    homepage_url: u('/'),
    pages,
    edges,
    disallowed: [],
    previous_coverage: null,
  };
}
