/**
 * The pieces the structure packets' verify commands are made of: one `curl` of a page as a crawler the
 * site serves, at the address the page's content was read at (served-at.ts `readAt`), piped through
 * `tr` (the response as one line: a line break or a tab becomes the byte 1, which the programs read
 * as a space between attributes and remove from a URL, as a browser does) to one `awk` program that
 * reads the HTML and exits 0 when the fix is there. `curl -f` writes no body for a status of 400 or
 * more; `--compressed` reads a response the server compressed; `--max-time` ends a transfer that
 * takes longer than `CURL_SECONDS`; `-w` writes, after each response, a line holding `PAGE_END`, the
 * status and the address requested, which is where the page's relative links start from. A command
 * that asks two things of the pages it fetched asks them in one program (`holds`).
 *
 * The line after each response is how a program tells the pages apart, and a page can print the same
 * words on a line of its own. So a program is told how many pages were requested (`np`), and exits
 * non-zero when the number of such lines is another (`load`): a page that holds one adds to the
 * count. A line whose status is not 200 fails the command too: a redirect whose body carries the
 * tag, or an error page. The address in the line is not compared with the one requested: a page
 * knows its own address, so that would stop no page the count does not. A page that prints
 * `PAGE_END` at the start of a line of its own text does not pass, fixed or not: an `expect` says
 * so (structure.ts `MARKER_LIMIT`). html-checks.test.ts holds the three inputs of the round 3
 * security review to this.
 *
 * What the programs read (`AWK`):
 *   - Tags, split from text in one pass (`scan`). A `>` inside a quoted attribute value does not end
 *     its tag. Comments and the bodies of script, style, template, textarea and title elements are not
 *     read. A tag whose quotes do not close within a few `<`, or that holds more than `MAX_ATTRS`
 *     quoted values, stops the reading, and the command exits non-zero (`odd`).
 *   - Attributes, one by one from the tag (`attrs`): the first of a name counts, in double quotes, in
 *     single quotes or unquoted; more than `MAX_ATTRS` of them on a tag whose attributes are read
 *     (`<a>`, `<link>`, `<base>`) set `odd`. Character references are read when numeric, or one of
 *     the named ones in `ent`; another named reference is left as written and reported (`unk`). A
 *     tab or a line break in a URL is removed, as a browser removes it (`clr`), whether it was typed
 *     or written as a reference.
 *   - What is read is bounded, so that a page cannot keep a developer's terminal busy: the reading
 *     functions copy the rest of a string once for each reference, escape or attribute they find, and
 *     a query's parameters are sorted by insertion. An href longer than `CAP` bytes is not decoded: it
 *     is no recorded URL (the worker keeps none past `MAX_URL_LENGTH`), and counts as a link the
 *     program cannot read (`at`, `unk`). A URL with more than `MAX_PARAMS` query parameters is not
 *     sorted and equals no URL (`big`). The text after a tag is kept up to `CAP` bytes; a text node
 *     that holds more is marked (`V`), which ends the head as text does and makes a link's text one
 *     the program cannot clear (`noLinkSays`).
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
 *   - The head (`hd`) ends at the first tag that is not html, head, base, link or meta, or at text: a
 *     `<link>` after it is in the body, where search engines do not read a canonical or an hreflang
 *     annotation. What is between `<noscript>` and `</noscript>` does not end it: a parser that runs
 *     scripts reads that as text, and the engine's reader reads a canonical after it (the Meta Pixel
 *     snippet puts an `<img>` there). A `<link>` inside a `<noscript>` in the head is read.
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
import { int, sh, url, word, type Command, type Word } from './shell.js';
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
  /** How many pages the request is for. */
  pages: number;
}

/** The seconds a transfer is given before curl ends it. */
export const CURL_SECONDS = 20;

/** The bytes of an href, or of the text after a tag, a program reads; see the module comment. */
export const CAP = 4 * MAX_URL_LENGTH;
/** The query parameters of a URL a program sorts. */
export const MAX_PARAMS = 256;
/** The quoted values a tag may hold, and the attributes of a tag whose attributes are read. */
export const MAX_ATTRS = 128;

/**
 * What `fetchOf` has curl write after each response, before its status and the address it requested:
 * the programs tell the pages apart by it, and learn from it the address a page's relative links
 * start from.
 */
export const PAGE_END = 'crawlmouse:end';

/**
 * `curl` of `urls`, in order and as given, as a crawler the site serves today (crawler.ts). With
 * `marked`, a line holding `PAGE_END`, the status and the address requested is written after each
 * response, for a program of this module. `options` are further curl options of ours.
 */
export function requestOf(
  facts: Pick<PacketFacts, 'crawlers'>,
  urls: readonly string[],
  options: Fragment = NOTHING,
  marked = false,
): Fetch {
  const { fragment, ua } = curlOf(facts, options, marked);
  return { fragment: joined(fragment, each(urls.map(url))), ua, pages: urls.length };
}

/** `curl` and its options, as a crawler the site serves today; the addresses follow. */
function curlOf(
  facts: Pick<PacketFacts, 'crawlers'>,
  options: Fragment,
  marked: boolean,
): Pick<Fetch, 'fragment' | 'ua'> {
  const crawler = verifyCrawler(facts);
  return {
    fragment: joined(
      part`curl -sS`,
      options,
      crawler === null ? NOTHING : part` -A ${word(userAgentOf(crawler))}`,
      marked ? part` -w ${word(`\\n${PAGE_END} %{http_code} %{url_effective}\\n`)}` : NOTHING,
    ),
    ua: crawler?.token ?? null,
  };
}

/** The curl option that ends a transfer after `CURL_SECONDS`. */
export const TIMED: Fragment = { parts: [` --max-time ${CURL_SECONDS}`], values: [] };

/**
 * What a command that reads a page asks of curl: no body for an error status, a compressed response
 * read, and a transfer ended after `CURL_SECONDS`.
 */
const READ = joined(part` -f --compressed`, TIMED);

/** The shell variable a developer names a page of their own choosing in (`fetchOfChosen`). */
export const CHOSEN_PAGE = 'CRAWLMOUSE_PAGE';

/**
 * `fetchOf` for a page the record cannot name: the address is read from the shell variable
 * `CHOSEN_PAGE`. As written the variable is unset, so the shell stops with the message below, curl
 * requests nothing, and the program, given no page, exits non-zero.
 */
export function fetchOfChosen(facts: Pick<PacketFacts, 'crawlers'>): Fetch {
  const { fragment, ua } = curlOf(facts, READ, true);
  return {
    fragment: joined(
      fragment,
      part` "\${CRAWLMOUSE_PAGE:?set it to the URL of the page you added the link to}"`,
    ),
    ua,
    pages: 1,
  };
}

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
    true,
  );

/**
 * The same request without the options a program needs, at the same addresses, with a compressed
 * response read and the same time given: what a "see it" command pipes to `grep` (types.ts `See`).
 */
export const printOf = (
  facts: Pick<PacketFacts, 'crawlers' | 'pages'>,
  pages: readonly string[],
): Fetch =>
  requestOf(
    facts,
    pages.map((page) => readAt(facts, page)),
    joined(part` --compressed`, TIMED),
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
  ent: String.raw`function ent(v, o, r, e) { if (index(v, "&") == 0) return v; e = " Tab=9 NewLine=10 amp=38 lt=60 gt=62 quot=34 apos=39 nbsp=160 hellip=8230 rarr=8594 larr=8592 raquo=187 laquo=171 mdash=8212 ndash=8211 rsquo=8217 lsquo=8216 rdquo=8221 ldquo=8220 copy=169 reg=174 trade=8482 middot=183 bull=8226 times=215 "; o = ""; while (match(v, /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[a-zA-Z][a-zA-Z0-9]*;)/)) { r = substr(v, RSTART + 1, RLENGTH - 1); sub(/;$/, "", r); o = o substr(v, 1, RSTART - 1); v = substr(v, RSTART + RLENGTH); if (r ~ /^#[xX]/) o = o chr(hexv(substr(r, 3))); else if (r ~ /^#/) { sub(/^#0*/, "", r); o = o chr(length(r) > 7 ? 0 : r + 0) } else if (match(e, " " r "=[0-9]+ ")) o = o chr(substr(e, RSTART + length(r) + 2, RLENGTH - length(r) - 3) + 0); else { unk = 1; o = o "&" r ";" } } return o v }`,
  /**
   * Where the tag that starts `t` ends: its first `>` outside a quoted attribute value; 0 when it has
   * none, and when it holds more than `MAX_ATTRS` quoted values before one, which sets `far`.
   */
  tend: String.raw`function tend(t, p, r, q, i, k) { p = 0; while (match(t, /=[ \001]*["\047]|>/)) { if (substr(t, RSTART, 1) == ">") return p + RSTART; if (k++ >= ${MAX_ATTRS}) { far = 1; return 0 } q = substr(t, RSTART + RLENGTH - 1, 1); r = substr(t, RSTART + RLENGTH); i = index(r, q); if (!i) return 0; p += RSTART + RLENGTH - 1 + i; t = substr(r, i + 1) } return 0 }`,
  /** Adds `t` to the text after the last tag, up to `CAP` bytes; text past that marks the tag in `V`. */
  add: String.raw`function add(t) { if (length(X[N]) < ${CAP}) X[N] = X[N] t; else if (t ~ /[^ \001]/) V[N] = 1 }`,
  /**
   * The tags of `s` into `T[1..N]`, and the text after each into `X` (`X[0]` before the first), in one
   * pass over the pieces `<` divides `s` into. Comments, markup declarations and the bodies of the
   * elements whose content is not markup are left out. `odd` is set when a tag does not end.
   */
  scan: String.raw`function scan(s, c, m, i, b, e, j, k) { N = 0; split("", V); m = split(s, c, "<"); X[0] = c[1]; for (i = 2; i <= m; i++) { b = c[i]; if (substr(b, 1, 3) == "!--") { b = substr(b, 4); if (b ~ /^-?>/) { add(substr(b, index(b, ">") + 1)); continue } e = index(b, "-->"); while (!e && i < m) { b = c[++i]; e = index(b, "-->") } if (e) add(substr(b, e + 3)); continue } if (b !~ /^[a-zA-Z\/!?]/) { add("<" b); continue } if (b ~ /^[!?]|^\/[^a-zA-Z]/) { e = index(b, ">"); while (!e && i < m) { b = c[++i]; e = index(b, ">") } if (e) add(substr(b, e + 1)); continue } j = 0; far = 0; while (!(e = tend(b)) && !far && i < m && j++ < 8) b = b "<" c[++i]; if (!e) { odd = far || i < m; break } if (match(tolower(substr(b, 1, 9)), /^(script|style|template|textarea|title)[ \001\/>]/)) { k = "/" substr(b, 1, RLENGTH - 1); e = 0; while (!e && i < m) { b = c[++i]; if (tolower(substr(b, 1, length(k))) == tolower(k) && substr(b, length(k) + 1, 1) ~ /^[ \001\/>]?$/) e = index(b, ">") } if (e) add(substr(b, e + 1)); continue } T[++N] = "<" substr(b, 1, e); X[N] = substr(b, e + 1) } }`,
  /**
   * The attributes of tag `t` into `a`, by name in lower case, as written; the first of a name
   * counts. A tag with more than `MAX_ATTRS` of them sets `odd`.
   */
  attrs: String.raw`function attrs(t, a, k, v, q, i, n) { split("", a); sub(/^<[^ \001\/>]*/, "", t); while (1) { sub(/^[ \001\/]+/, "", t); if (t == "" || substr(t, 1, 1) == ">") return; if (n++ >= ${MAX_ATTRS}) { odd = 1; return } match(t, /^.[^ \001=\/>]*/); k = tolower(substr(t, 1, RLENGTH)); t = substr(t, RLENGTH + 1); sub(/^[ \001]+/, "", t); v = ""; if (substr(t, 1, 1) == "=") { t = substr(t, 2); sub(/^[ \001]+/, "", t); q = substr(t, 1, 1); if (q == "\"" || q == "\047") { t = substr(t, 2); i = index(t, q); v = i ? substr(t, 1, i - 1) : t; t = i ? substr(t, i + 1) : "" } else { match(t, /^[^ \001>]*/); v = substr(t, 1, RLENGTH); t = substr(t, RLENGTH + 1) } } if (!(k in a)) a[k] = v } }`,
  /** `u` with its percent-escapes decoded, but for `KEPT_ESCAPES`, which are written in upper case. */
  dec: `function dec(u, o, h) { if (index(u, "%") == 0) return u; o = ""; while (match(u, /%[0-9A-Fa-f][0-9A-Fa-f]/)) { h = toupper(substr(u, RSTART + 1, 2)); o = o substr(u, 1, RSTART - 1) (h ~ /^(${KEPT_ESCAPES.join('|')})$/ ? "%" h : sprintf("%c", hexv(h))); u = substr(u, RSTART + 3) } return o u }`,
  /** An attribute's value with its character references read, and the tabs and line breaks they wrote removed. */
  clr: String.raw`function clr(v) { v = ent(v); gsub(/[\001\t\n\r]/, "", v); return v }`,
  /**
   * The href `v` of a page, as the programs compare URLs. One longer than `CAP` bytes, or with more
   * query parameters than `norm` sorts, is "?", which is no URL, and sets `unk`.
   */
  at: `function at(v) { big = 0; if (length(v) > ${CAP}) { unk = 1; return "?" } v = norm(clr(v)); if (big) { unk = 1; return "?" } return v }`,
  /** The host of an http or https URL, without a leading `www.`; empty for anything else. */
  host: String.raw`function host(u) { if (!match(u, /^https?:\/\/[^\/?]*/)) return ""; u = substr(u, 1, RLENGTH); sub(/^https?:\/\/(www\.)?/, "", u); return u }`,
  /**
   * `u` resolved and no more: its origin in lower case, its path and its query as written. What two
   * spellings `norm` joins are told apart by.
   */
  spelt: `function spelt(u) { if (!res(u)) return RX; return RO RP (RT ? "/" : "") RQ }`,
  /**
   * Resolves `u` against the base (`bs` scheme, `bo` origin, `bp` path, `bd` directory, `bq` query).
   * For an http or https URL: 1, with `RO` its origin, `RP` its path without dot segments, empty
   * segments or a slash at its end, `RT` whether it ended in one, and `RQ` its query as written. For
   * anything else: 0, with `RX` a string that names no page.
   */
  res: String.raw`function res(u, q, i, h, n, g, k, st, t, hq, sc) { sub(/#.*/, "", u); gsub(/^ +| +$/, "", u); i = index(u, "?"); hq = i > 0; q = i ? substr(u, i) : ""; if (i) u = substr(u, 1, i - 1); sc = bs; if (match(u, /^[a-zA-Z][a-zA-Z0-9+.-]*:/)) { sc = tolower(substr(u, 1, RLENGTH - 1)); t = substr(u, RLENGTH + 1); if (sc != "http" && sc != "https") { RX = sc ":" t q; return 0 } gsub(/\\/, "/", t); if (sc == bs && t !~ /^\/\//) u = t; else { sub(/^\/*/, "", t); u = "//" t } } else gsub(/\\/, "/", u); if (u ~ /^\/\//) { sub(/^\/+/, "", u); i = index(u, "/"); h = i ? substr(u, 1, i - 1) : u; u = i ? substr(u, i) : "/"; sub(/^.*@/, "", h); h = tolower(h); if (sc == "http") sub(/:0*80$/, "", h); else sub(/:0*443$/, "", h); sub(/:$/, "", h); if (h == "" || sc == "") { RX = "!"; return 0 } RO = sc "://" h } else { if (bo == "") { RX = "!"; return 0 } RO = bo; if (u == "") { u = bp; if (!hq) q = bq } else if (u !~ /^\//) u = bd u } n = split(u, g, "/"); k = 0; RT = 0; for (i = 2; i <= n; i++) { t = tolower(g[i]); gsub(/%2e/, ".", t); RT = 1; if (t == "..") { if (k) k-- } else if (t != ".") { st[++k] = g[i]; RT = g[i] == "" } } RP = ""; for (i = 1; i <= k; i++) if (st[i] != "") RP = RP "/" st[i]; RQ = q; return 1 }`,
  /** Makes `u` the base that relative URLs are resolved against. */
  setb: String.raw`function setb(u) { if (!res(u)) return; bo = RO; bs = RO; sub(/:.*/, "", bs); bp = RP; bq = RQ; bd = RP; if (RT) bd = bd "/"; else sub(/[^\/]*$/, "", bd) }`,
  /** The page's first <base href>, when it has one, becomes the base; one longer than `CAP` sets `odd`. */
  base: String.raw`function base(i, a) { for (i = 1; i <= N; i++) if (tolower(substr(T[i], 1, 6)) ~ /^<base[ \001\/]/) { attrs(T[i], a); if ("href" in a) { if (length(a["href"]) > ${CAP}) odd = 1; else setb(clr(a["href"])); return } } }`,
  /**
   * A URL as the programs compare it. One with more than `MAX_PARAMS` query parameters is not
   * sorted: `big` is set, and what is returned is no URL.
   */
  norm: String.raw`function norm(u, q, n, a, b, i, j, k, t) { if (!res(u)) return RX; q = RQ; u = RO dec(RP); if (q == "") return u; q = substr(q, 2); gsub(/\+/, " ", q); n = split(q, a, "&"); if (n > ${MAX_PARAMS}) { big = 1; return "!!" } k = 0; for (i = 1; i <= n; i++) if (a[i] != "") { t = dec(a[i]); if (index(t, "=") == 0) t = t "="; for (j = k++; j > 0 && b[j] > t; j--) b[j + 1] = b[j]; b[j + 1] = t } q = ""; for (i = 1; i <= k; i++) q = q "&" b[i]; return k ? u "?" substr(q, 2) : u }`,
  /**
   * How many of the tags, from the first, are in the head. What is between `<noscript>` and
   * `</noscript>` does not end it.
   */
  hd: String.raw`function hd(i, ns, t) { for (i = 1; i <= N; i++) { t = tolower(substr(T[i], 1, 12)); if (t ~ /^<noscript[ \001\/>]/) ns = 1; else if (t ~ /^<\/noscript[ \001\/>]/) ns = 0; else if (!ns && t !~ /^<\/?(html|head|base|link|meta)[ \001\/>]/) return i - 1; if (!ns && (X[i] ~ /[^ \001]/ || (i in V))) return i } return N }`,
  /** The whole of what curl wrote, which `tr` made one line. */
  slurp: '{ s = s $0 }',
  /**
   * The pages fetched, from what curl wrote: `B[i]` the body of page `i` and `U[i]` the address it
   * was requested at, of `NP` pages. curl writes `PAGE_END`, the status and the address after each
   * body. `odd` is set when there are not `np` such lines, the number of pages requested, or when
   * one does not start with the status 200.
   */
  load: `function load(n, i) { n = split(s, Q, "\\001${PAGE_END} "); NP = n - 1; if (NP != np) odd = 1; B[1] = Q[1]; for (i = 2; i <= n; i++) { if (match(Q[i], /^200 [^ \\001]+/)) { U[i - 1] = substr(Q[i], 5, RLENGTH - 4); B[i] = substr(Q[i], RLENGTH + 1) } else { odd = 1; U[i - 1] = ""; B[i] = "" } } }`,
  /** Reads page \`i\`: its tags, and the base its relative URLs start from. 0 when there is no such page. */
  open: 'function open(i) { if (i > NP) return 0; setb(U[i]); scan(B[i]); base(); return 1 }',
} as const;

/** The functions every program reads a page with. */
const READER = [
  AWK.hexv,
  AWK.chr,
  AWK.ent,
  AWK.tend,
  AWK.add,
  AWK.scan,
  AWK.attrs,
  AWK.dec,
  AWK.res,
  AWK.setb,
  AWK.clr,
  AWK.base,
  AWK.norm,
  AWK.at,
  AWK.load,
  AWK.open,
  'BEGIN { A = 1; np = ARGV[A++] + 0 }',
] as const;

/**
 * One thing a command asks of the pages it fetched: awk functions of ours, the expression that is
 * true when it holds, and the values it reads, which its `BEGIN` takes from the arguments in order
 * (`A` is the next argument).
 */
export interface Check {
  readonly pieces: readonly string[];
  readonly pass: string;
  readonly args: readonly Word[];
}

/**
 * `<the request> | tr … | LC_ALL=C awk '<program>' <args>`: what `fetch` fetched as one line (a NUL
 * made a space too: an awk that ends a string at one would read less than curl wrote), read by one
 * program that exits 0 when every one of `checks` holds and curl wrote one line for each page
 * requested, each with the status 200. One program for all the checks: the functions that read a
 * page are most of a command's length, and are written once.
 */
export function holds(fetch: Fetch, ...checks: readonly Check[]): Fragment {
  const pieces = [...new Set([...READER, ...checks.flatMap((c) => c.pieces)])];
  const end = `END { load(); exit !(${checks.map((c) => c.pass).join(' && ')} && !odd) }`;
  return joined(
    fetch.fragment,
    part` | tr ${word('\\n\\t\\r\\f\\000')} ${word('\\001\\001\\001  ')} | LC_ALL=C awk ${word([...pieces, 'BEGIN { ARGC = 1 }', AWK.slurp, end].join(' '))}`,
    each([int(fetch.pages), ...checks.flatMap((c) => c.args)]),
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
 * Reads the `<a>` elements of a page fetched. Passes when one's href is one of `kept` and none's is
 * one of `stale`: the page links to where it should and, when `stale` names where it did, no longer
 * there. With `stale` given, an href the program cannot read (a named character reference it does
 * not know, or an href longer than `CAP`) counts as a link to a stale URL. `page` is the page's place
 * among those fetched.
 */
export const linksTo = (
  kept: readonly string[],
  stale: readonly string[] = [],
  page = 1,
): Check => ({
  pieces: [
    'BEGIN { ns = ARGV[A++]; for (i = 0; i < ns; i++) stale[norm(ARGV[A++])] = 1; nk = ARGV[A++]; for (i = 0; i < nk; i++) kept[norm(ARGV[A++])] = 1 }',
    String.raw`function links(p, i, a, u, old, found) { if (!open(p)) return 0; for (i = 1; i <= N; i++) if (T[i] ~ /^<[aA][ \001\/]/) { attrs(T[i], a); if (!("href" in a)) continue; unk = 0; u = at(a["href"]); if (u in stale || (unk && ns > 0)) old = 1; if (u in kept) found = 1 } return found && !old }`,
  ],
  pass: `links(${page})`,
  args: [int(stale.length), ...stale.map(url), int(kept.length), ...kept.map(url)],
});

/**
 * Reads the `<a>` elements of a page fetched for a link written as one of `kept`, character for
 * character once it is resolved (`spelt`): for a page whose old and new URL the programs read as one
 * (`sameInCommand`), where `linksTo` would pass before the fix. Passes when one href is spelled as
 * one of `kept`, and no href that `norm` reads as one of them is spelled another way; an href the
 * program cannot read counts as one spelled another way.
 */
export const linksSpelled = (kept: readonly string[], page = 1): Check => ({
  pieces: [
    AWK.spelt,
    'BEGIN { nx = ARGV[A++]; for (i = 0; i < nx; i++) { exact[spelt(ARGV[A])] = 1; alike[norm(ARGV[A++])] = 1 } }',
    String.raw`function spelled(p, i, a, u, old, found) { if (!open(p)) return 0; for (i = 1; i <= N; i++) if (T[i] ~ /^<[aA][ \001\/]/) { attrs(T[i], a); if (!("href" in a)) continue; unk = 0; u = at(a["href"]); if (unk) old = 1; else if (u in alike) { if (spelt(clr(a["href"])) in exact) found = 1; else old = 1 } } return found && !old }`,
  ],
  pass: `spelled(${page})`,
  args: [int(kept.length), ...kept.map(url)],
});

/**
 * How `canonicalIs` compares the href with the URL expected: as the programs compare URLs (`alike`);
 * so, and ending its path as the expected one does, with a slash or without (`slashed`), for a page
 * whose other spelling is known to redirect; or as it is spelled once resolved (`spelled`), for an
 * expected URL the programs read as one with the URL declared today.
 */
export type CanonicalMatch = 'alike' | 'slashed' | 'spelled';

/**
 * Reads the `<link>` elements in the head of a page fetched. Passes when one, and no more than one,
 * has `rel="canonical"`, and its href is `expected`, compared as `match` says.
 */
export const canonicalIs = (
  expected: string,
  page = 1,
  match: CanonicalMatch = 'alike',
): Check => ({
  pieces: [
    AWK.hd,
    AWK.spelt,
    'BEGIN { want = norm(ARGV[A]); ws = RT; wx = spelt(ARGV[A++]); how = ARGV[A++] + 0 }',
    String.raw`function canon(p, i, a, h, c, u, found) { if (!open(p)) return 0; h = hd(); for (i = 1; i <= h; i++) if (tolower(substr(T[i], 1, 6)) ~ /^<link[ \001\/]/) { attrs(T[i], a); gsub(/\001/, " ", a["rel"]); gsub(/^ +| +$/, "", a["rel"]); if (tolower(a["rel"]) == "canonical") { c++; unk = 0; u = at(a["href"]); if (u == want && (how < 1 || RT == ws) && (how < 2 || (!unk && spelt(clr(a["href"])) == wx))) found = 1 } } return c == 1 && found }`,
  ],
  pass: `canon(${page})`,
  args: [url(expected), int(match === 'alike' ? 0 : match === 'slashed' ? 1 : 2)],
});

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
 * Reads the hreflang annotations in the head of a page fetched: each `<link>` whose rel holds
 * `alternate` and that has an hreflang. Passes when the page is named under a value shaped like a
 * language code (two letters, then an optional four-letter script and an optional two-letter region;
 * the registry of codes is not consulted), no other value has another shape than that or `x-default`,
 * each of `must` is named, none of the gone values or URLs is there, and, when `fallback` is asked
 * for, an `x-default` is.
 */
export const hreflangHolds = (needs: HreflangNeeds, page = 1): Check => ({
  pieces: [
    AWK.hd,
    'BEGIN { need = ARGV[A++]; self = norm(ARGV[A++]); nm = ARGV[A++]; for (i = 0; i < nm; i++) must[norm(ARGV[A++])] = 1; ng = ARGV[A++]; for (i = 0; i < ng; i++) { gone[ARGV[A]] = 1; gone[norm(ARGV[A++])] = 1 } }',
    String.raw`function langs(p, i, a, h, v, u, m, own, fallback, bad) { if (!open(p)) return 0; h = hd(); for (i = 1; i <= h; i++) { if (tolower(substr(T[i], 1, 6)) !~ /^<link[ \001\/]/) continue; attrs(T[i], a); gsub(/\001/, " ", a["rel"]); v = length(a["hreflang"]) > ${CAP} ? "?" : ent(a["hreflang"]); if (v == "" || (" " tolower(a["rel"]) " ") !~ / alternate /) continue; u = at(a["href"]); if (tolower(v) == "x-default") fallback = 1; else if (tolower(v) !~ /^[a-z][a-z](-[a-z][a-z][a-z][a-z])?(-[a-z][a-z])?$/) bad = 1; else if (u == self) own = 1; delete must[u]; if (v in gone || u in gone) bad = 1 } for (m in must) bad = 1; return own && (fallback || !need) && !bad }`,
  ],
  pass: `langs(${page})`,
  args: [
    int(needs.fallback ? 1 : 0),
    url(needs.self),
    int(needs.must.length),
    ...needs.must.map(url),
    int(needs.goneValues.length + needs.goneUrls.length),
    ...needs.goneValues,
    ...needs.goneUrls.map(url),
  ],
});

/**
 * Reads the text of the `<a>` elements of a page fetched, the tags inside a link removed, its
 * character references read, every kind of space made one space and a backtick an apostrophe
 * (text.ts `clean` writes a recorded text so), the first link to each target only: the crawl keeps
 * one text for a target, the first. As the crawl does, it leaves out a link with an empty href or a
 * fragment alone, and one to another site (the host compared without a leading `www.`). Passes when
 * the page has such a link and the text of none is one of `texts`, compared without case. A link
 * whose text is longer than `CAP` bytes is not read, and counts as one of `texts`; a link whose href
 * is longer than that is no recorded link, and is left out.
 */
export const noLinkSays = (texts: readonly Word[], page = 1): Check => ({
  pieces: [
    AWK.host,
    'BEGIN { nt = ARGV[A++]; for (i = 0; i < nt; i++) generic[tolower(ARGV[A++])] = 1 }',
    String.raw`function says(p, i, j, a, h, u, x, n, left, here, seen, over) { if (!open(p)) return 0; here = host(U[p]); for (i = 1; i <= N; i++) { if (T[i] !~ /^<[aA][ \001\/]/) continue; attrs(T[i], a); if (!("href" in a)) continue; h = a["href"]; if (length(h) > ${CAP}) continue; h = clr(h); gsub(/^ +| +$/, "", h); if (h == "" || h ~ /^#/) continue; big = 0; u = norm(h); if (big || host(u) != here || (u in seen)) continue; seen[u] = 1; n++; x = X[i]; over = (i in V) || length(x) > ${CAP}; for (j = i + 1; j <= N && T[j] !~ /^<\/?[aA][ \001\/>]/; j++) if (!over) { if ((j in V) || length(x) > ${CAP}) over = 1; else x = x X[j] } if (!over) { gsub(/[ \001]+/, " ", x); over = length(x) > ${CAP} } if (over) { left++; continue } x = ent(x); gsub(/[\t\n\r\f]|\302\240|\341\232\200|\342\200[\200-\212\257]|\342\201\237|\343\200\200/, " ", x); gsub(/\140/, "\047", x); gsub(/  +/, " ", x); gsub(/^ | $/, "", x); if (tolower(x) in generic) left++ } return n > 0 && !left }`,
  ],
  pass: `says(${page})`,
  args: [int(texts.length), ...texts],
});

/**
 * Reads the link targets of the two pages fetched: the first page of a list, then a later one.
 * Passes when each links to two pages or more of its own site that the other does not link to,
 * leaving out the first page itself and any target holding `listMark`, which marks another page of
 * the same list. A later page that serves the first page's items again has every link the first
 * has, whatever else it adds; one link of its own (a banner, a link to the whole list) is not a page
 * of other items, and a link to another site, or one that is no page, is not counted at all.
 */
export const listsDiffer = (listMark: Word): Check => ({
  pieces: [
    AWK.host,
    'BEGIN { mark = dec(ARGV[A++]) }',
    String.raw`function hrefs(p, to, i, a, u, here) { if (!open(p)) return 0; here = host(U[p]); for (i = 1; i <= N; i++) if (T[i] ~ /^<[aA][ \001\/]/) { attrs(T[i], a); if ("href" in a) { u = at(a["href"]); if (host(u) == here) to[u] = 1 } } return 1 }`,
    'function differ(u, self, fresh, lost, P1, P2) { if (!hrefs(1, P1) || !hrefs(2, P2)) return 0; self = norm(U[1]); for (u in P2) if (u != self && index(u, mark) == 0 && !(u in P1)) fresh++; for (u in P1) if (u != self && index(u, mark) == 0 && !(u in P2)) lost++; return fresh > 1 && lost > 1 }',
  ],
  pass: 'differ()',
  args: [listMark],
});
