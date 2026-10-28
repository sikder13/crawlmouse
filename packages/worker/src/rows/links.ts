import type * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'cheerio';

/**
 * Bounds what link extraction can cost before the engine's extractPage sees a page. extractPage
 * builds a URL and an anchor text for every `a[href]`, and an anchor's text is its whole subtree's
 * text, so links nested inside links copy the same text again at each level. Links are read in page
 * order, nested ones included (browsers build them, and v1 records them), until:
 *
 * - an href is longer than MAX_URL_LENGTH: that link is not read;
 * - MAX_LINKS_READ links have been read: the rest are not;
 * - reading a link would take the anchor text copied for the page past MAX_ANCHOR_TEXT_CHARS: that
 *   link is not read.
 *
 * Unread links lose their href in the parsed document, so `a[href]` no longer matches them. The counts
 * go into the page's limitations.
 */

export const MAX_LINKS_READ = 2000;
/** The longest URL the worker reads as a link or links from; the request schema holds URLs to the same. */
export const MAX_URL_LENGTH = 2048;
/** Anchor text copied across the links read on one page, nested links counted once per level. */
export const MAX_ANCHOR_TEXT_CHARS = 4_000_000;

export interface LinksNotRead {
  tooLong: number;
  pastLimit: number;
  overTextLimit: number;
}

interface Anchor {
  node: Element;
  /** The length of the text in its subtree: what extractPage copies as its anchor text. */
  textChars: number;
}

/** Every `a[href]` in page order, with its subtree's text length, in one pass and without recursion. */
function anchorsOf($: cheerio.CheerioAPI): Anchor[] {
  const anchors: Anchor[] = [];
  const open: Anchor[] = [];
  const stack: Array<{ node: AnyNode; exit: boolean }> = $.root()
    .toArray()
    .map((node) => ({ node, exit: false }));
  while (stack.length) {
    const { node, exit } = stack.pop()!;
    if (exit) {
      const closed = open.pop()!;
      if (open.length) open.at(-1)!.textChars += closed.textChars;
      continue;
    }
    if (node.type === 'text') {
      if (open.length) open.at(-1)!.textChars += node.data.length;
      continue;
    }
    if (!('children' in node)) continue;
    if (node.type === 'tag' && node.name === 'a' && node.attribs.href !== undefined) {
      const anchor: Anchor = { node, textChars: 0 };
      anchors.push(anchor);
      open.push(anchor);
      stack.push({ node, exit: true });
    }
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ node: node.children[i]!, exit: false });
    }
  }
  return anchors;
}

export function limitLinks($: cheerio.CheerioAPI): LinksNotRead {
  const notRead: LinksNotRead = { tooLong: 0, pastLimit: 0, overTextLimit: 0 };
  let read = 0;
  let textChars = 0;
  for (const { node, textChars: cost } of anchorsOf($)) {
    let reason: keyof LinksNotRead | null = null;
    if (node.attribs.href!.length > MAX_URL_LENGTH) reason = 'tooLong';
    else if (read >= MAX_LINKS_READ) reason = 'pastLimit';
    else if (textChars + cost > MAX_ANCHOR_TEXT_CHARS) reason = 'overTextLimit';
    if (reason) {
      notRead[reason]++;
      delete node.attribs.href;
    } else {
      read++;
      textChars += cost;
    }
  }
  return notRead;
}

export function linksNotReadNote(n: LinksNotRead): string | null {
  const parts = [
    n.tooLong ? `${n.tooLong} with a URL over ${MAX_URL_LENGTH} characters` : null,
    n.pastLimit ? `${n.pastLimit} past the first ${MAX_LINKS_READ} on the page` : null,
    n.overTextLimit
      ? `${n.overTextLimit} whose anchor text would take the page past ${MAX_ANCHOR_TEXT_CHARS} characters of it`
      : null,
  ].filter((p): p is string => p !== null);
  if (!parts.length) return null;
  const total = n.tooLong + n.pastLimit + n.overTextLimit;
  return `${total} ${total === 1 ? 'link was' : 'links were'} not read: ${parts.join('; ')}.`;
}
