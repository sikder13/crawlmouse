import { createHash } from 'node:crypto';

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

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
}

export function canonicalizeUrl(input: string, opts: CanonicalizeOptions = {}): string {
  const url = new URL(input);
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';

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
    const params = Array.from(url.searchParams.entries()).sort((x, y) =>
      x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0,
    );
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
