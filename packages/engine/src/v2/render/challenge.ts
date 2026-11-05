/**
 * Whether a render shows a challenge or block page instead of the page. A render has no status code
 * and no response headers, only the HTML the browser holds, so it is read from that alone.
 *
 * The rule is narrower than the crawl worker's, which reads body text only on a 403 or 503. Without a
 * status, a fragment that also appears on pages served normally would mark them challenged. Cloudflare
 * loads scripts from `/cdn-cgi/challenge-platform/` on ordinary pages it serves, so that path is not a
 * marker here, and neither is the phrase "just a moment" in body text; only the exact title is.
 */

/** Titles of Cloudflare's challenge and block pages, compared whole, trimmed, in lower case. */
export const CHALLENGE_TITLES = ['just a moment...', 'attention required! | cloudflare'] as const;

/** Fragments found only on challenge or block pages, compared in lower case. */
export const CHALLENGE_MARKERS = [
  'px-captcha',
  'captcha-delivery.com',
  'incapsula incident id',
  '/.well-known/sgcaptcha',
  '/_sec/cp_challenge',
] as const;

const titleOf = (html: string): string | null => {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1]!.trim().toLowerCase() : null;
};

export function challengeIn(html: string): boolean {
  const title = titleOf(html);
  if (title !== null && (CHALLENGE_TITLES as readonly string[]).includes(title)) return true;
  const lower = html.toLowerCase();
  return CHALLENGE_MARKERS.some((m) => lower.includes(m));
}
