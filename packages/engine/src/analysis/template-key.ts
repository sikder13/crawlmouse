/**
 * SPEC 5.1a §6.2 — stratum keys for the deterministic frontier.
 *
 * A stratum key is the SHAPE of a URL with its variable parts replaced by placeholders, so that every
 * `/event/{slug}` page lands in one bucket and no single template can drain the crawl budget (§6.3).
 * `/event/soknalopet-2026` → `/event/{slug}`; `/blog/2026/03/12/x` → `/blog/{n}/{n}/{n}/{slug}`.
 *
 * WHY CONTEXT-FREE, and why that is forced rather than chosen. The accurate approach genericises a
 * position once enough distinct sibling values have been observed at it — real crawlers do this. But
 * then a URL's key changes as discovery grows, and **I6 ("the same URL + same HTML always yields the
 * same PageKind and templateKey") fails by construction**: the same page would key differently at page
 * 100 and page 500 of the same crawl. I6 forbids the frequency rule, so this is a pure per-URL
 * function. The cost, stated rather than hidden: a template whose slugs are all short and hyphen-free
 * (`/shop/hats`, `/shop/caps`) under-genericises into one stratum per page.
 *
 * DEPTH-1 SEGMENTS STAY LITERAL. Genericising the top level would merge `/about`, `/pricing` and
 * `/contact` into a single `/{slug}` stratum, and a single quota would then decide whether the user's
 * pricing page is crawled at all. Top-level pages are individually important; deep siblings are not.
 */

/**
 * Shortest segment treated as a slug on length alone. Below it, a hyphen-free segment is assumed to be
 * a structural path component (`/shop/hats`) rather than a content identifier.
 */
export const TEMPLATE_SLUG_MIN_LEN = 12;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NUMERIC = /^\d+$/;
/**
 * An opaque hex identifier must contain at least one DIGIT.
 *
 * Without that clause `^[0-9a-f]{8,}$` matches ordinary English words spelled entirely from the hex
 * alphabet — `facade`, `decade`, `defaced`, `deadbeef` — so `/shop/facade` would key as `/shop/{id}`
 * and a real content template would be shredded into per-page strata. Every genuine hex id carries
 * digits; a word does not. Same mixing heuristic as the §4.4 opaque-parameter guard, deliberately.
 */
const OPAQUE_HEX = /^(?=[0-9a-f]*\d)[0-9a-f]{8,}$/;

/**
 * Derive the stratum key for a canonical URL. Pure string manipulation, total on hostile input, and
 * independent of the query string — a stratum is a path shape, and query variants of one page belong
 * to the same template.
 */
export function templateKeyFor(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return '/';
  }
  const segments = pathname.split('/').filter(Boolean).map((s) => decodeSegment(s).toLowerCase());
  if (segments.length === 0) return '/';

  const out = segments.map((seg, i) => {
    if (NUMERIC.test(seg)) return '{n}';
    if (UUID.test(seg)) return '{uuid}';
    if (OPAQUE_HEX.test(seg)) return '{id}';
    // Slugs only below the top level, and only in the LAST position: an intermediate segment is a
    // section name (`/shop/blue-widget` has one slug, not two), and a top-level segment is a page.
    const isLast = i === segments.length - 1;
    if (isLast && segments.length >= 2 && (seg.includes('-') || seg.length >= TEMPLATE_SLUG_MIN_LEN)) return '{slug}';
    return seg;
  });
  return `/${out.join('/')}`;
}

/** Percent-decoding must not throw on a malformed sequence — crawled paths are attacker-controlled. */
function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
