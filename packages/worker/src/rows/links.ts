import { extractPage, type ExtractedLink } from '@crawlmouse/engine/worker';
import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'cheerio';
import { CAPS, MAX_URL_LENGTH } from './bounded.js';

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
  const stack: Array<{ node: AnyNode; exit: boolean }> = $.root()
    .toArray()
    .map((node) => ({ node, exit: false }));
  while (stack.length) {
    const { node, exit } = stack.pop()!;
    if (exit) {
      const closed = open.pop();
      if (closed) {
        closed.end = stream.length;
        stream.boundary();
        openRead--;
      }
      continue;
    }
    if (node.type === 'text') {
      // Text outside every link read is no link's text.
      if (openRead > 0) stream.add(node.data);
      continue;
    }
    if (!('children' in node)) continue;
    if (node.type === 'tag' && node.name === 'a' && node.attribs.href !== undefined) {
      const href = node.attribs.href;
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
      stack.push({ node, exit: true });
    }
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ node: node.children[i]!, exit: false });
    }
  }
  const text = stream.text();

  // What the engine decides, asked on two small documents rather than on one holding every link's
  // text: which links it keeps and their URLs (its filters read the href alone), and which texts are
  // generic. extractPage on one document of 2,000 links of 2,000 characters took about a second.
  const texts = read.map((a) => capture(text, a.start, a.end).trim());
  const kept = keptLinks($, baseUrl, read);
  const generic = genericTexts(baseUrl, texts);
  const links: ExtractedLink[] = [];
  for (const [i, toUrl] of kept.links) {
    const anchorText = texts[i]!;
    links.push({ toUrl, anchorText, isGenericAnchor: generic.get(anchorText) ?? false });
  }
  return { notRead, canonicalUrl: kept.canonicalUrl, links };
}

/** A document of these links, each with its text, and the page's first rel=canonical. */
function documentOf(
  links: ReadonlyArray<{ href: string; text: string }>,
  $page: cheerio.CheerioAPI | null,
): cheerio.CheerioAPI {
  const page = cheerio.load('<html><head></head><body></body></html>');
  const canonical = $page?.('link[rel="canonical"]').first();
  if (canonical?.length) {
    const link = page('<link rel="canonical">');
    const href = canonical.attr('href');
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
  $: cheerio.CheerioAPI,
  baseUrl: string,
  read: readonly Anchor[],
): { links: Array<[number, string]>; canonicalUrl: string | undefined } {
  const page = documentOf(
    read.map((a, i) => ({ href: a.href, text: String(i) })),
    $,
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
