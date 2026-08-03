/**
 * SPEC 5.1a §4.4 — deterministic crawl-trap defences.
 *
 * A crawl trap is a URL space a site generates without bound: an infinite calendar, a facet filter
 * whose parameters combine freely, a session-token loop. On a budget-bounded crawl a trap does not
 * merely waste requests — it CAPTURES THE SAMPLE, so the pages we grade are the generated ones rather
 * than the site's real content, and the grade describes a shape the owner never built. That is the
 * same failure as E1 arriving by a different route.
 *
 * Per-template quotas (§6) bound this structurally once the stratified frontier lands. These caps are
 * belt-and-braces, they are cheap, and they are the only defence present until then.
 *
 * Every value is a pinned constant with a fixture, and the predicate is a pure function of the URL
 * string — no wall clock, no crawl state, no dependence on what else was discovered. That matters
 * because §6.6 makes the frontier a pure function of the discovered set: a trap filter that consulted
 * crawl state would put arrival order back into the selection through the side door.
 */

/**
 * Longest URL admitted. 2048 is the de-facto browser/IIS ceiling; a longer URL is generated rather
 * than authored. Measured on the byte length of the whole URL string.
 */
export const MAX_URL_LENGTH = 2048;

/**
 * Deepest path admitted, in segments. The deepest legitimate shape observed in the corpus is ~7
 * (`/blog/2026/03/12/slug` is 5); 12 leaves generous headroom before a recursive generator is the only
 * remaining explanation.
 */
export const MAX_URL_PATH_DEPTH = 12;

/** Most query parameters admitted. Facet explosions begin here; ordinary pages use one or two. */
export const MAX_URL_QUERY_PARAMS = 8;

/**
 * Most purely-numeric path segments admitted. This is the calendar signature: `/2026/03/12/09/30`
 * keeps generating, one segment per unit of time. Four allows `/blog/2026/03/12/slug` and rejects the
 * hour-and-minute continuation.
 */
export const MAX_NUMERIC_PATH_SEGMENTS = 4;

/**
 * Most high-entropy opaque parameter VALUES admitted. One is ordinary — a signed link, a share token,
 * a cache buster. Two or more together is a generator signature, and it is the shape that survives
 * canonicalisation (we cannot strip a key we have never seen).
 */
export const MAX_OPAQUE_QUERY_VALUES = 2;

/** Shortest value considered for opacity. Below this, high-entropy-looking strings are just words. */
export const OPAQUE_VALUE_MIN_LENGTH = 16;

export interface TrapVerdict {
  trapped: boolean;
  /** Stable machine-readable cause, so an exclusion can be explained rather than merely counted. */
  reason?: 'unparseable' | 'url_length' | 'path_depth' | 'query_params' | 'numeric_segments' | 'opaque_params';
}

const ALLOWED: TrapVerdict = { trapped: false };

/**
 * A value is opaque when it is long, drawn from an identifier alphabet, and MIXES letters and digits.
 * The mixing requirement is what keeps a long human slug (`the-quick-brown-fox-jumps`, letters only)
 * and a long ordinal (`1234567890123456`, digits only) out of the count — both are ordinary, and
 * rejecting either would drop real content pages.
 */
function isOpaqueValue(v: string): boolean {
  if (v.length < OPAQUE_VALUE_MIN_LENGTH) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(v)) return false;
  return /[0-9]/.test(v) && /[A-Za-z]/.test(v);
}

/**
 * Judge a URL against the trap caps. Pure, allocation-light, and O(url length).
 *
 * An UNPARSEABLE URL is trapped, not allowed. This is the opposite default from the robots gate
 * (`isUrlAllowed`), and deliberately so: robots answers "did the owner forbid this?", where silence
 * means permission, while this answers "is this worth a request?", where an input we cannot even parse
 * has no claim on the budget.
 */
export function isCrawlTrap(url: string): TrapVerdict {
  if (url.length > MAX_URL_LENGTH) return { trapped: true, reason: 'url_length' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { trapped: true, reason: 'unparseable' };
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length > MAX_URL_PATH_DEPTH) return { trapped: true, reason: 'path_depth' };

  let numeric = 0;
  for (const s of segments) if (/^\d+$/.test(s)) numeric += 1;
  if (numeric > MAX_NUMERIC_PATH_SEGMENTS) return { trapped: true, reason: 'numeric_segments' };

  let params = 0;
  let opaque = 0;
  for (const [, value] of parsed.searchParams) {
    params += 1;
    if (isOpaqueValue(value)) opaque += 1;
  }
  if (params > MAX_URL_QUERY_PARAMS) return { trapped: true, reason: 'query_params' };
  if (opaque >= MAX_OPAQUE_QUERY_VALUES) return { trapped: true, reason: 'opaque_params' };

  return ALLOWED;
}
