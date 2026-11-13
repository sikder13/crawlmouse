/**
 * The same-site link targets of a page's two renders, for `js_only_navigation`
 * (detectors/js-only-navigation.ts). One extractor reads both sides, so a target differs between them
 * only because the page's HTML differs, never because two readers differ.
 *
 * The extractor is the crawl's own: extract.ts `extractPage`, with non-content links (share actions,
 * media files) left out as the worker leaves them out (worker rows/links.ts), each target in
 * canonicalizeUrl's spelling, which the worker's edges carry. Then on the page's own site, by the crawl
 * planner's rule (`inSiteScope`: its host or its `www.` twin, on the default port); not the page itself,
 * once each and within the URL bound, as the worker builds edges (worker batch/crawl.ts `edgesFrom`,
 * which counts a target past its cap instead). A side keeps the longest prefix of its sorted targets
 * that holds at most MAX_RENDER_LINKS targets and MAX_RENDER_LINK_CHARS characters; when that leaves a
 * target out, or a target passed the URL bound, the side is `truncated`, and a truncated page is not
 * evidence of absence.
 *
 * The lists live on the render outcome only (run.ts `RenderedPage`): they never enter
 * `PageResult.without_js`, whose stored shape holds four keys.
 */
import { extractPage, inSiteScope } from '../../extract.js';
import { canonicalizeUrl } from '../../url-canonical.js';
import { MAX_URL_LENGTH } from '../batch-bounds.js';

/** The most targets a side keeps. Our choice. */
export const MAX_RENDER_LINKS = 200;

/**
 * The most URL characters a side keeps, summed over its targets. Our choice: 32 KiB holds all
 * MAX_RENDER_LINKS targets while they average up to 163 characters (32768 / 200), so on such a page the
 * count decides; past that it holds what fits. It bounds what a page adds to the stored render
 * outcome at 64 KiB of URL characters for its two sides, where MAX_RENDER_LINKS targets of up to
 * MAX_URL_LENGTH characters allowed 800 KiB. A canonical URL is ASCII (the URL parser percent-encodes
 * the rest), so its characters are its bytes.
 */
export const MAX_RENDER_LINK_CHARS = 32 * 1024;

/** A rendered page's same-site link targets, each side sorted. */
export interface RenderLinks {
  static: string[];
  rendered: string[];
  /** A side had more than its bounds keep (MAX_RENDER_LINKS, MAX_RENDER_LINK_CHARS), or one past the URL bound. */
  truncated: boolean;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * One side's targets: on the page's site, not the page, sorted; the prefix within MAX_RENDER_LINKS
 * targets and MAX_RENDER_LINK_CHARS characters.
 */
export function sameSiteTargets(
  html: string,
  pageUrl: string,
): { targets: string[]; truncated: boolean } {
  const site = new URL(pageUrl);
  const self = canonicalizeUrl(pageUrl);
  let truncated = false;
  const seen = new Set<string>();
  for (const { toUrl } of extractPage(html, pageUrl, { excludeNonContentLinks: true }).links) {
    if (toUrl === self || !inSiteScope(new URL(toUrl), site)) continue;
    if (toUrl.length > MAX_URL_LENGTH) {
      truncated = true;
      continue;
    }
    seen.add(toUrl);
  }
  const sorted = [...seen].sort(byText);
  const targets: string[] = [];
  let chars = 0;
  for (const t of sorted) {
    if (targets.length === MAX_RENDER_LINKS || chars + t.length > MAX_RENDER_LINK_CHARS) {
      truncated = true;
      break;
    }
    targets.push(t);
    chars += t.length;
  }
  return { targets, truncated };
}

export function renderLinks(
  staticHtml: string,
  renderedHtml: string,
  pageUrl: string,
): RenderLinks {
  const s = sameSiteTargets(staticHtml, pageUrl);
  const r = sameSiteTargets(renderedHtml, pageUrl);
  return { static: s.targets, rendered: r.targets, truncated: s.truncated || r.truncated };
}
