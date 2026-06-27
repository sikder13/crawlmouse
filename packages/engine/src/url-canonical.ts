import { createHash } from 'node:crypto';

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

/**
 * Marketing / click-ID query params that don't change page content (§2). Stripping them collapses
 * `/p?utm_source=…` and `/p` to ONE node instead of inflating the graph with per-campaign
 * duplicates (which manufacture false orphans/near-orphans and split in-degree). Exact keys plus
 * the `utm_`/`mc_` families; matched case-insensitively. Real params that merely CONTAIN "ref"
 * (e.g. `referrer`) are kept — only the exact `ref` key is tracking.
 */
const TRACKING_PARAM_KEYS = new Set([
  'gclid', 'fbclid', 'ref', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'dclid', 'igshid', 'mkt_tok', '_hsenc', '_hsmi',
]);
const TRACKING_PARAM_PREFIXES = ['utm_', 'mc_'];
function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return TRACKING_PARAM_KEYS.has(k) || TRACKING_PARAM_PREFIXES.some((p) => k.startsWith(p));
}

export interface CanonicalizeOptions {
  /**
   * Force the canonical identity onto a single scheme ('http:'/'https:', trailing
   * colon optional). Sites that 30x-redirect deep paths between http and https
   * (A1b) would otherwise produce two identities for one page, double-counting it
   * and splitting the in-degree graph. Pinning every URL in a crawl to the
   * homepage's actual scheme collapses them back to one identity. Only the IDENTITY
   * is rewritten — the crawler still fetches the real (reachable) URL.
   */
  forceScheme?: string;
  /**
   * Strip marketing/click-ID query params (utm_*, gclid, fbclid, mc_*, ref, …) from the identity
   * (§2), so campaign-tagged URLs collapse to the underlying page. Off by default (v1 keeps every
   * param); the v2 audit path enables it.
   */
  stripTrackingParams?: boolean;
  /**
   * Unify www vs non-www to ONE host (§2): when set and the URL's host equals `unifyHost` or its
   * www-sibling (same host ignoring a leading `www.`), rewrite the host to `unifyHost`. Pass the
   * homepage's RESOLVED host so both `www.x` and `x` collapse to whichever the site actually serves
   * — this is intentionally not a blind `www.` strip. Off by default. Non-sibling hosts (real
   * subdomains like `blog.x`) are never touched.
   */
  unifyHost?: string;
}

export function canonicalizeUrl(input: string, opts: CanonicalizeOptions = {}): string {
  const url = new URL(input);
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';

  // §2 www/non-www unification: collapse the www-sibling onto the homepage's resolved host.
  if (opts.unifyHost) {
    const stripWww = (h: string) => h.replace(/^www\./, '');
    const target = opts.unifyHost.toLowerCase();
    if (stripWww(url.hostname) === stripWww(target)) url.hostname = target;
  }

  if (opts.forceScheme !== undefined) {
    const forced = opts.forceScheme.endsWith(':') ? opts.forceScheme.toLowerCase() : `${opts.forceScheme.toLowerCase()}:`;
    if (forced !== 'http:' && forced !== 'https:') {
      throw new Error(`canonicalizeUrl: forceScheme must be http: or https:, got "${opts.forceScheme}"`);
    }
    url.protocol = forced;
  }

  // Drop a port that is the default for the (possibly forced) scheme. The WHATWG URL parser
  // already strips the default port of the input's ORIGINAL scheme, so this additionally
  // covers a port that only becomes the default after forcing (e.g. http://x:443 -> https).
  if (url.port && url.port === DEFAULT_PORTS[url.protocol]) url.port = '';

  // Sort query params deterministically. localeCompare is locale/ICU-dependent
  // (differs across Node builds), but canonicalizeUrl feeds hashUrl which is the
  // page identity key — non-deterministic ordering would split one page into two
  // hashes and corrupt dedupe/in-degree. Use a stable codepoint comparison on
  // (key, value) instead, so the result is identical on every runtime.
  if (url.search) {
    const params = Array.from(url.searchParams.entries())
      .filter(([k]) => !(opts.stripTrackingParams && isTrackingParam(k)))
      .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
    url.search = '';
    for (const [k, v] of params) url.searchParams.append(k, v);
  }

  // Collapse multiple slashes in path (preserve scheme://)
  let pathname = url.pathname.replace(/\/{2,}/g, '/');
  // Strip trailing slash (except root)
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  url.pathname = pathname;

  // Construct manually to drop trailing slash on origin-only URLs
  const path = url.pathname === '/' ? '' : url.pathname;
  const out = `${url.protocol}//${url.host}${path}${url.search}`;
  return out;
}

export function hashUrl(input: string): string {
  return createHash('sha256').update(canonicalizeUrl(input)).digest('hex');
}
