/**
 * The pieces the structure packets' verify commands are made of: one `curl` of a page as a crawler the
 * site serves, at the address the page is served at (served-at.ts), piped to one `awk` program that
 * reads the HTML and exits 0 when the fix is there.
 *
 * What the programs read, and what they do not (`AWK`):
 *   - HTML comments and the bodies of script, style, template, textarea and title elements are
 *     removed first (`strip`), so a link or a tag written inside one is not read.
 *   - An attribute value is read in double quotes, in single quotes or unquoted (`attr`), with the
 *     character references for `&`, `"` and `'` read as those characters. Other references are not.
 *   - A URL is compared after `norm`: its fragment dropped, the slash that ends its path dropped, the
 *     page's own origin dropped from its front, and its percent-escapes decoded. So `/p` and `/p/`
 *     are one target, as the engine files them, and so are `/café` and `/caf%C3%A9`. The programs run
 *     under `LC_ALL=C`, where awk's `%c` writes a byte.
 *   - A relative href that does not start at the root is not resolved, the host is compared as
 *     written, and a query is compared as written: a page that spells a multi-parameter query in
 *     another order than the engine's sorted one does not match.
 *   - `head` ends at the first tag that is not html, head, title, base, link, meta or noscript: a
 *     `<link>` after it is in the body, where search engines do not read a canonical or an hreflang
 *     annotation. A page that omits `</head>` is read to that tag.
 *
 * A command is built from `Fragment`s: the words of a fragment are this module's, and each value in
 * one is a shell word made by shell.ts, so `command` hands `sh` the same two kinds of thing a
 * template literal would. An awk program is text of ours and holds no apostrophe (`\047` is one).
 */
import { canonicalizeUrl } from '../../url-canonical.js';
import { MAX_URL_LENGTH } from '../batch-bounds.js';
import { userAgentOf, verifyCrawler } from './crawler.js';
import { servedAt } from './served-at.js';
import { crawledWord, int, sh, url, word, type Command, type Word } from './shell.js';
import type { PacketFacts } from './types.js';

/** A piece of a command: words of ours around quoted values. */
export interface Fragment {
  readonly parts: readonly string[];
  readonly values: readonly Word[];
}

export function part(strings: TemplateStringsArray, ...values: readonly Word[]): Fragment {
  return { parts: [...strings], values };
}

const NOTHING = part``;

/** `values`, each after a space. */
function each(values: readonly Word[]): Fragment {
  return { parts: [...values.map(() => ' '), ''], values };
}

/** The fragments end to end. */
export function joined(...fragments: readonly Fragment[]): Fragment {
  const parts = [''];
  const values: Word[] = [];
  for (const f of fragments) {
    parts[parts.length - 1] += f.parts[0]!;
    f.values.forEach((value, i) => {
      values.push(value);
      parts.push(f.parts[i + 1]!);
    });
  }
  return { parts, values };
}

/** The fragments end to end, as one command. */
export function command(...fragments: readonly Fragment[]): Command {
  const { parts, values } = joined(...fragments);
  return sh(Object.assign([...parts], { raw: parts }), ...values);
}

/**
 * What bounds a command's length. A command is not cut, so a builder bounds what it names: each URL
 * is at most the worker's longest (`url_chars`; shell.ts `url` writes a character it must escape as
 * three), and a list of URLs or values a command could do without stops at `listed_chars` characters
 * of shell words (`listed`), its `expect` saying how many it left out.
 */
export const COMMAND_BOUNDS = { url_chars: MAX_URL_LENGTH, listed_chars: 8192 } as const;

/** The first of `items`, up to `max` of them and `COMMAND_BOUNDS.listed_chars` characters as shell words. */
export function listed<T>(items: readonly T[], max: number, wordOf: (item: T) => Word): T[] {
  const kept: T[] = [];
  let chars = 0;
  for (const item of items.slice(0, max)) {
    chars += wordOf(item).word.length;
    if (chars > COMMAND_BOUNDS.listed_chars) break;
    kept.push(item);
  }
  return kept;
}

/**
 * `target` in the engine's spelling when it is an http or https URL within the worker's longest;
 * null for anything else. A declared canonical is stored as the page wrote it, so it can be any text.
 */
export function httpUrl(target: string): string | null {
  if (target.length > COMMAND_BOUNDS.url_chars) return null;
  try {
    const parsed = new URL(target);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return canonicalizeUrl(target);
  } catch {
    return null;
  }
}

/** A URL in the engine's spelling; as given when it is not an http or https URL. */
export const spelled = (target: string): string => httpUrl(target) ?? target;

export interface Fetch {
  fragment: Fragment;
  /** The registry token of the crawler requested as; null when the site serves none we can name. */
  ua: string | null;
}

/** What `fetchOf` writes on a line of its own after each page when a command reads two. */
export const PAGE_END = 'crawlmouse:end';

/**
 * `curl` of `urls`, in order and as given, as a crawler the site serves today (crawler.ts). With more
 * than one, a line holding `PAGE_END` is written after each response, so the program can tell them
 * apart. `options` are further curl options of ours.
 */
export function requestOf(
  facts: Pick<PacketFacts, 'crawlers'>,
  urls: readonly string[],
  options: Fragment = NOTHING,
): Fetch {
  const crawler = verifyCrawler(facts);
  return {
    fragment: joined(
      part`curl -sS`,
      options,
      crawler === null ? NOTHING : part` -A ${word(userAgentOf(crawler))}`,
      urls.length > 1 ? part` -w ${word(`\\n${PAGE_END}\\n`)}` : NOTHING,
      each(urls.map(url)),
    ),
    ua: crawler?.token ?? null,
  };
}

/** `requestOf` for `pages` of the check, each at the address it is served at (served-at.ts). */
export const fetchOf = (
  facts: Pick<PacketFacts, 'crawlers' | 'pages'>,
  pages: readonly string[],
): Fetch =>
  requestOf(
    facts,
    pages.map((page) => servedAt(facts, page)),
  );

/** The awk functions the programs are written from. */
const AWK = {
  /** `s` without its comments and without the bodies of the elements whose content is not markup. */
  strip:
    'function strip(s, l, o, e, i) { l = tolower(s); o = ""; while (match(l, /<!--|<(script|style|template|textarea|title)[ \\/>]/)) { e = RLENGTH == 4 ? "-->" : "</" substr(l, RSTART + 1, RLENGTH - 2); o = o substr(s, 1, RSTART - 1) " "; i = index(substr(l, RSTART + RLENGTH - 1), e); if (!i) return o; i += RSTART + RLENGTH - 2 + length(e); s = substr(s, i); l = substr(l, i) } return o s }',
  /** The start of `s`, up to the first tag that cannot be in a head. */
  head: 'function head(s, o) { o = ""; while (match(s, /<[a-zA-Z\\/][^>]*>/)) { if (tolower(substr(s, RSTART, RLENGTH)) !~ /^<\\/?(html|head|title|base|link|meta|noscript)[ \\/>]/) break; o = o substr(s, RSTART, RLENGTH); s = substr(s, RSTART + RLENGTH) } return o }',
  /** The tags in `s` that match `re`, into `out`; their number. */
  tags: 'function tags(s, re, out, n) { n = 0; while (match(s, re)) { out[++n] = substr(s, RSTART, RLENGTH); s = substr(s, RSTART + RLENGTH) } return n }',
  /** The value of attribute `k` of tag `t`; empty when it has none. */
  attr: 'function attr(t, k, v, q) { if (!match(tolower(t), "[ \\"\\047/]" k " *= *")) return ""; v = substr(t, RSTART + RLENGTH); q = substr(v, 1, 1); if (q == "\\"" || q == "\\047") { v = substr(v, 2); v = substr(v, 1, index(v, q) - 1) } else if (match(v, /^[^ >]*/)) v = substr(v, 1, RLENGTH); gsub(/&#0*39;|&#[xX]0*27;|&apos;/, "\\047", v); gsub(/&quot;|&#0*34;|&#[xX]0*22;/, "\\"", v); gsub(/&amp;|&#0*38;|&#[xX]0*26;/, "\\\\&", v); return v }',
  /** `u` with its percent-escapes decoded. */
  pct: 'function pct(u, o, h, x) { x = "0123456789ABCDEF"; o = ""; while (match(u, /%[0-9A-Fa-f][0-9A-Fa-f]/)) { h = toupper(substr(u, RSTART + 1, 2)); o = o substr(u, 1, RSTART - 1) sprintf("%c", 16 * (index(x, substr(h, 1, 1)) - 1) + index(x, substr(h, 2, 1)) - 1); u = substr(u, RSTART + 3) } return o u }',
  /** A URL as the programs compare it; `site` is the origin of the page read. */
  norm: 'function norm(u, p, q) { sub(/#.*/, "", u); gsub(/^ +| +$/, "", u); if (u == "") return u; if (index(u, site) == 1 && substr(u, length(site) + 1) ~ /^([\\/?]|$)/) { u = substr(u, length(site) + 1); if (u !~ /^\\//) u = "/" u } q = index(u, "?"); p = q ? substr(u, 1, q - 1) : u; q = q ? substr(u, q) : ""; if (p ~ /.\\/$/) p = substr(p, 1, length(p) - 1); return pct(p q) }',
  /** Every line of the response, as one string in `s`. */
  slurp: '{ gsub(/[\\t\\r\\f]/, " "); s = s " " $0 }',
} as const;

const ANCHOR = '"<[aA][ /][^>]*>"';
const LINK = '"<[lL][iI][nN][kK][ /][^>]*>"';

/** ` | LC_ALL=C awk '<program>' <args>`, the program made of `pieces`. */
function awk(pieces: readonly string[], args: readonly Word[]): Fragment {
  return joined(part` | LC_ALL=C awk ${word(pieces.join(' '))}`, each(args));
}

/** The origin of `page`, as the programs drop it from the front of a URL. */
const siteOf = (page: string): Word => crawledWord(new URL(page).origin, COMMAND_BOUNDS.url_chars);

/**
 * Reads the `<a>` elements of `page`. Passes when one's href is one of `kept` and none's is one of
 * `stale`: the page links to where it should and, when `stale` names where it did, no longer there.
 */
export const linksTo = (
  page: string,
  kept: readonly string[],
  stale: readonly string[] = [],
): Fragment =>
  awk(
    [
      AWK.strip,
      AWK.tags,
      AWK.attr,
      AWK.pct,
      AWK.norm,
      'BEGIN { site = ARGV[1]; n = ARGV[2]; for (i = 3; i < ARGC; i++) if (i < 3 + n) stale[norm(ARGV[i])] = 1; else kept[norm(ARGV[i])] = 1; ARGC = 1 }',
      AWK.slurp,
      `END { n = tags(strip(s), ${ANCHOR}, t); for (i = 1; i <= n; i++) { u = norm(attr(t[i], "href")); if (u in stale) old = 1; if (u in kept) found = 1 } exit !(found && !old) }`,
    ],
    [siteOf(page), int(stale.length), ...stale.map(url), ...kept.map(url)],
  );

/**
 * Reads the `<link>` elements in the head of `page`. Passes when one, and no more than one, has
 * `rel="canonical"`, and its href is `expected`.
 */
export const canonicalIs = (page: string, expected: string): Fragment =>
  awk(
    [
      AWK.strip,
      AWK.head,
      AWK.tags,
      AWK.attr,
      AWK.pct,
      AWK.norm,
      'BEGIN { site = ARGV[1]; want = norm(ARGV[2]); ARGC = 1 }',
      AWK.slurp,
      `END { n = tags(head(strip(s)), ${LINK}, t); for (i = 1; i <= n; i++) if (tolower(attr(t[i], "rel")) == "canonical") { c++; if (norm(attr(t[i], "href")) == want) found = 1 } exit !(c == 1 && found) }`,
    ],
    [siteOf(page), url(expected)],
  );

export interface HreflangNeeds {
  /** The page read, which must list itself under a value shaped like a language code. */
  self: string;
  /** Whether the page must hold an `x-default`. */
  fallback: boolean;
  /** URLs the annotations must name. */
  must: readonly string[];
  /** Values the annotations must no longer carry. */
  goneValues: readonly Word[];
  /** URLs the annotations must no longer name. */
  goneUrls: readonly string[];
}

/**
 * Reads the hreflang annotations in the head of `needs.self`: each `<link>` whose rel holds
 * `alternate` and that has an hreflang. Passes when the page is named under a value shaped like a
 * language code (two letters, then an optional four-letter script and an optional two-letter region;
 * the registry of codes is not consulted), no other value has another shape than that or `x-default`,
 * each of `must` is named, none of the gone values or URLs is there, and, when `fallback` is asked
 * for, an `x-default` is.
 */
export const hreflangHolds = (needs: HreflangNeeds): Fragment =>
  awk(
    [
      AWK.strip,
      AWK.head,
      AWK.tags,
      AWK.attr,
      AWK.pct,
      AWK.norm,
      'BEGIN { site = ARGV[1]; need = ARGV[2]; self = norm(ARGV[3]); n = ARGV[4]; for (i = 5; i < ARGC; i++) if (i < 5 + n) must[norm(ARGV[i])] = 1; else { gone[ARGV[i]] = 1; gone[norm(ARGV[i])] = 1 } ARGC = 1 }',
      AWK.slurp,
      `END { n = tags(head(strip(s)), ${LINK}, t); for (i = 1; i <= n; i++) { v = attr(t[i], "hreflang"); if (v == "" || (" " tolower(attr(t[i], "rel")) " ") !~ / alternate /) continue; u = norm(attr(t[i], "href")); if (tolower(v) == "x-default") fallback = 1; else if (tolower(v) !~ /^[a-z][a-z](-[a-z][a-z][a-z][a-z])?(-[a-z][a-z])?$/) bad = 1; else if (u == self) own = 1; delete must[u]; if (v in gone || u in gone) bad = 1 } for (m in must) bad = 1; exit !(own && (fallback || !need) && !bad) }`,
    ],
    [
      siteOf(needs.self),
      int(needs.fallback ? 1 : 0),
      url(needs.self),
      int(needs.must.length),
      ...needs.must.map(url),
      ...needs.goneValues,
      ...needs.goneUrls.map(url),
    ],
  );

/**
 * Reads the text of the `<a>` elements of `page`, tags inside a link removed and spaces collapsed,
 * the first link to each target only: the crawl keeps one text for a target, the first. Passes when
 * the page has such a link and the text of none is one of `texts`, compared without case.
 */
export const noLinkSays = (page: string, texts: readonly Word[]): Fragment =>
  awk(
    [
      AWK.strip,
      AWK.attr,
      AWK.pct,
      AWK.norm,
      'BEGIN { site = ARGV[1]; for (i = 2; i < ARGC; i++) generic[tolower(ARGV[i])] = 1; ARGC = 1 }',
      AWK.slurp,
      'END { s = strip(s); while (match(s, /<[aA][ \\/][^>]*>/)) { x = substr(s, RSTART, RLENGTH); s = substr(s, RSTART + RLENGTH); u = attr(x, "href"); i = match(tolower(s), /<\\/a[ >]/); x = i ? substr(s, 1, i - 1) : s; if (u == "" || norm(u) in seen) continue; seen[norm(u)] = 1; n++; gsub(/<[^>]*>/, "", x); gsub(/&nbsp;|&#0*160;|&#[xX]0*[aA]0;|\\302\\240/, " ", x); gsub(/  +/, " ", x); gsub(/^ | $/, "", x); if (tolower(x) in generic) left++ } exit !(n > 0 && !left) }',
    ],
    [siteOf(page), ...texts],
  );

/**
 * Reads the link targets of two pages fetched with `fetchOf`: the first page of a list, then a later
 * one. Passes when each links somewhere the other does not, leaving out `first` itself and any target
 * holding `listMark`, which marks another page of the same list. A later page that serves the first
 * page's items again has every link the first has, whatever else it adds.
 */
export const listsDiffer = (first: string, listMark: Word): Fragment =>
  awk(
    [
      AWK.strip,
      AWK.tags,
      AWK.attr,
      AWK.pct,
      AWK.norm,
      'function own(u) { return u != "" && u != self && index(u, mark) == 0 }',
      'BEGIN { site = ARGV[1]; mark = pct(ARGV[2]); self = norm(ARGV[3]); ARGC = 1 }',
      `$0 == "${PAGE_END}" { page++; next }`,
      '{ gsub(/[\\t\\r\\f]/, " "); p[page + 0] = p[page + 0] " " $0 }',
      `END { n = tags(strip(p[0]), ${ANCHOR}, t); for (i = 1; i <= n; i++) a[norm(attr(t[i], "href"))] = 1; n = tags(strip(p[1]), ${ANCHOR}, t); for (i = 1; i <= n; i++) { u = norm(attr(t[i], "href")); b[u] = 1; if (own(u) && !(u in a)) fresh = 1 } for (u in a) if (own(u) && !(u in b)) gone = 1; exit !(page == 2 && fresh && gone) }`,
    ],
    [siteOf(first), listMark, url(first)],
  );

/** `a && b`: both commands pass. */
export const both = (a: Fragment, b: Fragment): Fragment => joined(a, part` && `, b);
