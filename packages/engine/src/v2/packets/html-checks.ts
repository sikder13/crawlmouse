/**
 * The pieces the structure packets' verify commands are made of: one `curl` of a page as a crawler the
 * site serves, a pipeline that pulls one kind of thing out of the HTML (link targets, link texts, the
 * canonical, the hreflang annotations), and a last stage that exits 0 when the fix is there.
 *
 * What the pipelines read, and what they do not. They read the HTML as served, with `grep`, `sed` and
 * `awk`: an attribute value in single or double quotes (`\\047` is the apostrophe, for `tr`), on a tag that may span lines. An unquoted
 * attribute value is not read, so a page written that way fails its command. A link target is
 * compared as written, after `&amp;` is read as `&`, a fragment is dropped and a trailing slash is
 * dropped; the record's URL is compared in full and from the root (`hrefForms`), in the engine's
 * spelling, whose query is sorted. A page that spells a multi-parameter query in another order does
 * not match.
 *
 * A command is built from `Fragment`s: the words of a fragment are this module's, and each value in
 * one is a shell word made by shell.ts, so `command` hands `sh` the same two kinds of thing a
 * template literal would.
 */
import { canonicalizeUrl } from '../../url-canonical.js';
import { userAgentOf, verifyCrawler } from './crawler.js';
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

/** `values`, each after `before` (" -e " gives ` -e 'a' -e 'b'`). */
function each(before: ' ' | ' -e ', values: readonly Word[]): Fragment {
  return { parts: [...values.map(() => before), ''], values };
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

/** The longest URL the worker stores is 2048 characters; a URL in a command is not cut short of it. */
const MAX_URL_CHARS = 2048;

/** A URL in the engine's spelling; as given when it does not parse. */
export function spelled(target: string): string {
  try {
    return canonicalizeUrl(target);
  } catch {
    return target;
  }
}

/** The two spellings of `target` a page's link to it is matched against: in full, and from the root. */
export function hrefForms(target: string): Word[] {
  const full = spelled(target);
  const parsed = new URL(full);
  return [full, `${parsed.pathname}${parsed.search}`].map((s) => crawledWord(s, MAX_URL_CHARS));
}

export interface Fetch {
  fragment: Fragment;
  /** The registry token of the crawler requested as; null when the site serves none we can name. */
  ua: string | null;
}

/** What `fetchOf` writes after each page when a command reads two: a link no site has (`linksBeyondFirst` reads it). */
export const PAGE_END = 'crawlmouse:end';

/**
 * `curl` of `pages`, in order, as a crawler the site serves today (crawler.ts). With more than one
 * page, an anchor to `PAGE_END` is written after each response, so the pipeline can tell them apart.
 * `options` are further curl options of ours.
 */
export function fetchOf(
  facts: Pick<PacketFacts, 'crawlers'>,
  pages: readonly string[],
  options: Fragment = NOTHING,
): Fetch {
  const crawler = verifyCrawler(facts);
  return {
    fragment: joined(
      part`curl -sS`,
      options,
      crawler === null ? NOTHING : part` -A ${word(userAgentOf(crawler))}`,
      pages.length > 1 ? part` -w ${word(`<a href="${PAGE_END}">`)}` : NOTHING,
      each(' ', pages.map(url)),
    ),
    ua: crawler?.token ?? null,
  };
}

/** The target of each `<a>` on the page, one to a line. */
export const ANCHOR_HREFS = part` | tr '\\n\\r\\t\\047' '   "' | grep -oiE '<a[[:space:]][^>]*>' | grep -oiE '[[:space:]]href="[^"]*"' | sed -e 's/^.[Hh][Rr][Ee][Ff]="//' -e 's/"$//' -e 's/&amp;/\\&/g' -e 's/#.*$//' -e 's:\\(.\\)/$:\\1:'`;

/** The target of the page's first `<link rel="canonical">`; nothing when it has none. */
export const CANONICAL_HREF = part` | tr '\\n\\r\\t\\047' '   "' | grep -oiE '<link[^>]*[[:space:]]rel="canonical"[^>]*>' | head -n 1 | grep -oiE '[[:space:]]href="[^"]*"' | sed -e 's/^.[Hh][Rr][Ee][Ff]="//' -e 's/"$//' -e 's/&amp;/\\&/g' -e 's/#.*$//' -e 's:\\(.\\)/$:\\1:'`;

/** Each hreflang annotation in the page, one to a line: the value, a space, the target. */
export const HREFLANG_PAIRS = part` | tr '\\n\\r\\t\\047' '   "' | grep -oiE '<link[^>]*[[:space:]]hreflang="[^"]*"[^>]*>' | sed -e 's/.*[[:space:]]hreflang="\\([^"]*\\)".*[[:space:]]href="\\([^"]*\\)".*/\\1 \\2/' -e 's/.*[[:space:]]href="\\([^"]*\\)".*[[:space:]]hreflang="\\([^"]*\\)".*/\\2 \\1/' -e 's/&amp;/\\&/g' -e 's/#.*$//' -e 's:\\(.\\)/$:\\1:'`;

/** The text of each `<a>` on the page, tags inside it removed and spaces collapsed, one to a line. */
export const ANCHOR_TEXTS = part` | tr "\\n\\r\\t" '   ' | grep -oiE '<a[[:space:]][^>]*>([^<]|<[^/]|</[^aA])*</a>' | sed -e 's/<[^>]*>//g' -e 's/&nbsp;/ /g' -e 's/  */ /g' -e 's/^ //' -e 's/ $//'`;

/** Passes when a line is one of `targets`. */
export const anyOf = (targets: readonly Word[]): Fragment =>
  joined(part` | grep -qxF`, each(' -e ', targets));

/**
 * Passes when a line is one of `kept` and none is one of `stale`: the page links to where it should
 * and no longer to where it did.
 */
export const movedTo = (stale: readonly Word[], kept: readonly Word[]): Fragment =>
  joined(
    part` | awk 'BEGIN { n = ARGV[1]; for (i = 2; i < 2 + n; i++) stale[ARGV[i]] = 1; for (; i < ARGC; i++) kept[ARGV[i]] = 1; ARGC = 1 } $0 in stale { old = 1 } $0 in kept { found = 1 } END { exit !(found && !old) }' ${int(stale.length)}`,
    each(' ', [...stale, ...kept]),
  );

/**
 * Passes when the page has link text and none of it is one of `texts`, compared without case.
 */
export const noneOf = (texts: readonly Word[]): Fragment =>
  joined(
    part` | awk 'BEGIN { for (i = 1; i < ARGC; i++) generic[tolower(ARGV[i])] = 1; ARGC = 1 } tolower($0) in generic { left++ } END { exit !(NR > 0 && !left) }'`,
    each(' ', texts),
  );

/**
 * Passes when the hreflang annotations name `self` under a language, hold an `x-default`, name each
 * of `must`, and hold none of `gone` as a value or a target.
 */
export const hreflangHolds = (self: Word, must: readonly Word[], gone: readonly Word[]): Fragment =>
  joined(
    part` | awk 'BEGIN { self = ARGV[1]; n = ARGV[2]; for (i = 3; i < 3 + n; i++) must[ARGV[i]] = 1; for (; i < ARGC; i++) gone[ARGV[i]] = 1; ARGC = 1 } { if (tolower($1) == "x-default") fallback = 1; else if ($2 == self) own = 1; delete must[$2]; if ($1 in gone || $2 in gone) bad = 1 } END { for (m in must) bad = 1; exit !(own && fallback && !bad) }' ${self} ${int(must.length)}`,
    each(' ', [...must, ...gone]),
  );

/**
 * Reads the link targets of two pages fetched with `fetchOf` (the first page of a list, then a later
 * one). Passes when the later page links somewhere the first does not, leaving out `known` and any
 * target holding `listMark`, which marks another page of the same list.
 */
export const linksBeyondFirst = (listMark: Word, known: readonly Word[]): Fragment =>
  joined(
    part` | awk 'BEGIN { mark = ARGV[1]; for (i = 2; i < ARGC; i++) first[ARGV[i]] = 1; ARGC = 1 } $0 == "crawlmouse:end" { page++; next } page == 0 { first[$0] = 1; next } !($0 in first) && index($0, mark) == 0 { fresh++ } END { exit !(page == 2 && fresh) }' ${listMark}`,
    each(' ', known),
  );

/** `a && b`: both commands pass. */
export const both = (a: Fragment, b: Fragment): Fragment => joined(a, part` && `, b);
