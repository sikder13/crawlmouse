import { extractPage, MainContentWalk, type ExtractedLink } from '@crawlmouse/engine/worker';
import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'cheerio';
import { MAX_HREFLANG_LINKS, type Hreflang } from '@crawlmouse/types/v2';
import { CAPS, MAX_URL_LENGTH } from './bounded.js';
import { declaredCanonical, hreflangOf, isAlternate, type CanonicalRead } from './declared.js';

/**
 * A page's links, read the way the engine's extractPage reads them, at a cost bounded by the page's
 * text and the links read rather than their product.
 *
 * extractPage takes each link's anchor text from the link's whole subtree, so links nested inside
 * links walk the same nodes once per level (review round 3 measured 12 s for 500 nested links
 * around 663,000 paragraphs). Here
 * one pass over the page collapses the text inside the links read into one stream (see Stream), and
 * each link's text is cut from its range of that stream, up to as much as an edge stores. What the
 * engine decides (which links it keeps, the URL of each, which texts are generic, the canonical) is
 * then asked of it on two small documents (see readLinks). links.test.ts holds the result equal to
 * extractPage over the whole page on generated pages, and pins the cost on pages that vary the text
 * under the links.
 *
 * Links are read in page order, nested ones included, as v1 records them (htmlparser2 builds them;
 * a browser's parser would split the outer link):
 * - an href longer than MAX_URL_LENGTH is not read;
 * - past the first MAX_LINKS_READ links, none is.
 */

export const MAX_LINKS_READ = 2000;

/**
 * The main content the simhash reads: its first HASHED_TEXT_CHARS characters. The hash stops at
 * SIMHASH_MAX_TOKENS tokens, so a prefix holding that many gives the hash of the whole text; reading
 * no further saves collapsing and tokenising up to 2 MiB. A prefix holding fewer (text of long runs
 * without a separator, such as unspaced CJK) gives a hash of the prefix instead, which can differ.
 * Measured over the 2,618 corpus documents (packages/engine/fixtures/v2/main-content): at 65,536 no
 * hash changed and no near-duplicate pairing flipped; at 32,768, 29 hashes changed.
 */
export const HASHED_TEXT_CHARS = 65_536;
export { MAX_URL_LENGTH } from './bounded.js';
/** What an edge stores of a link's anchor text: the contract's limit for `anchor_text`. */
export const ANCHOR_TEXT_BYTES = CAPS.anchorText.bytes;

export interface LinksNotRead {
  tooLong: number;
  pastLimit: number;
}

export interface PageLinks {
  /**
   * In page order, as extractPage gives them. Each anchor text is the start of the engine's: cut with
   * `bounded(text, CAPS.anchorText)`, it is what the engine's would give.
   */
  links: ExtractedLink[];
  canonicalUrl: string | undefined;
  notRead: LinksNotRead;
  /** The first rel=canonical as the page wrote it, whatever host it names. */
  declaredCanonical: CanonicalRead;
  /** The page's hreflang alternates; `complete` does not yet account for the response's headers. */
  hreflang: Hreflang;
  /**
   * The start of the page's main content, as the engine's extractMainContent gives it, from this
   * same walk: its first HASHED_TEXT_CHARS characters, which the simhash reads.
   */
  mainTextStart: string;
  /** The first `<title>`'s text as written, or null for none; found in this same walk. */
  titleText: string | null;
  /** The first `<meta name="description">`'s content as written ('' with none), or null for none. */
  descriptionText: string | null;
  /**
   * The length of the page's main content, as the engine's extractMainContent gives it (v1's
   * `mainTextChars`), from this same walk.
   */
  mainTextChars: number;
  /** A robots, googlebot or bingbot meta tag says `noindex` or `none` (v1's readMetaNoindex rule). */
  metaNoindex: boolean;
}

/** JavaScript's `\s`: what the engine collapses and trims. */
const isSpace = (c: number): boolean =>
  (c >= 0x09 && c <= 0x0d) ||
  c === 0x20 ||
  c === 0xa0 ||
  c === 0x1680 ||
  (c >= 0x2000 && c <= 0x200a) ||
  c === 0x2028 ||
  c === 0x2029 ||
  c === 0x202f ||
  c === 0x205f ||
  c === 0x3000 ||
  c === 0xfeff;

/** What toPersistableText drops, among the characters `\s` does not match. */
const isDropped = (c: number): boolean => (c < 0x20 && !isSpace(c)) || c === 0x7f;

/**
 * Characters of text kept per link, counting those toPersistableText keeps (it drops the controls).
 * Every kept character is at least one byte, so after trimming a space at either end this still holds
 * the first ANCHOR_TEXT_BYTES bytes of the full text.
 */
const CAPTURE = ANCHOR_TEXT_BYTES + 2;

type Kind = 'space' | 'dropped' | 'other';
const kindOf = (c: number): Kind => (isSpace(c) ? 'space' : isDropped(c) ? 'dropped' : 'other');

/**
 * The text inside the links read, in page order, collapsed as the engine collapses a link's text: a
 * run of whitespace is one space, and a run of dropped controls is one control (toPersistableText
 * drops them all, so how many there were does not change what is stored, and a control between two
 * spaces still keeps them two runs). A run is not collapsed across a boundary, the start or end of a
 * link read, so that each link's range of the stream holds its text and no neighbour's.
 */
class Stream {
  private readonly parts: string[] = [];
  length = 0;
  private last: Kind | null = null;

  boundary(): void {
    this.last = null;
  }

  add(data: string): void {
    // `from` starts the run of characters copied as they are; it is cut at each space (written as
    // ' ') and at each repeat within a run (skipped).
    let from = 0;
    for (let i = 0; i < data.length; i++) {
      const kind = kindOf(data.charCodeAt(i));
      const repeat = kind !== 'other' && kind === this.last;
      if (repeat || kind === 'space') {
        if (i > from) this.push(data.slice(from, i));
        from = i + 1;
      }
      if (repeat) continue;
      if (kind === 'space') this.push(' ');
      this.last = kind;
    }
    if (data.length > from) this.push(data.slice(from));
  }

  text(): string {
    return this.parts.join('');
  }

  private push(piece: string): void {
    this.parts.push(piece);
    this.length += piece.length;
  }
}

/**
 * A link's text from its range of the stream: collapsed again, which joins the runs a nested link's
 * boundaries split, and cut once it holds CAPTURE kept characters. Each step either keeps a
 * character, or skips a repeat or a dropped control, and the stream has at most one of those between
 * two kept characters or at a boundary, so a link costs at most twice CAPTURE plus the boundaries in
 * its range.
 */
function capture(stream: string, start: number, end: number): string {
  const out: string[] = [];
  let from = start;
  let kept = 0;
  let last: Kind | null = null;
  for (let i = start; i < end; i++) {
    const kind = kindOf(stream.charCodeAt(i));
    if (kind !== 'other' && kind === last) {
      if (i > from) out.push(stream.slice(from, i));
      from = i + 1;
      continue;
    }
    last = kind;
    if (kind !== 'dropped' && ++kept >= CAPTURE) {
      out.push(stream.slice(from, i + 1));
      return out.join('');
    }
  }
  if (end > from) out.push(stream.slice(from, end));
  return out.join('');
}

interface Anchor {
  href: string;
  /** The link's range of the stream. */
  start: number;
  end: number;
}

export function readLinks($: cheerio.CheerioAPI, baseUrl: string): PageLinks {
  const notRead: LinksNotRead = { tooLong: 0, pastLimit: 0 };
  const read: Anchor[] = [];
  const stream = new Stream();
  // The links whose subtree the walk is inside; null for one not read.
  const open: Array<Anchor | null> = [];
  let openRead = 0;
  // The page's first rel=canonical, found in this walk: a selector over a page of many top-level
  // nodes and no body costs seconds (htmlparser2), which this walk does not.
  let canonical: Element | null = null;
  // The first <title> and <meta name=description>, found in the same walk.
  let title: Element | null = null;
  let description: Element | null = null;
  let metaNoindex = false;
  // The hreflang alternates, found in the same walk: the first MAX_HREFLANG_LINKS, and a count of
  // the rest, so a page of thousands holds no more than that.
  const alternates: Element[] = [];
  let moreAlternates = 0;
  // The main content is read in this walk too (MainContentWalk): it sees every node going in, and
  // every node with children coming out. htmlparser2 builds no body a page does not write, so a page
  // without one is read from the body its HTML implies, as a browser builds it.
  const main = new MainContentWalk({ impliedBody: true });
  const stack: Array<{ node: AnyNode; exit: boolean; link?: boolean }> = $.root()
    .toArray()
    .map((node) => ({ node, exit: false }));
  while (stack.length) {
    const { node, exit, link } = stack.pop()!;
    if (exit) {
      const closed = link ? open.pop() : null;
      if (closed) {
        closed.end = stream.length;
        stream.boundary();
        openRead--;
      }
      main.exit(node);
      continue;
    }
    main.enter(node);
    if (node.type === 'text') {
      // Text outside every link read is no link's text.
      if (openRead > 0) stream.add(node.data);
      continue;
    }
    if (!('children' in node)) continue;
    if (canonical === null && isCanonicalLink(node)) canonical = node;
    if (title === null && node.type === 'tag' && node.name === 'title') title = node;
    if (description === null && isDescription(node)) description = node;
    if (!metaNoindex && isNoindexMeta(node)) metaNoindex = true;
    if (node.type === 'tag' && isAlternate(node)) {
      if (alternates.length < MAX_HREFLANG_LINKS) alternates.push(node);
      else moreAlternates++;
    }
    const isLink = node.type === 'tag' && node.name === 'a' && node.attribs.href !== undefined;
    if (isLink) {
      const href = node.attribs.href!;
      let anchor: Anchor | null = null;
      if (href.length > MAX_URL_LENGTH) notRead.tooLong++;
      else if (read.length >= MAX_LINKS_READ) notRead.pastLimit++;
      else {
        anchor = { href, start: stream.length, end: stream.length };
        read.push(anchor);
        stream.boundary();
        openRead++;
      }
      open.push(anchor);
    }
    stack.push({ node, exit: true, link: isLink });
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ node: node.children[i]!, exit: false });
    }
  }
  const text = stream.text();

  // What the engine decides, asked on two small documents rather than on one holding every link's
  // text: which links it keeps and their URLs (its filters read the href alone), and which texts are
  // generic. extractPage on one document of 2,000 links of 2,000 characters took about a second.
  const texts = read.map((a) => capture(text, a.start, a.end).trim());
  const kept = keptLinks(canonical, baseUrl, read);
  const generic = genericTexts(baseUrl, texts);
  const links: ExtractedLink[] = [];
  for (const [i, toUrl] of kept.links) {
    const anchorText = texts[i]!;
    links.push({ toUrl, anchorText, isGenericAnchor: generic.get(anchorText) ?? false });
  }
  return {
    notRead,
    canonicalUrl: kept.canonicalUrl,
    links,
    declaredCanonical: declaredCanonical(canonical, baseUrl),
    hreflang: hreflangOf(alternates, moreAlternates, baseUrl),
    mainTextStart: main.textPrefix(HASHED_TEXT_CHARS),
    titleText: title === null ? null : textOf(title),
    descriptionText: description === null ? null : (description.attribs.content ?? ''),
    mainTextChars: main.result().mainTextChars,
    metaNoindex,
  };
}

/** The meta names v1's readMetaNoindex reads (packages/engine/src/extract.ts), compared trimmed and without case. */
const NOINDEX_META_NAMES = new Set(['robots', 'googlebot', 'bingbot']);

/**
 * v1's readMetaNoindex, on one node: a `<meta name>` among NOINDEX_META_NAMES whose content, split on
 * commas, holds `noindex` or `none`. v1's is not exported, so reader/features.test.ts holds this to
 * extractPage's `classificationSignals.metaNoindex` on generated pages.
 */
function isNoindexMeta(node: AnyNode): boolean {
  if (node.type !== 'tag' || node.name !== 'meta') return false;
  const name = node.attribs.name;
  if (name === undefined || !NOINDEX_META_NAMES.has(name.trim().toLowerCase())) return false;
  return (node.attribs.content ?? '')
    .toLowerCase()
    .split(',')
    .some((t) => t.trim() === 'noindex' || t.trim() === 'none');
}

/** `meta[name=description]`, the name compared without case, as search engines read it. */
function isDescription(node: AnyNode): node is Element {
  if (node.type !== 'tag' || node.name !== 'meta') return false;
  const name = node.attribs.name;
  return name !== undefined && name.length === 11 && name.toLowerCase() === 'description';
}

/** A title's text: its text children, which is all a `<title>` holds (the parser reads it as text). */
const textOf = (el: Element): string =>
  el.children.map((c) => (c.type === 'text' ? c.data : '')).join('');

/**
 * What css-select matches with `link[rel="canonical"]`, extractPage's selector: a link whose rel is
 * "canonical" in any case (rel is one of the attributes HTML compares without case).
 */
function isCanonicalLink(node: AnyNode): node is Element {
  if (node.type !== 'tag' || node.name !== 'link') return false;
  const rel = node.attribs.rel;
  return rel !== undefined && rel.length === 9 && rel.toLowerCase() === 'canonical';
}

/** A document of these links, each with its text, and a copy of the page's rel=canonical. */
function documentOf(
  links: ReadonlyArray<{ href: string; text: string }>,
  canonical: Element | null,
): cheerio.CheerioAPI {
  const page = cheerio.load('<html><head></head><body></body></html>');
  if (canonical) {
    const link = page('<link rel="canonical">');
    const href = canonical.attribs.href;
    if (href !== undefined) link.attr('href', href);
    page('head').append(link);
  }
  // One parsed link, cloned per link: parsing each one costs more than reading the page.
  const template = page('<a href="">x</a>')[0] as Element;
  page('body').append(
    links.map(({ href, text }) => {
      const el = template.cloneNode(true);
      el.attribs.href = href;
      const child = el.children[0]!;
      if (child.type === 'text') child.data = text;
      return el;
    }),
  );
  return page;
}

/**
 * The links extractPage keeps, by their index in `read`, with the URL it gives each; and the page's
 * canonical. Each link's text is its index, which extractPage hands back as the anchor text.
 */
function keptLinks(
  canonical: Element | null,
  baseUrl: string,
  read: readonly Anchor[],
): { links: Array<[number, string]>; canonicalUrl: string | undefined } {
  const page = documentOf(
    read.map((a, i) => ({ href: a.href, text: String(i) })),
    canonical,
  );
  const extracted = extractPage(page, baseUrl, { excludeNonContentLinks: true });
  return {
    links: extracted.links.map((l) => [Number(l.anchorText), l.toUrl]),
    canonicalUrl: extracted.canonicalUrl,
  };
}

/**
 * The longest text asked about. The engine's generic-anchor test matches a whole short phrase ("click
 * here", "read more": none longer than 14 characters today), so a longer text is not generic.
 */
export const GENERIC_TEXT_MAX = 256;

/** Which of these texts extractPage calls generic, each distinct text up to GENERIC_TEXT_MAX asked once. */
function genericTexts(baseUrl: string, texts: readonly string[]): Map<string, boolean> {
  const asked = [...new Set(texts.filter((t) => t.length <= GENERIC_TEXT_MAX))];
  const page = documentOf(
    asked.map((text) => ({ href: '/', text })),
    null,
  );
  const extracted = extractPage(page, baseUrl, { excludeNonContentLinks: true });
  return new Map(extracted.links.map((l, i) => [asked[i]!, l.isGenericAnchor]));
}

export function linksNotReadNote(n: LinksNotRead): string | null {
  const parts = [
    n.tooLong ? `${n.tooLong} with a URL over ${MAX_URL_LENGTH} characters` : null,
    n.pastLimit ? `${n.pastLimit} past the first ${MAX_LINKS_READ} on the page` : null,
  ].filter((p): p is string => p !== null);
  if (!parts.length) return null;
  const total = n.tooLong + n.pastLimit;
  return `${total} ${total === 1 ? 'link was' : 'links were'} not read: ${parts.join('; ')}.`;
}
