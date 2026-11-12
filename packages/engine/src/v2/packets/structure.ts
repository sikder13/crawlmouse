/**
 * What the seven structure packets share: reading a record's subject and the rows it names, the
 * crawl's links filed as the detectors file them, and the sentences more than one packet writes.
 */
import type { LinkEdge, PageResult } from '@crawlmouse/types/v2';
import { canonicalizeUrl } from '../../url-canonical.js';
import { fileEdges, landingsOf } from '../build/filing.js';
import { subjectOfKey } from '../detectors/fingerprint.js';
import { byText } from '../detectors/scope.js';
import type { Detection } from '../detectors/types.js';
import { command, COMMAND_BOUNDS, joined, part, printOf, type Fragment } from './html-checks.js';
import { readAt, servedAt } from './served-at.js';
import { crawledWord, url as urlWord, word, type Command, type Word } from './shell.js';
import { code, line, list, ours, textOf, type Line, type Safe } from './text.js';
import type { PacketFacts } from './types.js';

/** The page URL, or template key, a structure record is about. */
export const subjectOf = (fix: Pick<Detection, 'key'>): string => subjectOfKey(fix.key);

/**
 * The check's row for a page a detected record names. The detectors judge crawled pages only, so a
 * record that names a page the check does not hold is a fault in the caller, and throws.
 */
export function rowOf(facts: Pick<PacketFacts, 'pages'>, url: string): PageResult {
  const row = facts.pages.get(url);
  if (row === undefined)
    throw new Error('packets: a structure record names a page the check does not hold');
  return row;
}

/**
 * The crawl's links filed under the page they were found on, as the detectors and the grade file
 * them (build/filing.ts), read in the detectors' order (by source, then target), so that of two
 * links that file to one pair the same one is kept. The result is remembered by the facts' own `pages` and `edges`.
 */
export function filedLinks(facts: Pick<PacketFacts, 'pages' | 'edges'>): readonly LinkEdge[] {
  const byEdges = filed.get(facts.pages) ?? new WeakMap<object, readonly LinkEdge[]>();
  filed.set(facts.pages, byEdges);
  const known = byEdges.get(facts.edges);
  if (known !== undefined) return known;
  const ordered = [...facts.edges].sort(
    (a, b) => byText(a.from_url, b.from_url) || byText(a.to_url, b.to_url),
  );
  const links = fileEdges(ordered, landingsOf([...facts.pages.values()]));
  byEdges.set(facts.edges, links);
  return links;
}

/** A check's links are filed once for its pages and links, however many of its fixes read them. */
const filed = new WeakMap<object, WeakMap<object, readonly LinkEdge[]>>();

/**
 * The links the detectors' graph holds (scope.ts `scopeOf`): the links as filed, from pages that
 * answered 200. A link recorded from a page that answered anything else is in the grade's filing and
 * not in the graph a depth or an orphan is judged on.
 */
export function graphLinks(facts: Pick<PacketFacts, 'pages' | 'edges'>): readonly LinkEdge[] {
  const links = filedLinks(facts);
  const known = graphed.get(links);
  if (known !== undefined) return known;
  const kept = links.filter((e) => facts.pages.get(e.from_url)?.status_code === 200);
  graphed.set(links, kept);
  return kept;
}

const graphed = new WeakMap<object, readonly LinkEdge[]>();

/**
 * Whether the crawl's record holds a link to `to` on `on`, or on the crawled page `on` was read at
 * when its request ended on another one: a command that reads `on` requests that address
 * (served-at.ts `readAt`), and finds that page's links there.
 */
export function holdsLink(
  facts: Pick<PacketFacts, 'pages' | 'edges'>,
  on: string,
  to: string,
): boolean {
  const links = filedLinks(facts);
  const pairs = held.get(links) ?? new Set(links.map((e) => `${e.from_url}\u0000${e.to_url}`));
  held.set(links, pairs);
  let at = on;
  try {
    at = canonicalizeUrl(readAt(facts, on));
  } catch {
    // an address that does not parse is no crawled page
  }
  return pairs.has(`${on}\u0000${to}`) || pairs.has(`${at}\u0000${to}`);
}

const held = new WeakMap<object, Set<string>>();

/**
 * The addresses a link to the page `url` can name and be filed as a link to it: the page's URL, and
 * where its request ended when the crawl files that address under it (build/filing.ts).
 */
export function addressesOf(facts: Pick<PacketFacts, 'pages'>, url: string): string[] {
  const landings = landed.get(facts.pages) ?? landingsOf([...facts.pages.values()]);
  landed.set(facts.pages, landings);
  const at = [...landings].filter(([, page]) => page === url).map(([address]) => address);
  return [url, ...at.filter((address) => address !== url)];
}

const landed = new WeakMap<object, Map<string, string>>();

/**
 * How many clicks each page is from the homepage, over the links of the detectors' graph; a page no
 * path of links reaches is not in the map. Remembered by the facts, as the links are.
 */
export function clicksFromHome(
  facts: Pick<PacketFacts, 'pages' | 'edges' | 'homepage_url'>,
): ReadonlyMap<string, number> {
  const links = graphLinks(facts);
  const known = clicks.get(links);
  if (known !== undefined) return known;
  const out = new Map<string, string[]>();
  for (const e of links) out.set(e.from_url, [...(out.get(e.from_url) ?? []), e.to_url]);
  const depth = new Map([[facts.homepage_url, 0]]);
  let frontier = [facts.homepage_url];
  for (let d = 1; frontier.length > 0; d++) {
    const next: string[] = [];
    for (const from of frontier) {
      for (const to of out.get(from) ?? []) {
        if (depth.has(to)) continue;
        depth.set(to, d);
        next.push(to);
      }
    }
    frontier = next;
  }
  clicks.set(links, depth);
  return depth;
}

const clicks = new WeakMap<object, ReadonlyMap<string, number>>();

/** Up to `max` URLs in code spans; a longer list says how many pages it leaves out. */
export const pagesShown = (urls: readonly string[], max = 8): Safe =>
  list(
    urls.map((u) => code(u)),
    max,
    'page',
  );

/**
 * Words and `Safe` values as one value to put into a line: a phrase a line holds only sometimes.
 * It is made by `line`, so what it holds is held to a line's rules.
 */
export const phrase = (parts: TemplateStringsArray, ...values: readonly Safe[]): Safe =>
  ours(textOf(line(parts, ...values)));

/** No words. */
export const NONE: Safe = ours('');

/**
 * The address a command requests to read the page `url`, as a line names it: the address alone, or,
 * when the page's request ends at another address, that address and the page it is the answer of.
 */
export function readShown(facts: Pick<PacketFacts, 'pages'>, url: string): Safe {
  const [read, own] = [readAt(facts, url), servedAt(facts, url)];
  return read === own ? code(read) : phrase`${code(read)} (where ${code(own)} answers)`;
}

/** What a "see it" command greps a response for (types.ts `See`): patterns of ours. */
export const TAGS = {
  a: '<a [^>]*>',
  aWithText: '<a [^>]*>[^<]*</a>',
  canonical: '<link[^>]*rel="canonical"[^>]*>',
  hreflang: '<link[^>]*hreflang[^>]*>',
} as const;

/** The path and query of a page's URL, as a link to it most often writes them; the origin left out. */
export function pathOf(target: string): string {
  const written = urlWord(target).word.slice(1, -1).replaceAll(`'\\''`, "'");
  const path = written.slice(new URL(written).origin.length);
  return path === '/' || path === '' ? '"/"' : path;
}

/** ` | grep -F -e … -e …`: the lines that hold one of the texts. */
const holding = (anyCase: boolean, texts: readonly Word[]): Fragment =>
  joined(anyCase ? part` | grep -iF` : part` | grep -F`, ...texts.map((t) => part` -e ${t}`));

/**
 * The readable command of a packet that reads a page: `curl` of the page as the strict command
 * requests it, the matches of `pattern` printed one to a line, and, with `texts`, only those that
 * hold one of them (`anyCase`: whatever their case).
 */
export function seeTags(
  facts: Pick<PacketFacts, 'pages' | 'crawlers'>,
  pages: readonly string[],
  pattern: string,
  texts: readonly Word[] = [],
  anyCase = false,
): Command {
  return command(
    printOf(facts, pages).fragment,
    part` | grep -io ${word(pattern)}`,
    texts.length === 0 ? part`` : holding(anyCase, texts),
  );
}

/** A path, or other text of a URL, as a word `seeTags` keeps lines by. */
export const pathWord = (target: string): Word =>
  crawledWord(pathOf(target), COMMAND_BOUNDS.url_chars);

/** "page" or "pages", and the like, for a count. */
export const plural = (n: number, one: string, many: string): Safe => ours(n === 1 ? one : many);

/** A page's title as read, or null when the crawl read none. */
export const titleOf = (page: PageResult | undefined): string | null => {
  const text = page?.title?.text ?? null;
  return text === null || text.trim() === '' ? null : text;
};

/** The step every packet that adds a link carries: what makes the link one a crawler follows. */
export const CRAWLABLE_LINK: Line = line`Write the link as an <a> element with an href, in the HTML the server sends. A link that only JavaScript adds is not there for a crawler that does not run scripts.`;

/** What a command that looks for an old link says of an href it cannot read (html-checks.ts `linksTo`). */
export const UNREAD_HREF = ours(
  'An href with a named character reference the command does not know counts as the old link.',
);

/** The pages Google's documentation is cited from, as the packets print them. */
export const GOOGLE_DOCS = {
  links: 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable',
  canonical:
    'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
  pagination:
    'https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading',
  hreflang: 'https://developers.google.com/search/docs/specialty/international/localized-versions',
} as const;

/**
 * The Next.js step for a tag the command reads in the <head>: when the framework sends metadata after
 * the first HTML, and the two ways to have it in the <head> for the crawler. Each sentence is from
 * the two pages `NEXT_STREAMING_SOURCES` cites.
 */
export const NEXT_STREAMING: Line = line`When a page cannot be prerendered, or its generateMetadata introduces dynamic behavior, Next.js can send the metadata tags after the first HTML, appended to the <body>; user agents on its list of HTML-limited bots get them in the <head>. The command below reads the <head>. Either make the page one that can be prerendered, with a generateMetadata that introduces no dynamic behavior, or extend the default list: a value for htmlLimitedBots in the Next.js config overrides the default list, so repeat the default bots in it and add the crawler the command requests as.`;

export const NEXT_METADATA =
  'https://nextjs.org/docs/app/api-reference/functions/generate-metadata';
export const NEXT_LIMITED_BOTS =
  'https://nextjs.org/docs/app/api-reference/config/next-config-js/htmlLimitedBots';

/** What the htmlLimitedBots page supports of `NEXT_STREAMING`. */
export const NEXT_LIMITED_BOTS_SOURCE = {
  title: 'htmlLimitedBots',
  url: NEXT_LIMITED_BOTS,
  read: '2026-11-12',
  supports:
    'htmlLimitedBots lists the user agents that receive blocking metadata instead of streaming metadata; "Specifying a htmlLimitedBots config will override the Next.js\' default list"; the default list includes Google crawlers, Bingbot, Twitterbot and Slackbot',
} as const;

/** The date the documentation pages the stack bodies cite were read. */
export const DOCS_READ = '2026-11-12';
