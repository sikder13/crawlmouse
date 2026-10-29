import { extractPage, type ExtractedLink } from '@crawlmouse/engine/worker';
import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'cheerio';
import { CAPS, MAX_URL_LENGTH } from './bounded.js';

/**
 * A page's links, read the way the engine's extractPage reads them, at a cost linear in the page.
 *
 * extractPage takes each link's anchor text from the link's whole subtree, so links nested inside
 * links walk the same nodes once per level: 500 nested links around a large subtree cost 12 s. Here
 * one pass over the page records, for each link read, its href and the start of its text: as much as
 * an edge can store (ANCHOR_TEXT_BYTES), however deeply it nests. Then extractPage runs on a small
 * document holding just those links, and the page's first rel=canonical, so its filters,
 * canonicalisation and generic-anchor test apply unchanged. links.test.ts holds the two readings equal
 * on generated pages.
 *
 * Links are read in page order, nested ones included (browsers build them, and v1 records them):
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

/**
 * One link's text as the engine would collapse it: a run of whitespace is one space, and a run of
 * dropped controls is one control (toPersistableText drops them all, so the count of them does not
 * change what is stored, and a control between two spaces still keeps them two runs).
 */
class Capture {
  private readonly parts: string[] = [];
  private kept = 0;
  private last: 'space' | 'dropped' | 'other' | null = null;
  done = false;

  add(data: string): void {
    // `from` starts the run of characters copied as they are; it is cut at each space (written as
    // ' ') and at each repeat within a run (skipped).
    let from = 0;
    for (let i = 0; i < data.length; i++) {
      const c = data.charCodeAt(i);
      const kind = isSpace(c) ? 'space' : isDropped(c) ? 'dropped' : 'other';
      const repeat = kind !== 'other' && kind === this.last;
      if (repeat || kind === 'space') {
        if (i > from) this.parts.push(data.slice(from, i));
        from = i + 1;
      }
      if (repeat) continue;
      if (kind === 'space') this.parts.push(' ');
      this.last = kind;
      if (kind !== 'dropped' && ++this.kept >= CAPTURE) {
        if (i + 1 > from) this.parts.push(data.slice(from, i + 1));
        this.done = true;
        return;
      }
    }
    if (data.length > from) this.parts.push(data.slice(from));
  }

  text(): string {
    return this.parts.join('');
  }
}

interface Anchor {
  href: string;
  capture: Capture;
}

export function readLinks($: cheerio.CheerioAPI, baseUrl: string): PageLinks {
  const notRead: LinksNotRead = { tooLong: 0, pastLimit: 0 };
  const read: Anchor[] = [];
  // The links whose subtree the walk is inside, and which still want text.
  const open: Array<Anchor | null> = [];
  let wanting = 0;
  const stack: Array<{ node: AnyNode; exit: boolean }> = $.root()
    .toArray()
    .map((node) => ({ node, exit: false }));
  while (stack.length) {
    const { node, exit } = stack.pop()!;
    if (exit) {
      const closed = open.pop();
      if (closed && !closed.capture.done) wanting--;
      continue;
    }
    if (node.type === 'text') {
      if (wanting > 0) {
        for (const a of open) {
          if (!a || a.capture.done) continue;
          a.capture.add(node.data);
          if (a.capture.done) wanting--;
        }
      }
      continue;
    }
    if (!('children' in node)) continue;
    if (node.type === 'tag' && node.name === 'a' && node.attribs.href !== undefined) {
      const href = node.attribs.href;
      let anchor: Anchor | null = null;
      if (href.length > MAX_URL_LENGTH) notRead.tooLong++;
      else if (read.length >= MAX_LINKS_READ) notRead.pastLimit++;
      else {
        anchor = { href, capture: new Capture() };
        read.push(anchor);
        wanting++;
      }
      open.push(anchor);
      stack.push({ node, exit: true });
    }
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ node: node.children[i]!, exit: false });
    }
  }

  const page = cheerio.load('<html><head></head><body></body></html>');
  const canonical = $('link[rel="canonical"]').first();
  if (canonical.length) {
    const link = page('<link rel="canonical">');
    const href = canonical.attr('href');
    if (href !== undefined) link.attr('href', href);
    page('head').append(link);
  }
  // One parsed link, cloned per link read: parsing each one costs more than reading the page.
  const template = page('<a href="">x</a>')[0] as Element;
  const links = read.map((a) => {
    const el = template.cloneNode(true);
    el.attribs.href = a.href;
    const text = el.children[0]!;
    if (text.type === 'text') text.data = a.capture.text();
    return el;
  });
  page('body').append(links);
  const extracted = extractPage(page, baseUrl, { excludeNonContentLinks: true });
  return { notRead, canonicalUrl: extracted.canonicalUrl, links: extracted.links };
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
