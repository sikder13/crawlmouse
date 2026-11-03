/**
 * The body a page implies when it has no `<body>` element.
 *
 * htmlparser2, which the crawl worker parses with, builds only the elements a page writes: a page with
 * no `<body>` tag has no body element, and its main content was read as empty. A browser, and parse5
 * (cheerio's default parser), build one. They read the page in order, keep head content in the head,
 * and start the body at the first node that is not head content (WHATWG HTML, tree construction: the
 * "before head", "in head" and "after head" insertion modes, and the frameset-ok flag of "in body").
 *
 * ImpliedBody follows those rules over htmlparser2's tree. Feed it the document in pre-order, as
 * MainContentWalk is fed: `enter` for every node, and `exit` after the descendants of every node that
 * has children. After each `enter`, `state` says where that node is:
 *
 * - `head`: not yet in the body. From the start of the document, these stay out of it: whitespace
 *   text, comments and the doctype; the HEAD_WRAPPERS, whose contents are read in turn; the
 *   HEAD_EMPTY elements, which the parser closes at once, so what htmlparser2 nests in one follows
 *   it; and the HEAD_HOLDING elements with everything inside them. `<noscript>` holds its content in
 *   the head only until a `<head>` element has closed: after that, the parser starts the body at it.
 * - `body`: the first other node starts the body, and it and every node after it are body content.
 *   A later `<head>` or `<html>` tag only wraps body content: the parser ignores those tags there.
 * - `none`: the page has no body. A `<frameset>` before the body starts means none. After the body
 *   starts, a `<frameset>` replaces it while the frameset-ok flag holds: until text that is not
 *   whitespace, or one of the FRAMESET_OK_OFF elements (an `<input>` unless its type is hidden),
 *   has been read in the body or in a `<template>`, outside the RAW_TEXT elements.
 *
 * It is told nothing about `<body>` elements: a page that has one anywhere is read from the first
 * one, as before, and its callers check for that first.
 */
import type { AnyNode } from 'cheerio';

/** Read through: what they hold is classified in turn. */
export const HEAD_WRAPPERS: readonly string[] = ['html', 'head'];
/** Kept in the head, and void to the parser: they hold nothing. */
export const HEAD_EMPTY: readonly string[] = ['base', 'basefont', 'bgsound', 'link', 'meta'];
/** Kept in the head with everything inside them. */
export const HEAD_HOLDING: readonly string[] = [
  'title',
  'noframes',
  'noscript',
  'script',
  'style',
  'template',
];
/** Elements whose start clears the frameset-ok flag. */
export const FRAMESET_OK_OFF: readonly string[] = [
  'pre',
  'listing',
  'li',
  'dd',
  'dt',
  'button',
  'applet',
  'marquee',
  'object',
  'table',
  'area',
  'br',
  'embed',
  'img',
  'image',
  'keygen',
  'wbr',
  'input',
  'hr',
  'textarea',
  'xmp',
  'iframe',
  'select',
];
/** Elements the parser reads as text: what is inside them clears nothing. */
export const RAW_TEXT: readonly string[] = [
  'script',
  'style',
  'title',
  'textarea',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
];

const WRAPPERS = new Set(HEAD_WRAPPERS);
const EMPTY = new Set(HEAD_EMPTY);
const HOLDING = new Set(HEAD_HOLDING);
const OFF = new Set(FRAMESET_OK_OFF);
const RAW = new Set(RAW_TEXT);

/** HTML's whitespace: space, tab, line feed, form feed and carriage return. A no-break space is not. */
export const HTML_WHITESPACE = ' \t\n\f\r';
const HTML_SPACE = new RegExp(`^[${HTML_WHITESPACE}]*$`);

/** An element's name, as htmlparser2 types elements (script and style have types of their own). */
const nameOf = (n: AnyNode): string | null =>
  n.type === 'tag' || n.type === 'script' || n.type === 'style' ? n.name : null;

export type ImpliedState = 'head' | 'body' | 'none';

export class ImpliedBody {
  state: ImpliedState = 'head';
  /** Nesting inside head content held with its contents (and CDATA, which the parser reads as a comment). */
  private held = 0;
  /** Nesting inside RAW_TEXT elements, and CDATA. */
  private raw = 0;
  /** Nesting inside `<template>`. */
  private template = 0;
  private headClosed = false;
  private framesetOk = true;

  enter(node: AnyNode): void {
    if (this.state === 'none') return;
    const name = nameOf(node);
    if (
      this.framesetOk &&
      this.raw === 0 &&
      (this.state === 'body' || this.template > 0) &&
      clearsFramesetOk(node, name)
    ) {
      this.framesetOk = false;
    }
    if (name === 'frameset' && this.raw === 0 && this.held === 0) {
      if (this.state === 'head' || this.framesetOk) {
        this.state = 'none';
        return;
      }
    }
    if (name !== null) {
      if (RAW.has(name)) this.raw++;
      if (name === 'template') this.template++;
    } else if (node.type === 'cdata') this.raw++;
    if (this.state !== 'head') return;
    if (this.holds(node, name)) {
      this.held++;
      return;
    }
    if (this.held > 0) return;
    if (node.type === 'text') {
      if (!HTML_SPACE.test(node.data)) this.state = 'body';
      return;
    }
    // The document, a comment, a doctype.
    if (name === null) return;
    if (WRAPPERS.has(name) || EMPTY.has(name)) return;
    this.state = 'body';
  }

  exit(node: AnyNode): void {
    if (this.state === 'none') return;
    const name = nameOf(node);
    if (name !== null) {
      if (RAW.has(name)) this.raw--;
      if (name === 'template') this.template--;
    } else if (node.type === 'cdata') this.raw--;
    if (this.state !== 'head') return;
    if (this.held > 0) {
      if (this.holds(node, name)) this.held--;
      return;
    }
    if (name === 'head') this.headClosed = true;
  }

  /** Head content kept with its contents, here. */
  private holds(node: AnyNode, name: string | null): boolean {
    if (node.type === 'cdata') return true;
    if (name === null || !HOLDING.has(name)) return false;
    return name !== 'noscript' || !this.headClosed;
  }
}

function clearsFramesetOk(node: AnyNode, name: string | null): boolean {
  if (node.type === 'text') return !HTML_SPACE.test(node.data);
  if (name === null || !OFF.has(name)) return false;
  if (name !== 'input' || node.type !== 'tag') return true;
  return (node.attribs.type ?? '').toLowerCase() !== 'hidden';
}
