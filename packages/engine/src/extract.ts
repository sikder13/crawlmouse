import * as cheerio from 'cheerio';
import { canonicalizeUrl } from './url-canonical.js';

const GENERIC_ANCHOR_PATTERNS = [
  /^(click here|read more|learn more|more info|here|this|link|go|continue)\.?$/i,
  /^(see more|find out more|get started|view more)$/i,
];

export interface ExtractedLink {
  toUrl: string;
  anchorText: string;
  isGenericAnchor: boolean;
}

export interface ExtractedPage {
  title?: string;
  links: ExtractedLink[];
  /**
   * The page's `<link rel="canonical">` target (§2), set ONLY when it is same-host AND differs
   * from the page's own URL. The crawler consolidates a canonicalised-away page onto this identity
   * so it isn't counted as a separate node. Cross-host canonicals are ignored (a page must not hand
   * its identity to another site); a self-canonical leaves this undefined.
   */
  canonicalUrl?: string;
}

// Host-equality after stripping a leading `www.` — NOT eTLD+1 / registrable-domain
// matching. This intentionally treats subdomains (blog./shop.) as different sites,
// matching the crawler's same-origin enqueue scope; spanning subdomains is a
// deliberate v1.0 non-goal (it would broaden crawl cost and the SSRF surface).
export function sameHostIgnoringWww(a: URL, b: URL): boolean {
  const norm = (h: string) => h.replace(/^www\./, '').toLowerCase();
  return norm(a.hostname) === norm(b.hostname);
}

/**
 * Jetpack / WordPress share buttons render as SAME-HOST `?share=<platform>` links that the server
 * 302-redirects to the external share endpoint — fetching them wastes the crawl budget and pollutes
 * the graph with cross-host nodes. Match the PRECISE pattern (a known platform token, incl. the
 * `jetpack-` prefix), NEVER any URL merely containing "share", so a real content page using a `share`
 * query param for another purpose is never dropped.
 */
const SHARE_PLATFORMS = new Set([
  'facebook', 'twitter', 'x', 'linkedin', 'reddit', 'telegram', 'tumblr', 'pinterest', 'whatsapp',
  'pocket', 'skype', 'email', 'print', 'mastodon', 'bluesky', 'nextdoor', 'pressthis',
]);
function isShareActionUrl(url: URL): boolean {
  const v = url.searchParams.get('share');
  if (v == null) return false;
  return SHARE_PLATFORMS.has(v.toLowerCase().replace(/^jetpack-/, ''));
}

/**
 * Media / binary / asset file links (and the WordPress uploads dir) are not content pages — crawling
 * them wastes budget and offers junk link sources in the cure. Match by FILE EXTENSION on the last
 * path segment (case-insensitive) or the `/wp-content/uploads/` media path — NEVER by a loose
 * substring, so a content page like `/about` or `/products/widget` is never caught. HTML extensions
 * are intentionally absent (they ARE content).
 */
const MEDIA_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp', 'tiff', 'tif',
  'pdf', 'zip', 'gz', 'tar', 'rar', '7z', 'dmg', 'exe', 'pkg', 'apk',
  'mp4', 'webm', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'ogg', 'flac', 'm4a',
  'css', 'js', 'mjs', 'json', 'xml', 'rss', 'csv',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
]);
function isMediaFileUrl(url: URL): boolean {
  if (url.pathname.includes('/wp-content/uploads/')) return true; // WordPress media library
  const last = url.pathname.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return false; // no extension (or a dotfile) → treat as a content page
  return MEDIA_EXTENSIONS.has(last.slice(dot + 1).toLowerCase());
}

function isGeneric(anchor: string): boolean {
  const trimmed = anchor.trim();
  return GENERIC_ANCHOR_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Extract the title + same-host links from a page.
 *
 * `input` may be either the raw HTML string OR an already-parsed cheerio root.
 * The crawler request handler already holds a parsed root (`$`) for each fetched
 * page, so passing that object directly avoids re-serializing it to HTML and
 * re-running `cheerio.load` on every request — a double-parse that doubled the
 * per-page CPU cost. String callers (tests, any HTML-in code paths) are unchanged:
 * a string is loaded here exactly as before. Both forms produce identical results.
 */
export function extractPage(
  input: string | cheerio.CheerioAPI,
  baseUrl: string,
  opts: { excludeNonContentLinks?: boolean } = {},
): ExtractedPage {
  const $ = typeof input === 'string' ? cheerio.load(input) : input;
  const title = $('title').first().text().trim() || undefined;

  const baseUrlObj = new URL(baseUrl);
  const links: ExtractedLink[] = [];

  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return;
    }
    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
    if (!sameHostIgnoringWww(resolved, baseUrlObj)) return;
    // SPEC 02 (v2): skip same-host NON-CONTENT links — share-action (?share=) + media/binary files —
    // they aren't pages of the site (they 302 off-site or are assets), so they waste budget + pollute cures.
    if (opts.excludeNonContentLinks && (isShareActionUrl(resolved) || isMediaFileUrl(resolved))) return;

    const anchorText = $(el).text().trim().replace(/\s+/g, ' ');
    links.push({
      toUrl: canonicalizeUrl(resolved.toString()),
      anchorText,
      isGenericAnchor: isGeneric(anchorText),
    });
  });

  // §2 rel=canonical: consolidate a canonicalised-away page onto its declared canonical. Only a
  // same-host canonical that DIFFERS from the page's own URL is surfaced (self-canonical = keep;
  // cross-host = ignore, so a page can't reassign its identity to another site).
  let canonicalUrl: string | undefined;
  const canonicalHref = ($('link[rel="canonical"]').attr('href') ?? '').trim();
  if (canonicalHref) {
    try {
      const resolved = new URL(canonicalHref, baseUrl);
      if (
        (resolved.protocol === 'http:' || resolved.protocol === 'https:') &&
        sameHostIgnoringWww(resolved, baseUrlObj)
      ) {
        const canon = canonicalizeUrl(resolved.toString());
        if (canon !== canonicalizeUrl(baseUrl)) canonicalUrl = canon;
      }
    } catch {
      /* ignore a malformed canonical href */
    }
  }

  return { title, links, canonicalUrl };
}
