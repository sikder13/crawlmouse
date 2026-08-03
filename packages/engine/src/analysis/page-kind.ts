import type { PageKind } from '@crawlmouse/types';

/**
 * SPEC 5.1a §5.1 — the URL and query-parameter rule table.
 *
 * WHAT THIS IS FOR. Production recommended `/cp/auth/login` to a user as an orphan to fix, graded
 * individual tweet permalinks as "buried key pages" worth +2.6 points each, and generated an action
 * packet instructing someone to add internal links to a retweet (E5). None of those are pages of a
 * site in the sense the grade claims to measure. Classifying them is what stops the product giving
 * confidently wrong advice.
 *
 * TWO DESIGN RULES, both load-bearing:
 *
 * 1. **Segment equality, never substring.** Substring matching turns `/research` into a search page,
 *    `/about/accountability` into an account page and `/feedback` into a feed. Every rule here matches
 *    a whole path segment or a whole query key. The risk in this table is not missing a login page —
 *    it is deleting a real content page from the grade, and that is the failure this rule prevents.
 *
 * 2. **General, never site-specific.** E5 arrived as "`/tweets/{id}` on justinjackson.ca". Blacklisting
 *    `/tweets/` for one customer would be a rule with an exception waiting to be discovered somewhere
 *    else. The rule implemented is "a bare numeric-or-opaque id directly under a status-shaped parent
 *    segment", which contains no customer, and which `/products/12345` deliberately does not match.
 *
 * ORDER MATTERS and is part of the contract: the table is evaluated top to bottom, first match wins, so
 * a URL matching two rules has one stable answer. Every rule carries a `sample` it alone must claim and
 * a `counterSample` that must stay content — the tests assert both, which is what keeps a rule from
 * being silently shadowed by an earlier one and reading as coverage while never firing.
 */

export interface UrlKindRule {
  id: string;
  kind: PageKind;
  match: (ctx: UrlContext) => boolean;
  /** A URL this rule alone must claim. Pinned by a test, so a shadowed rule fails loudly. */
  sample: string;
  /** A near-miss that must stay content. This is the half of the fixture that protects real pages. */
  counterSample: string;
}

interface UrlContext {
  /** Lowercased, non-empty path segments. */
  segments: string[];
  /** Lowercased query keys. */
  keys: Set<string>;
  /** Lowercased query key → first value. */
  params: Map<string, string>;
}

const has = (ctx: UrlContext, ...names: string[]) => names.some((n) => ctx.segments.includes(n));
const hasKey = (ctx: UrlContext, ...names: string[]) => names.some((n) => ctx.keys.has(n));
const isNumeric = (s: string | undefined) => !!s && /^\d+$/.test(s);
/** A bare identifier: digits, or an opaque alphanumeric run. A hyphen makes it a human slug, not an id. */
const isBareId = (s: string | undefined) => !!s && (/^\d+$/.test(s) || /^[0-9a-z]{8,}$/.test(s));
const YEAR = /^(19|20)\d{2}$/;

export const URL_KIND_RULES: UrlKindRule[] = [
  {
    id: 'auth',
    kind: 'auth',
    // Any position, because auth lives under app prefixes as often as at the root (`/cp/auth/login`).
    match: (c) => has(c, 'login', 'signin', 'sign-in', 'register', 'signup', 'sign-up', 'account', 'my-account', 'logout', 'auth', 'password'),
    sample: 'https://s.test/cp/auth/login',
    counterSample: 'https://s.test/about/accountability',
  },
  {
    id: 'utility',
    kind: 'utility',
    match: (c) => has(c, 'cart', 'checkout', 'basket', 'wishlist', 'print', 'preview') || hasKey(c, 'replytocom', 'print'),
    sample: 'https://s.test/checkout/step-2',
    counterSample: 'https://s.test/products/shopping-cart-organizer',
  },
  {
    id: 'search',
    kind: 'search',
    match: (c) => has(c, 'search') || hasKey(c, 's', 'q', 'query', 'keyword'),
    sample: 'https://s.test/search?q=shoes',
    counterSample: 'https://s.test/blog/search-engine-basics',
  },
  {
    id: 'pagination',
    kind: 'pagination',
    // `page` followed by a NUMBER — `/page/about` is a real page about pages.
    match: (c) => {
      const i = c.segments.indexOf('page');
      if (i !== -1 && isNumeric(c.segments[i + 1])) return true;
      for (const k of ['page', 'paged', 'pg', 'offset', 'start']) {
        if (c.keys.has(k) && isNumeric(c.params.get(k))) return true;
      }
      return false;
    },
    sample: 'https://s.test/blog/page/2',
    counterSample: 'https://s.test/page/about',
  },
  {
    id: 'archive',
    kind: 'archive',
    // Listing segments, plus a DATE-ONLY path. `/2026/03/12/my-post` has a slug, so it is the post
    // itself and stays content; `/2026/03` is the month archive.
    match: (c) =>
      has(c, 'tag', 'tags', 'category', 'categories', 'topic', 'topics', 'author', 'archive', 'archives') ||
      (c.segments.length > 0 && YEAR.test(c.segments[0]!) && c.segments.every((s) => /^\d+$/.test(s))),
    sample: 'https://s.test/tag/seo',
    counterSample: 'https://s.test/blog/category-theory-explained',
  },
  {
    id: 'feed',
    kind: 'feed',
    match: (c) => has(c, 'feed', 'rss', 'atom') || hasKey(c, 'feed'),
    sample: 'https://s.test/blog/feed',
    counterSample: 'https://s.test/feedback',
  },
  {
    id: 'status',
    kind: 'status',
    // The GENERAL form of E5: a bare id directly under a status-shaped parent. `/products/12345` has an
    // id but no status-shaped parent, so it stays content — a product IS a page of the site.
    match: (c) => {
      if (c.segments.length < 2) return false;
      const last = c.segments[c.segments.length - 1]!;
      const parent = c.segments[c.segments.length - 2]!;
      return isBareId(last) && ['status', 'statuses', 'tweet', 'tweets', 'note', 'notes', 'comment', 'comments'].includes(parent);
    },
    sample: 'https://s.test/tweets/1876554433221100',
    counterSample: 'https://s.test/products/12345',
  },
];

/**
 * Classify a URL, or return null when no rule claims it — null means "no URL-level reason to exclude",
 * NOT "content". The caller still applies the directive, thin-content and duplicate layers (§5.2–§5.4)
 * before a page is gradeable.
 *
 * Total by construction: an unparseable URL yields null rather than throwing. A URL we cannot parse has
 * already been rejected by the trap caps (§4.4), and the conservative answer here is to claim nothing.
 */
export function classifyUrlKind(url: string): PageKind | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split('/').filter(Boolean).map((s) => decodeSegment(s).toLowerCase());
  const params = new Map<string, string>();
  for (const [k, v] of parsed.searchParams) {
    const key = k.toLowerCase();
    if (!params.has(key)) params.set(key, v);
  }
  const ctx: UrlContext = { segments, keys: new Set(params.keys()), params };
  for (const rule of URL_KIND_RULES) {
    if (rule.match(ctx)) return rule.kind;
  }
  return null;
}

/** Percent-decoding must not throw on a malformed sequence — crawled paths are attacker-controlled. */
function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
