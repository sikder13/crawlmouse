import * as cheerio from 'cheerio';
import type { AnyNode } from 'cheerio';
import { MAX_KEPT_BYTES, type FetchOutcome } from '../fetch/fetcher.js';
import { headerValue } from '../verdict/response.js';

/**
 * The text of a page as served, before any script runs: the body's text nodes, joined with a space
 * (so adjacent elements do not run their words together), skipping script, style, noscript, template
 * and svg content. Words are runs of non-space characters in it. The control and each crawler are
 * counted the same way, which is what the thin comparison needs.
 */

/**
 * The response's media type, from its Content-Type without parameters, or, with none sent, `text/html`
 * when the body starts with a tag (as browsers sniff) and empty otherwise.
 */
export function mediaTypeOf(f: FetchOutcome): string {
  const type = headerValue(f.headers, 'content-type').split(';')[0]!.trim();
  if (type) return type;
  return /^[\s\uFEFF]*</.test(f.body) ? 'text/html' : '';
}

/** HTML or XHTML, by its media type. */
export const isHtml = (f: FetchOutcome): boolean => mediaTypeOf(f).includes('html');

export const countWords = (text: string): number => text.match(/\S+/g)?.length ?? 0;

const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'svg']);

/**
 * Pages nested deeper than this are not read. Browsers' HTML parsers stop nesting at about this depth
 * (Chromium's tree builder caps it at 512), and cheerio's selectors slow superlinearly past it, so a
 * hostile page could otherwise stall the worker.
 */
export const MAX_DOM_DEPTH = 512;

const childrenOf = (node: AnyNode): readonly AnyNode[] =>
  node.type === 'tag' || node.type === 'root' || node.type === 'script' || node.type === 'style'
    ? node.children
    : [];

/** The deepest element nesting in the document, counted without recursion. */
export function domDepth($: cheerio.CheerioAPI): number {
  let max = 0;
  const stack: Array<[AnyNode, number]> = $.root()
    .toArray()
    .map((n) => [n, 0]);
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (depth > max) max = depth;
    for (const child of childrenOf(node))
      stack.push([child, child.type === 'tag' ? depth + 1 : depth]);
  }
  return max;
}

/** The body element, found by walking down from the root rather than by a selector. */
function bodyOf($: cheerio.CheerioAPI): AnyNode {
  const root = $.root()[0]!;
  for (const top of childrenOf(root)) {
    if (top.type === 'tag' && top.name === 'body') return top;
    if (top.type === 'tag' && top.name === 'html') {
      const body = childrenOf(top).find((n) => n.type === 'tag' && n.name === 'body');
      if (body) return body;
    }
  }
  return root;
}

/** Reads the text out of a parsed document, without changing it. Iterative, so deep nesting cannot overflow the stack. */
export function servedText($: cheerio.CheerioAPI): string {
  const stack: AnyNode[] = [bodyOf($)];
  const parts: string[] = [];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.type === 'text') parts.push(node.data);
    else if ((node.type === 'tag' && !SKIPPED.has(node.name)) || node.type === 'root') {
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parses HTML the way the v1 crawler does (Crawlee's CheerioCrawler): htmlparser2 in HTML mode, which
 * is linear in nesting depth where cheerio's default parser is not. Null when the document nests deeper
 * than MAX_DOM_DEPTH.
 */
export function parseHtml(html: string): cheerio.CheerioAPI | null {
  const $ = cheerio.load(html, { xml: { xmlMode: false, decodeEntities: true } });
  return domDepth($) > MAX_DOM_DEPTH ? null : $;
}

export const TOO_DEEP = `The page nests elements more than ${MAX_DOM_DEPTH} deep, deeper than browsers build, so it was not read.`;
export const READ_IN_PART = `Only the first ${MAX_KEPT_BYTES / 1048576} MiB of this page were read for its text and links.`;

/**
 * A response's HTML, parsed, or why it was not read in full, or at all. Read to MAX_KEPT_BYTES: the
 * fetcher keeps no more, and a body handed over longer (a test's, say) is read to as many characters.
 */
export function readHtml(f: FetchOutcome): { $: cheerio.CheerioAPI | null; note: string | null } {
  const over = f.body.length > MAX_KEPT_BYTES;
  const $ = parseHtml(over ? f.body.slice(0, MAX_KEPT_BYTES) : f.body);
  if (!$) return { $: null, note: TOO_DEEP };
  return { $, note: f.bodyCut || over ? READ_IN_PART : null };
}

export const NOT_HTML = 'The response was not HTML, so it carries no page text: 0 words.';

/** Words in a response: 0 when it is not HTML, null when it could not be read; and what limits the count. */
export function wordsIn(f: FetchOutcome): { words: number | null; note: string | null } {
  if (!isHtml(f)) return { words: 0, note: NOT_HTML };
  const { $, note } = readHtml(f);
  return { words: $ ? countWords(servedText($)) : null, note };
}
