/**
 * Whether a render shows a challenge or block page instead of the page. A render has no status code
 * and no response headers, only the HTML the browser holds, so it is read from that alone.
 *
 * The rule is narrower than the crawl worker's, which reads body text only on a 403 or 503. Without a
 * status, a fragment that also appears on pages served normally would mark them challenged. Cloudflare
 * loads scripts from `/cdn-cgi/challenge-platform/` on ordinary pages it serves, so that path is not a
 * marker here, and neither is the phrase "just a moment" in body text, only the exact title. A block
 * page this does not recognise, served to both sides, has the same words on both and reads as share 1.
 */

/** Titles of challenge and block pages, compared whole, trimmed, in lower case. */
export const CHALLENGE_TITLES = [
  'just a moment...',
  'attention required! | cloudflare',
  'vercel security checkpoint',
] as const;

/** Endings of block-page titles that name the site first, compared trimmed, in lower case. */
export const CHALLENGE_TITLE_ENDINGS = ['used cloudflare to restrict access'] as const;

/**
 * Fragments of challenge or block pages, compared in lower case. A page that merely quotes one (an
 * article about bot protection) is taken for a challenge: the error is towards not measuring it.
 */
export const CHALLENGE_MARKERS = [
  'px-captcha',
  'errors.edgesuite.net',
  'captcha-delivery.com',
  'incapsula incident id',
  '/.well-known/sgcaptcha',
  '/_sec/cp_challenge',
] as const;

/**
 * The text of the first `<title…>…</title>`, trimmed, from the page already in lower case: the match
 * `/<title[^>]*>([\s\S]*?)<\/title>/i` gives, found in one pass. That regular expression takes time
 * quadratic in the page on many `<title` with no `>`, or many `<title>a` with no `</title>`, and a
 * page is up to 10 MiB. Each search below starts where the last ended, so this reads the page once.
 */
export function titleOf(lower: string): string | null {
  const open = lower.indexOf('<title');
  if (open < 0) return null;
  const tagEnd = lower.indexOf('>', open + '<title'.length);
  if (tagEnd < 0) return null;
  const close = lower.indexOf('</title>', tagEnd + 1);
  return close < 0 ? null : lower.slice(tagEnd + 1, close).trim();
}

export function challengeIn(html: string): boolean {
  const lower = html.toLowerCase();
  const title = titleOf(lower);
  if (title !== null && (CHALLENGE_TITLES as readonly string[]).includes(title)) return true;
  if (title !== null && CHALLENGE_TITLE_ENDINGS.some((e) => title.endsWith(e))) return true;
  return CHALLENGE_MARKERS.some((m) => lower.includes(m));
}
