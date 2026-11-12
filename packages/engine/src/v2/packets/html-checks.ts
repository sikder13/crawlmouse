/**
 * The pieces the structure packets' verify commands are made of: one `curl` of a page as a crawler the
 * site serves, at the address the page's content was read at (served-at.ts `readAt`), piped through
 * `tr` (the response as one line) to one `awk` program that reads the HTML and exits 0 when the fix is
 * there. `curl -f` writes no body for a status of 400 or more, so an error page that carries the tag
 * does not pass; `--compressed` reads a response the server compressed.
 *
 * What the programs read (`AWK`):
 *   - Tags, split from text in one pass (`scan`). A `>` inside a quoted attribute value does not end
 *     its tag. Comments and the bodies of script, style, template, textarea and title elements are not
 *     read. A tag whose quotes do not close within a few `<` stops the reading, and the command exits
 *     non-zero (`odd`).
 *   - Attributes, one by one from the tag (`attrs`): the first of a name counts, in double quotes, in
 *     single quotes or unquoted. Character references are read when numeric, or one of the named ones
 *     in `ent`; another named reference is left as written and reported (`unk`).
 *   - A URL is resolved as a browser resolves it (`res`): against the address requested, or the
 *     page's first `<base href>`; document-relative, root-relative, protocol-relative and absolute; a
 *     backslash before the query as a slash; dot segments removed; scheme and host in lower case, a
 *     default port dropped. The engine's own reader resolves against the page and ignores `<base>`.
 *   - Two URLs are one when `norm` gives one string: empty path segments and the slash that ends a
 *     path dropped, the query's parameters sorted (an empty query is none, `a` is `a=`), and
 *     percent-escapes decoded, except those of `/ ? # % & = +` and NUL, which stay escaped, in upper
 *     case. So `/p` and `/p/` are one target, as the engine files them, and so are `/café` and
 *     `/caf%C3%A9`; `/a/b` and `/a%2Fb` are two. This joins some URLs the engine keeps apart (`/x~y` and
 *     `/x%7Ey`): `sameInCommand` tells a builder when two of its URLs are one to the programs. A host
 *     written in Unicode is not converted to its ASCII form.
 *   - The head (`hd`) ends at the first tag that is not html, head, base, link, meta or noscript, or
 *     at text: a `<link>` after it is in the body, where search engines do not read a canonical or an
 *     hreflang annotation.
 *
 * A command is built from `Fragment`s: the words of a fragment are this module's, and each value in
 * one is a shell word made by shell.ts, so `command` hands `sh` the same two kinds of thing a
 * template literal would. An awk program is text of ours and holds no apostrophe (`\047` is one).
 * The programs run under `LC_ALL=C`, where awk's `%c` writes a byte.
 */
import { canonicalizeUrl } from '../../url-canonical.js';
import { MAX_URL_LENGTH } from '../batch-bounds.js';
import { userAgentOf, verifyCrawler } from './crawler.js';
import { readAt } from './served-at.js';
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

/** What a command that reads a page asks of curl: no body for an error status, and a compressed response read. */
const READ = part` -f --compressed`;

/**
 * `requestOf` for `pages` of the check, each at the address its content was read at (served-at.ts
 * `readAt`), for a program of this module to read.
 */
export const fetchOf = (
  facts: Pick<PacketFacts, 'crawlers' | 'pages'>,
  pages: readonly string[],
): Fetch =>
  requestOf(
    facts,
    pages.map((page) => readAt(facts, page)),
    READ,
  );

/**
 * The same request without the options a program needs: what a "see it" command pipes to `grep`
 * (types.ts `See`).
 */
export const printOf = (
  facts: Pick<PacketFacts, 'crawlers' | 'pages'>,
  pages: readonly string[],
): Fetch =>
  requestOf(
    facts,
    pages.map((page) => readAt(facts, page)),
  );

/** The escapes `norm` leaves escaped: the characters that divide a URL, and NUL. */
const KEPT_ESCAPES = ['00', '23', '25', '26', '2B', '2F', '3D', '3F'] as const;

/** The awk functions the programs are written from. */
const AWK = {
  /** The number a string of hex digits writes; 0 when it is longer than a code point's. */
  hexv: String.raw`function hexv(h, i, n) { n = 0; h = tolower(h); sub(/^0+/, "", h); if (length(h) > 6) return 0; for (i = 1; i <= length(h); i++) n = n * 16 + index("0123456789abcdef", substr(h, i, 1)) - 1; return n }`,
  /** The UTF-8 bytes of code point `n`; of U+FFFD when it is none. */
  chr: String.raw`function chr(n) { if (n < 1 || n > 1114111) n = 65533; if (n < 128) return sprintf("%c", n); if (n < 2048) return sprintf("%c%c", 192 + int(n / 64), 128 + n % 64); if (n < 65536) return sprintf("%c%c%c", 224 + int(n / 4096), 128 + int(n / 64) % 64, 128 + n % 64); return sprintf("%c%c%c%c", 240 + int(n / 262144), 128 + int(n / 4096) % 64, 128 + int(n / 64) % 64, 128 + n % 64) }`,
  /**
   * `v` with its character references read: numeric ones, and the named ones listed. Another named
   * reference stays as written, and sets `unk`.
   */
  ent: String.raw`function ent(v, o, r, e) { if (index(v, "&") == 0) return v; e = " amp=38 lt=60 gt=62 quot=34 apos=39 nbsp=160 hellip=8230 rarr=8594 larr=8592 raquo=187 laquo=171 mdash=8212 ndash=8211 rsquo=8217 lsquo=8216 rdquo=8221 ldquo=8220 copy=169 reg=174 trade=8482 middot=183 bull=8226 times=215 "; o = ""; while (match(v, /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[a-zA-Z][a-zA-Z0-9]*;)/)) { r = substr(v, RSTART + 1, RLENGTH - 1); sub(/;$/, "", r); o = o substr(v, 1, RSTART - 1); v = substr(v, RSTART + RLENGTH); if (r ~ /^#[xX]/) o = o chr(hexv(substr(r, 3))); else if (r ~ /^#/) { sub(/^#0*/, "", r); o = o chr(length(r) > 7 ? 0 : r + 0) } else if (match(e, " " r "=[0-9]+ ")) o = o chr(substr(e, RSTART + length(r) + 2, RLENGTH - length(r) - 3) + 0); else { unk = 1; o = o "&" r ";" } } return o v }`,
  /** Where the tag that starts `t` ends: its first `>` outside a quoted attribute value; 0 when it has none. */
  tend: String.raw`function tend(t, p, r, q, i) { p = 0; while (match(t, /= *["\047]|>/)) { if (substr(t, RSTART, 1) == ">") return p + RSTART; q = substr(t, RSTART + RLENGTH - 1, 1); r = substr(t, RSTART + RLENGTH); i = index(r, q); if (!i) return 0; p += RSTART + RLENGTH - 1 + i; t = substr(r, i + 1) } return 0 }`,
  /**
   * The tags of `s` into `T[1..N]`, and the text after each into `X` (`X[0]` before the first), in one
   * pass over the pieces `<` divides `s` into. Comments, markup declarations and the bodies of the
   * elements whose content is not markup are left out. `odd` is set when a tag does not end.
   */
  scan: String.raw`function scan(s, c, m, i, b, e, j, k) { N = 0; m = split(s, c, "<"); X[0] = c[1]; for (i = 2; i <= m; i++) { b = c[i]; if (substr(b, 1, 3) == "!--") { b = substr(b, 4); if (b ~ /^-?>/) { X[N] = X[N] substr(b, index(b, ">") + 1); continue } e = index(b, "-->"); while (!e && i < m) { b = c[++i]; e = index(b, "-->") } if (e) X[N] = X[N] substr(b, e + 3); continue } if (b !~ /^[a-zA-Z\/!?]/) { X[N] = X[N] "<" b; continue } if (b ~ /^[!?]|^\/[^a-zA-Z]/) { e = index(b, ">"); while (!e && i < m) { b = c[++i]; e = index(b, ">") } if (e) X[N] = X[N] substr(b, e + 1); continue } j = 0; while (!(e = tend(b)) && i < m && j++ < 8) b = b "<" c[++i]; if (!e) { odd = i < m; break } if (match(tolower(substr(b, 1, 9)), /^(script|style|template|textarea|title)[ \/>]/)) { k = "/" substr(b, 1, RLENGTH - 1); e = 0; while (!e && i < m) { b = c[++i]; if (tolower(substr(b, 1, length(k))) == tolower(k) && substr(b, length(k) + 1, 1) ~ /^[ \/>]?$/) e = index(b, ">") } if (e) X[N] = X[N] substr(b, e + 1); continue } T[++N] = "<" substr(b, 1, e); X[N] = substr(b, e + 1) } }`,
  /** The attributes of tag `t` into `a`, by name in lower case, as written; the first of a name counts. */
  attrs: String.raw`function attrs(t, a, k, v, q, i) { split("", a); sub(/^<[^ \/>]*/, "", t); while (1) { sub(/^[ \/]+/, "", t); if (t == "" || substr(t, 1, 1) == ">") return; match(t, /^.[^ =\/>]*/); k = tolower(substr(t, 1, RLENGTH)); t = substr(t, RLENGTH + 1); sub(/^ +/, "", t); v = ""; if (substr(t, 1, 1) == "=") { t = substr(t, 2); sub(/^ +/, "", t); q = substr(t, 1, 1); if (q == "\"" || q == "\047") { t = substr(t, 2); i = index(t, q); v = i ? substr(t, 1, i - 1) : t; t = i ? substr(t, i + 1) : "" } else { match(t, /^[^ >]*/); v = substr(t, 1, RLENGTH); t = substr(t, RLENGTH + 1) } } if (!(k in a)) a[k] = v } }`,
  /** `u` with its percent-escapes decoded, but for `KEPT_ESCAPES`, which are written in upper case. */
  dec: `function dec(u, o, h) { if (index(u, "%") == 0) return u; o = ""; while (match(u, /%[0-9A-Fa-f][0-9A-Fa-f]/)) { h = toupper(substr(u, RSTART + 1, 2)); o = o substr(u, 1, RSTART - 1) (h ~ /^(${KEPT_ESCAPES.join('|')})$/ ? "%" h : sprintf("%c", hexv(h))); u = substr(u, RSTART + 3) } return o u }`,
  /**
   * Resolves `u` against the base (`bs` scheme, `bo` origin, `bp` path, `bd` directory, `bq` query).
   * For an http or https URL: 1, with `RO` its origin, `RP` its path without dot segments, empty
   * segments or a slash at its end, `RT` whether it ended in one, and `RQ` its query as written. For
   * anything else: 0, with `RX` a string that names no page.
   */
  res: String.raw`function res(u, q, i, h, n, g, k, st, t, hq, sc) { sub(/#.*/, "", u); gsub(/^ +| +$/, "", u); i = index(u, "?"); hq = i > 0; q = i ? substr(u, i) : ""; if (i) u = substr(u, 1, i - 1); sc = bs; if (match(u, /^[a-zA-Z][a-zA-Z0-9+.-]*:/)) { sc = tolower(substr(u, 1, RLENGTH - 1)); t = substr(u, RLENGTH + 1); if (sc != "http" && sc != "https") { RX = sc ":" t q; return 0 } gsub(/\\/, "/", t); if (sc == bs && t !~ /^\/\//) u = t; else { sub(/^\/*/, "", t); u = "//" t } } else gsub(/\\/, "/", u); if (u ~ /^\/\//) { sub(/^\/+/, "", u); i = index(u, "/"); h = i ? substr(u, 1, i - 1) : u; u = i ? substr(u, i) : "/"; sub(/^.*@/, "", h); h = tolower(h); if (sc == "http") sub(/:0*80$/, "", h); else sub(/:0*443$/, "", h); sub(/:$/, "", h); if (h == "" || sc == "") { RX = "!"; return 0 } RO = sc "://" h } else { if (bo == "") { RX = "!"; return 0 } RO = bo; if (u == "") { u = bp; if (!hq) q = bq } else if (u !~ /^\//) u = bd u } n = split(u, g, "/"); k = 0; RT = 0; for (i = 2; i <= n; i++) { t = tolower(g[i]); gsub(/%2e/, ".", t); RT = 1; if (t == "..") { if (k) k-- } else if (t != ".") { st[++k] = g[i]; RT = g[i] == "" } } RP = ""; for (i = 1; i <= k; i++) if (st[i] != "") RP = RP "/" st[i]; RQ = q; return 1 }`,
  /** Makes `u` the base that relative URLs are resolved against. */
  setb: String.raw`function setb(u) { if (!res(u)) return; bo = RO; bs = RO; sub(/:.*/, "", bs); bp = RP; bq = RQ; bd = RP; if (RT) bd = bd "/"; else sub(/[^\/]*$/, "", bd) }`,
  /** The page's first <base href>, when it has one, becomes the base. */
  base: String.raw`function base(i, a) { for (i = 1; i <= N; i++) if (tolower(substr(T[i], 1, 6)) ~ /^<base[ \/]/) { attrs(T[i], a); if ("href" in a) { setb(ent(a["href"])); return } } }`,
  /** A URL as the programs compare it. */
  norm: String.raw`function norm(u, q, n, a, b, i, j, k, t) { if (!res(u)) return RX; q = RQ; u = RO dec(RP); if (q == "") return u; q = substr(q, 2); gsub(/\+/, " ", q); n = split(q, a, "&"); k = 0; for (i = 1; i <= n; i++) if (a[i] != "") { t = dec(a[i]); if (index(t, "=") == 0) t = t "="; for (j = k++; j > 0 && b[j] > t; j--) b[j + 1] = b[j]; b[j + 1] = t } q = ""; for (i = 1; i <= k; i++) q = q "&" b[i]; return k ? u "?" substr(q, 2) : u }`,
  /** How many of the tags, from the first, are in the head. */
  hd: String.raw`function hd(i) { for (i = 1; i <= N; i++) { if (tolower(substr(T[i], 1, 12)) !~ /^<\/?(html|head|base|link|meta|noscript)[ \/>]/) return i - 1; if (X[i] ~ /[^ ]/) return i } return N }`,
  /** The whole response, which `tr` made one line. */
  slurp: '{ s = s $0 }',
} as const;

/** The functions every program reads a page with. */
const READER = [
  AWK.hexv,
  AWK.chr,
  AWK.ent,
  AWK.tend,
  AWK.scan,
  AWK.attrs,
  AWK.dec,
  AWK.res,
  AWK.setb,
  AWK.base,
  AWK.norm,
] as const;

/** ` | tr … | LC_ALL=C awk '<program>' <args>`: the response as one line, read by the program made of `pieces`. */
function awk(pieces: readonly string[], args: readonly Word[]): Fragment {
  return joined(
    part` | tr ${word('\\n\\t\\r\\f')} ${word('    ')} | LC_ALL=C awk ${word([...READER, ...pieces].join(' '))}`,
    each(args),
  );
}

/**
 * `target` as the programs compare URLs (`norm`, for an absolute URL): what two URLs of a record must
 * differ in for a program to tell a link to one from a link to the other.
 */
export function compared(target: string): string {
  const parsed = new URL(target);
  const dec = (text: string) =>
    text.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) =>
      KEPT_ESCAPES.some((k) => k === hex.toUpperCase())
        ? `%${hex.toUpperCase()}`
        : String.fromCharCode(parseInt(hex, 16)),
    );
  const path = parsed.pathname
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => `/${segment}`)
    .join('');
  const query = parsed.search
    .slice(1)
    .replaceAll('+', ' ')
    .split('&')
    .filter((pair) => pair !== '')
    .map(dec)
    .map((pair) => (pair.includes('=') ? pair : `${pair}=`))
    .sort();
  return `${parsed.protocol}//${parsed.host}${dec(path)}${query.length === 0 ? '' : `?${query.join('&')}`}`;
}

/** Prints each URL as the programs compare it, one to a line: what the tests hold `compared` to. */
export const normsOf = (urls: readonly string[]): Command =>
  command(
    part`LC_ALL=C awk ${word([...READER, 'BEGIN { for (i = 1; i < ARGC; i++) print norm(ARGV[i]); exit }'].join(' '))}`,
    each(urls.map(url)),
  );

/** Whether a program of this module reads `a` and `b` as one URL, so cannot tell a link to one from a link to the other. */
export function sameInCommand(a: string, b: string): boolean {
  try {
    return compared(wordUrl(a)) === compared(wordUrl(b));
  } catch {
    return false;
  }
}

/** A URL as shell.ts `url` writes it into a command. */
const wordUrl = (target: string): string => url(target).word.slice(1, -1).replaceAll(`'\\''`, "'");

/**
 * Reads the `<a>` elements of `page` (the address requested). Passes when one's href is one of `kept`
 * and none's is one of `stale`: the page links to where it should and, when `stale` names where it
 * did, no longer there. With `stale` given, an href the program cannot read (a named character
 * reference it does not know) counts as a link to a stale URL.
 */
export const linksTo = (
  page: string,
  kept: readonly string[],
  stale: readonly string[] = [],
): Fragment =>
  awk(
    [
      'BEGIN { n = ARGV[2]; for (i = 3; i < ARGC; i++) if (i < 3 + n) stale[norm(ARGV[i])] = 1; else kept[norm(ARGV[i])] = 1; setb(ARGV[1]); ARGC = 1 }',
      AWK.slurp,
      String.raw`END { scan(s); base(); for (i = 1; i <= N; i++) if (T[i] ~ /^<[aA][ \/]/) { attrs(T[i], a); if (!("href" in a)) continue; unk = 0; u = norm(ent(a["href"])); if (u in stale || (unk && n > 0)) old = 1; if (u in kept) found = 1 } exit !(found && !old && !odd) }`,
    ],
    [url(page), int(stale.length), ...stale.map(url), ...kept.map(url)],
  );

/**
 * Reads the `<link>` elements in the head of `page` (the address requested). Passes when one, and no
 * more than one, has `rel="canonical"`, and its href is `expected`.
 */
export const canonicalIs = (page: string, expected: string): Fragment =>
  awk(
    [
      AWK.hd,
      'BEGIN { want = norm(ARGV[2]); setb(ARGV[1]); ARGC = 1 }',
      AWK.slurp,
      String.raw`END { scan(s); base(); h = hd(); for (i = 1; i <= h; i++) if (tolower(substr(T[i], 1, 6)) ~ /^<link[ \/]/) { attrs(T[i], a); if (tolower(a["rel"]) == "canonical") { c++; if (norm(ent(a["href"])) == want) found = 1 } } exit !(c == 1 && found && !odd) }`,
    ],
    [url(page), url(expected)],
  );

export interface HreflangNeeds {
  /** The address requested, when it is another than `self`. */
  page?: string;
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
 * Reads the hreflang annotations in the head of `needs.page`: each `<link>` whose rel holds
 * `alternate` and that has an hreflang. Passes when the page is named under a value shaped like a
 * language code (two letters, then an optional four-letter script and an optional two-letter region;
 * the registry of codes is not consulted), no other value has another shape than that or `x-default`,
 * each of `must` is named, none of the gone values or URLs is there, and, when `fallback` is asked
 * for, an `x-default` is.
 */
export const hreflangHolds = (needs: HreflangNeeds): Fragment =>
  awk(
    [
      AWK.hd,
      'BEGIN { need = ARGV[2]; self = norm(ARGV[3]); n = ARGV[4]; for (i = 5; i < ARGC; i++) if (i < 5 + n) must[norm(ARGV[i])] = 1; else { gone[ARGV[i]] = 1; gone[norm(ARGV[i])] = 1 } setb(ARGV[1]); ARGC = 1 }',
      AWK.slurp,
      String.raw`END { scan(s); base(); h = hd(); for (i = 1; i <= h; i++) { if (tolower(substr(T[i], 1, 6)) !~ /^<link[ \/]/) continue; attrs(T[i], a); v = ent(a["hreflang"]); if (v == "" || (" " tolower(a["rel"]) " ") !~ / alternate /) continue; u = norm(ent(a["href"])); if (tolower(v) == "x-default") fallback = 1; else if (tolower(v) !~ /^[a-z][a-z](-[a-z][a-z][a-z][a-z])?(-[a-z][a-z])?$/) bad = 1; else if (u == self) own = 1; delete must[u]; if (v in gone || u in gone) bad = 1 } for (m in must) bad = 1; exit !(own && (fallback || !need) && !bad && !odd) }`,
    ],
    [
      url(needs.page ?? needs.self),
      int(needs.fallback ? 1 : 0),
      url(needs.self),
      int(needs.must.length),
      ...needs.must.map(url),
      ...needs.goneValues,
      ...needs.goneUrls.map(url),
    ],
  );

/**
 * Reads the text of the `<a>` elements of `page` (the address requested), the tags inside a link
 * removed, its character references read, every kind of space made one space and a backtick an
 * apostrophe (text.ts `clean` writes a recorded text so), the first link to each target only: the
 * crawl keeps one text for a target, the first. As the crawl does, it leaves out a link with an empty
 * href or a fragment alone, and one to another site (the host compared without a leading `www.`). Passes when the page has such a link and the text of
 * none is one of `texts`, compared without case.
 */
export const noLinkSays = (page: string, texts: readonly Word[]): Fragment =>
  awk(
    [
      String.raw`function host(u) { if (!match(u, /^https?:\/\/[^\/?]*/)) return ""; u = substr(u, 1, RLENGTH); sub(/^https?:\/\/(www\.)?/, "", u); return u }`,
      'BEGIN { for (i = 2; i < ARGC; i++) generic[tolower(ARGV[i])] = 1; setb(ARGV[1]); here = host(bo); ARGC = 1 }',
      AWK.slurp,
      String.raw`END { scan(s); base(); for (i = 1; i <= N; i++) { if (T[i] !~ /^<[aA][ \/]/) continue; attrs(T[i], a); if (!("href" in a)) continue; h = ent(a["href"]); gsub(/^ +| +$/, "", h); if (h == "" || h ~ /^#/) continue; u = norm(h); if (host(u) != here || (u in seen)) continue; seen[u] = 1; n++; x = X[i]; for (j = i + 1; j <= N && T[j] !~ /^<\/?[aA][ \/>]/; j++) x = x X[j]; x = ent(x); gsub(/\302\240|\341\232\200|\342\200[\200-\212\257]|\342\201\237|\343\200\200/, " ", x); gsub(/\140/, "\047", x); gsub(/  +/, " ", x); gsub(/^ | $/, "", x); if (tolower(x) in generic) left++ } exit !(n > 0 && !left && !odd) }`,
    ],
    [url(page), ...texts],
  );

/**
 * Reads the link targets of two pages fetched with `fetchOf`: the first page of a list, then a later
 * one (`first` and `later` are the addresses requested). Passes when each links somewhere the other
 * does not, leaving out `first` itself and any target holding `listMark`, which marks another page of
 * the same list. A later page that serves the first page's items again has every link the first has,
 * whatever else it adds.
 */
export const listsDiffer = (first: string, later: string, listMark: Word): Fragment =>
  awk(
    [
      'function own(u) { return u != self && index(u, mark) == 0 }',
      String.raw`function hrefs(page, to, i, a) { setb(page); scan(P[page]); base(); for (i = 1; i <= N; i++) if (T[i] ~ /^<[aA][ \/]/) { attrs(T[i], a); if ("href" in a) to[norm(ent(a["href"]))] = 1 } }`,
      `BEGIN { mark = dec(ARGV[1]); self = norm(ARGV[2]); p1 = ARGV[2]; p2 = ARGV[3]; sep = " ${PAGE_END} "; ARGC = 1 }`,
      AWK.slurp,
      'END { i = index(s, sep); if (!i) exit 1; P[p1] = substr(s, 1, i - 1); s = substr(s, i + length(sep)); i = index(s, sep); if (!i) exit 1; P[p2] = substr(s, 1, i - 1); hrefs(p1, A); hrefs(p2, B); for (u in B) if (own(u) && !(u in A)) fresh = 1; for (u in A) if (own(u) && !(u in B)) gone = 1; exit !(fresh && gone && !odd) }',
    ],
    [listMark, url(first), url(later)],
  );

/** `a && b`: both commands pass. */
export const both = (a: Fragment, b: Fragment): Fragment => joined(a, part` && `, b);
