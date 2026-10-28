import * as cheerio from 'cheerio';
import type { AnyNode } from 'cheerio';
import type { FetchOutcome } from '../fetch/fetcher.js';
import { headerValue } from '../verdict/response.js';

/**
 * The text of a page as served, before any script runs: the body's text nodes, joined with a space
 * (so adjacent elements do not run their words together), skipping script, style, noscript, template
 * and svg content. Words are runs of non-space characters in it. The control and each crawler are
 * counted the same way, which is what the thin comparison needs.
 */

export const isHtml = (f: FetchOutcome): boolean =>
  headerValue(f.headers, 'content-type').includes('html');

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

/**
 * How much of an HTML response is parsed. A parsed document takes many times its size in memory, so
 * a page larger than this is read up to here, and its row says so.
 */
export const MAX_READ_CHARS = 2_000_000;

export const TOO_DEEP = `The page nests elements more than ${MAX_DOM_DEPTH} deep, deeper than browsers build, so it was not read.`;
export const READ_IN_PART = `Only the first ${MAX_READ_CHARS} characters of this page were read for its text and links.`;

/** The start of an HTML body, parsed; or why it was not read in full, or at all. */
export function readHtml(body: string): { $: cheerio.CheerioAPI | null; note: string | null } {
  const inPart = body.length > MAX_READ_CHARS;
  const $ = parseHtml(inPart ? body.slice(0, MAX_READ_CHARS) : body);
  if (!$) return { $: null, note: TOO_DEEP };
  return { $, note: inPart ? READ_IN_PART : null };
}

/** Words in an HTML response, null when it is not HTML or could not be read, and what limits the count. */
export function wordsIn(f: FetchOutcome): { words: number | null; note: string | null } {
  if (!isHtml(f)) return { words: null, note: null };
  const { $, note } = readHtml(f.body);
  return { words: $ ? countWords(servedText($)) : null, note };
}
