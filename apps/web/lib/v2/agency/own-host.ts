/**
 * Goal 1 row 25: which hosts are ours. Kept apart from `portal-host.ts` and free of any import, so
 * the browser bundle (`instrumentation-client.ts`) can read it without carrying the suffix list.
 */

/**
 * The host as stored and compared: trimmed, lower-cased, one trailing dot removed. Nothing else is
 * changed, so a refusal names what was typed.
 */
export function normalizeHost(raw: string): string {
  const host = raw.trim().toLowerCase();
  return host.endsWith('.') ? host.slice(0, -1) : host;
}

/**
 * Whether a request's host is one this project serves as crawlmouse.com: ours, a Vercel deployment
 * address, or a local one. Every other host reaching the project is a portal host. `host` is the
 * `Host` header as sent, port included or not.
 */
export function isOwnHost(host: string | null): boolean {
  if (host === null) return true;
  const name = hostnameOf(host);
  if (name === '') return true;
  if (name === 'localhost' || name === '127.0.0.1' || name === '::1') return true;
  return (
    name === 'crawlmouse.com' || name.endsWith('.crawlmouse.com') || name.endsWith('.vercel.app')
  );
}

/** The `Host` header's name: lower-cased, its port and an IPv6 literal's brackets removed. */
export function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? h : h.slice(1, end);
  }
  const colon = h.indexOf(':');
  return normalizeHost(colon === -1 ? h : h.slice(0, colon));
}

/**
 * The regular expression a middleware matcher's `missing: [{ type: 'host' }]` reads, for the same
 * hosts `isOwnHost` accepts. Next anchors it and matches it against the `Host` header's name,
 * lower-cased and without its port. A route-segment export must be a static literal, so
 * `middleware.ts` repeats it as one, and a test holds the two equal.
 */
export const OWN_HOST_MATCHER =
  '(?:localhost|127\\.0\\.0\\.1|crawlmouse\\.com|.+\\.crawlmouse\\.com|.+\\.vercel\\.app)';
