import type * as cheerio from 'cheerio';
import type { AnyNode } from 'cheerio';

/**
 * Bounds what link extraction can cost before the engine's extractPage sees a page. extractPage
 * builds a URL and an anchor text for every `a[href]`, so a hostile page could otherwise spend the
 * worker's memory on links it would never record:
 *
 * - a link nested inside another link (invalid HTML that browsers do not build) is not read, so no
 *   anchor's text contains another's;
 * - an href longer than MAX_URL_LENGTH is not read;
 * - links past the first MAX_LINKS_READ on the page are not read.
 *
 * Unread links lose their href in the parsed document, so `a[href]` no longer matches them. The counts
 * go into the page's limitations.
 */

export const MAX_LINKS_READ = 2000;
/** The longest URL the worker reads as a link or links from; the request schema holds URLs to the same. */
export const MAX_URL_LENGTH = 2048;

export interface LinksNotRead {
  nested: number;
  tooLong: number;
  pastLimit: number;
}

export function limitLinks($: cheerio.CheerioAPI): LinksNotRead {
  const notRead: LinksNotRead = { nested: 0, tooLong: 0, pastLimit: 0 };
  let read = 0;
  const stack: Array<[AnyNode, boolean]> = $.root()
    .toArray()
    .map((n) => [n, false]);
  while (stack.length) {
    const [node, insideLink] = stack.pop()!;
    if (node.type !== 'tag' && node.type !== 'root') continue;
    let childrenInside = insideLink;
    const href = node.type === 'tag' && node.name === 'a' ? node.attribs.href : undefined;
    if (href !== undefined && node.type === 'tag') {
      childrenInside = true;
      const reason: keyof LinksNotRead | null = insideLink
        ? 'nested'
        : href.length > MAX_URL_LENGTH
          ? 'tooLong'
          : read >= MAX_LINKS_READ
            ? 'pastLimit'
            : null;
      if (reason) {
        notRead[reason]++;
        delete node.attribs.href;
      } else {
        read++;
      }
    }
    for (let i = node.children.length - 1; i >= 0; i--)
      stack.push([node.children[i]!, childrenInside]);
  }
  return notRead;
}

export function linksNotReadNote(n: LinksNotRead): string | null {
  const parts = [
    n.nested ? `${n.nested} nested inside another link` : null,
    n.tooLong ? `${n.tooLong} with a URL over ${MAX_URL_LENGTH} characters` : null,
    n.pastLimit ? `${n.pastLimit} past the first ${MAX_LINKS_READ} on the page` : null,
  ].filter((p): p is string => p !== null);
  if (!parts.length) return null;
  const total = n.nested + n.tooLong + n.pastLimit;
  return `${total} ${total === 1 ? 'link was' : 'links were'} not read: ${parts.join('; ')}.`;
}
