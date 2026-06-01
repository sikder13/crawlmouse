import { createHash } from 'node:crypto';

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

export function canonicalizeUrl(input: string): string {
  const url = new URL(input);
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  if (DEFAULT_PORTS[url.protocol] === url.port) url.port = '';

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
