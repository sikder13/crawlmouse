import { ImpliedBody } from '@crawlmouse/engine/worker';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'cheerio';
import { DomHandler } from 'domhandler';
import { Parser } from 'htmlparser2';
import { MAX_KEPT_BYTES, type FetchOutcome } from '../fetch/fetcher.js';
import { headerValue } from '../verdict/response.js';

/**
 * The text of a page as served, before any script runs: the body's text nodes, joined with a space
 * (so adjacent elements do not run their words together), skipping script, style, noscript, template
 * and svg content. Words are runs of non-space characters in it. The control and each crawler are
 * counted the same way, which is what the thin comparison needs.
 *
 * The body is the body element at the top of the document or under its `<html>`. A page with no body
 * element anywhere is read from the body its HTML implies (the engine's ImpliedBody), as a browser
 * builds it; a page with one only lower down is read whole, as before.
 */

/**
 * The response's media type: its Content-Type before any parameters, trimmed (headerValue lowercases
 * it). With none sent, or an empty one, the body decides as a browser sniffs it: `text/html` when it
 * starts, after whitespace and a byte order mark, with a tag that is not an XML declaration, and
 * empty otherwise. Node's HTTP client keeps the first of duplicated Content-Type headers, so a real
 * response carries one.
 */
export function mediaTypeOf(f: FetchOutcome): string {
  const type = headerValue(f.headers, 'content-type').split(';')[0]!.trim();
  if (type) return type;
  return /^[\s\uFEFF]*<(?!\?xml)/i.test(f.body) ? 'text/html' : '';
}

/** The media types read as HTML: the response's must be one of these exactly. */
export const HTML_MEDIA_TYPES: readonly string[] = ['text/html', 'application/xhtml+xml'];

/** HTML or XHTML, by its media type (mediaTypeOf). */
export const isHtml = (f: FetchOutcome): boolean => HTML_MEDIA_TYPES.includes(mediaTypeOf(f));

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

/** Read for text: the document, and elements other than the skipped ones. */
const readInto = (node: AnyNode): boolean =>
  (node.type === 'tag' && !SKIPPED.has(node.name)) || node.type === 'root';

const joined = (parts: readonly string[]): string => parts.join(' ').replace(/\s+/g, ' ').trim();

/** Reads the text out of a parsed document, without changing it. Iterative, so deep nesting cannot overflow the stack. */
export function servedText($: cheerio.CheerioAPI): string {
  const root = $.root()[0]!;
  const body = bodyOf($);
  if (body === root) {
    const implied = impliedBodyText(root);
    if (implied !== null) return implied;
  }
  const stack: AnyNode[] = [body];
  const parts: string[] = [];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.type === 'text') parts.push(node.data);
    else if (readInto(node) && 'children' in node) {
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
    }
  }
  return joined(parts);
}

/**
 * The text of the body a document implies; null when it has a body element after all, lower down.
 * ImpliedBody sees every node, including those inside skipped elements, whose text is not read.
 */
function impliedBodyText(root: AnyNode): string | null {
  const implied = new ImpliedBody();
  const parts: string[] = [];
  // Nesting inside elements whose text is not read.
  let skipped = 0;
  const stack: Array<{ node: AnyNode; exit: boolean }> = [{ node: root, exit: false }];
  while (stack.length) {
    const { node, exit } = stack.pop()!;
    if (exit) {
      implied.exit(node);
      if (!readInto(node)) skipped--;
      continue;
    }
    if (node.type === 'tag' && node.name === 'body') return null;
    implied.enter(node);
    if (node.type === 'text') {
      if (skipped === 0 && implied.state === 'body') parts.push(node.data);
      continue;
    }
    if (!('children' in node)) continue;
    if (!readInto(node)) skipped++;
    stack.push({ node, exit: true });
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ node: node.children[i]!, exit: false });
    }
  }
  // A frameset that left the page no body leaves it no text.
  return implied.state === 'body' ? joined(parts) : '';
}

/** Thrown inside the parse when the document nests past MAX_DOM_DEPTH, so the parse stops there. */
class TooDeep extends Error {}

/**
 * Builds the document as htmlparser2 parses it, counting element depth as tags open and close (as
 * domDepth counts it: script and style elements hold only text and add no level). Past MAX_DOM_DEPTH
 * it throws, so the parse stops at that point. Checking after the parse was too late: each stray
 * close tag makes the parser search every open element, so a page of unclosed tags parses in time
 * that grows with the square of its length (700 KB of `<em></p>` took 14.5 s on a workstation).
 * Stopped at the limit, the parser never holds more than MAX_DOM_DEPTH open elements.
 */
class DepthLimitedHandler extends DomHandler {
  private depth = 0;

  override onopentag(name: string, attribs: Record<string, string>): void {
    super.onopentag(name, attribs);
    if (this.tagStack[this.tagStack.length - 1]!.type === 'tag' && ++this.depth > MAX_DOM_DEPTH)
      throw new TooDeep();
  }

  override onclosetag(): void {
    if (this.tagStack[this.tagStack.length - 1]!.type === 'tag') this.depth--;
    super.onclosetag();
  }
}

const PARSE_OPTIONS = { xmlMode: false, decodeEntities: true };

/**
 * Parses HTML the way the v1 crawler does (Crawlee's CheerioCrawler): htmlparser2 in HTML mode, which
 * is linear in nesting depth where cheerio's default parser is not. Null when the document nests deeper
 * than MAX_DOM_DEPTH, found while parsing.
 */
export function parseHtml(html: string): cheerio.CheerioAPI | null {
  const handler = new DepthLimitedHandler(null, PARSE_OPTIONS);
  try {
    new Parser(handler, PARSE_OPTIONS).end(html);
  } catch (e) {
    if (e instanceof TooDeep) return null;
    throw e;
  }
  return cheerio.load(handler.root, { xml: PARSE_OPTIONS });
}

/**
 * The most tags a page is read to. A parsed document's size follows its tags, not its bytes: 2 MiB of
 * `<p>w` parsed to 215 MiB, against 2 MiB for 2 MiB of words (measured). Counted as `<` characters, so
 * closing tags and a `<` in script text count too.
 */
export const MAX_READ_TAGS = 200_000;

export const TOO_DEEP = `The page nests elements more than ${MAX_DOM_DEPTH} deep, deeper than browsers build, so it was not read.`;
export const READ_IN_PART = `Only the first ${MAX_KEPT_BYTES / 1048576} MiB of this page were read for its text and links.`;
export const READ_IN_PART_TAGS = `Only the first ${MAX_READ_TAGS} tags of this page were read for its text and links.`;

/** Where the tag after the first MAX_READ_TAGS starts; -1 when there are no more than that. */
function pastTagLimit(html: string): number {
  let at = -1;
  for (let n = 0; n <= MAX_READ_TAGS; n++) {
    at = html.indexOf('<', at + 1);
    if (at === -1) return -1;
  }
  return at;
}

/**
 * A response's HTML, parsed, or why it was not read in full, or at all. Read to MAX_KEPT_BYTES (the
 * fetcher keeps no more; a body handed over longer, a test's say, is read to as many characters) and
 * to MAX_READ_TAGS tags, whichever comes first.
 */
export function readHtml(f: Pick<FetchOutcome, 'body' | 'bodyCut'>): {
  $: cheerio.CheerioAPI | null;
  note: string | null;
} {
  const over = f.body.length > MAX_KEPT_BYTES;
  let html = over ? f.body.slice(0, MAX_KEPT_BYTES) : f.body;
  const past = pastTagLimit(html);
  if (past !== -1) html = html.slice(0, past);
  const $ = parseHtml(html);
  if (!$) return { $: null, note: TOO_DEEP };
  if (past !== -1) return { $, note: READ_IN_PART_TAGS };
  return { $, note: f.bodyCut || over ? READ_IN_PART : null };
}

export const NOT_HTML = 'The response was not HTML, so it carries no page text: 0 words.';

/** Words in a response: 0 when it is not HTML, null when it could not be read; and what limits the count. */
export function wordsIn(f: FetchOutcome): { words: number | null; note: string | null } {
  if (!isHtml(f)) return { words: 0, note: NOT_HTML };
  const { $, note } = readHtml(f);
  return { words: $ ? countWords(servedText($)) : null, note };
}
