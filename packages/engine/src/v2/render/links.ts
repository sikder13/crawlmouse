/**
 * The links a page's script adds, for `js_only_navigation` (detectors/js-only-navigation.ts): the
 * same-site link targets of the page's rendered side that its static side does not have. One extractor
 * reads both sides, so a target differs between them only because the page's HTML differs, never
 * because two readers differ.
 *
 * The extractor is the crawl's own: extract.ts `extractPage`, with non-content links (share actions,
 * media files) left out as the worker leaves them out (worker rows/links.ts), each target in
 * canonicalizeUrl's spelling with no options, which is the spelling the worker's edges carry. A `www.`
 * twin is therefore a target of its own, as it is a page of its own in the v2 crawl (the worker unifies
 * no host): a static `/x` and a rendered `https://www.<host>/x` on a page at `<host>` are two targets.
 * Then on the page's own site, by the crawl planner's rule (`inSiteScope`: its host or its `www.` twin,
 * on the default port), and not the page itself. A target longer than MAX_URL_LENGTH is left out on
 * both sides alike, as the worker leaves it out of its edges, so it is never JS-only.
 *
 * Both sides are read whole, in memory, and the difference is taken over the whole sets: an empty
 * difference is evidence that the script adds no same-site link. Only the difference is kept, bounded
 * (MAX_RENDER_LINKS, MAX_RENDER_LINK_CHARS), with its whole count and whether the bound cut it. It lives
 * on the render outcome only (run.ts `RenderedPage`), never in `PageResult.without_js`, whose stored
 * shape holds four keys.
 */
import { extractPage, inSiteScope } from '../../extract.js';
import { canonicalizeUrl } from '../../url-canonical.js';
import { MAX_URL_LENGTH } from '../batch-bounds.js';

/** The most JS-only targets a page keeps. Our choice. */
export const MAX_RENDER_LINKS = 200;

/**
 * The most URL characters the kept JS-only targets of a page hold, summed. Our choice: 32 KiB holds
 * all MAX_RENDER_LINKS targets while they average up to 163 characters (32768 / 200), so on such a
 * page the count decides; past that it holds what fits. So a rendered page adds at most 32 KiB of URL
 * characters to the stored render outcome. A canonical URL is ASCII (the URL parser percent-encodes the
 * rest), so its characters are its bytes.
 */
export const MAX_RENDER_LINK_CHARS = 32 * 1024;

/** What a rendered page's script adds to its same-site links. */
export interface RenderLinks {
  /**
   * The rendered side's same-site targets its static side does not have, sorted: the prefix within
   * MAX_RENDER_LINKS targets and MAX_RENDER_LINK_CHARS characters.
   */
  js_only: string[];
  /** How many there were before the bound. */
  js_only_count: number;
  /** The bound left some out. */
  truncated: boolean;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One side's same-site targets, whole: on the page's site, not the page, within the URL bound. */
export function sameSiteTargets(html: string, pageUrl: string): Set<string> {
  const site = new URL(pageUrl);
  const self = canonicalizeUrl(pageUrl);
  const out = new Set<string>();
  for (const { toUrl } of extractPage(html, pageUrl, { excludeNonContentLinks: true }).links) {
    if (toUrl === self || toUrl.length > MAX_URL_LENGTH || !inSiteScope(new URL(toUrl), site))
      continue;
    out.add(toUrl);
  }
  return out;
}

export function renderLinks(
  staticHtml: string,
  renderedHtml: string,
  pageUrl: string,
): RenderLinks {
  const served = sameSiteTargets(staticHtml, pageUrl);
  const added = [...sameSiteTargets(renderedHtml, pageUrl)]
    .filter((t) => !served.has(t))
    .sort(byText);
  const js_only: string[] = [];
  let chars = 0;
  for (const t of added) {
    if (js_only.length === MAX_RENDER_LINKS || chars + t.length > MAX_RENDER_LINK_CHARS) break;
    js_only.push(t);
    chars += t.length;
  }
  return { js_only, js_only_count: added.length, truncated: js_only.length < added.length };
}
