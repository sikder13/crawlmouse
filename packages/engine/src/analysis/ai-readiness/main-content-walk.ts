/**
 * `extractMainContent`, computed from a walk the caller already makes. The crawl worker's reader
 * walks every page once to read its links (packages/worker/src/rows/links.ts); this collector rides
 * that walk instead of walking the tree three more times (two strip-set queries and two passes).
 *
 * Its output is `extractMainContent`'s, byte for byte: main-content-walk.test.ts compares the two on
 * every page the engine's and the worker's tests parse, under both parsers, and over generated HTML.
 * What differs is only how it gets there:
 *
 * - The strip set is matched node by node as the walk enters each element, by a matcher built from
 *   the same selector constants (`STRIP_RULES`). Building it throws on a selector it cannot express,
 *   so a constant that grows a new form fails at load rather than matching less.
 * - Subtree stats are summed as the walk leaves each element, and text lengths are counted without
 *   building the collapsed copy of each text node.
 * - The text is one list of parts in document order; a link-dense block that is dropped is a range
 *   of that list, cut out when the result is read.
 */
import type { AnyNode, Element } from 'cheerio';
import {
  AI_STRUCTURAL_STRIP,
  CMP_STRIP_SELECTORS,
  MAX_BLOCK_LINK_DENSITY,
  MENU_AVG_LINK_CHARS,
} from './constants.js';
import { collapseWs, DENSITY_TAGS, MIN_MENU_LINKS } from './main-content.js';

/** One simple selector of the strip set. */
type StripRule =
  | { kind: 'tag'; name: string }
  | { kind: 'equals'; attribute: string; value: string }
  | { kind: 'class'; value: string };

/** The strip set's selectors as rules; a selector of any other form throws. */
export function stripRules(selectors: string): StripRule[] {
  return selectors.split(',').map((raw) => {
    const s = raw.trim();
    let m: RegExpExecArray | null;
    if (/^[a-z][a-z0-9]*$/.test(s)) return { kind: 'tag', name: s };
    if ((m = /^\[([a-z-]+)="([^"\\]*)"\]$/.exec(s))) {
      return { kind: 'equals', attribute: m[1]!, value: m[2]! };
    }
    if ((m = /^#([A-Za-z0-9_-]+)$/.exec(s)))
      return { kind: 'equals', attribute: 'id', value: m[1]! };
    if ((m = /^\.([A-Za-z0-9_-]+)$/.exec(s))) return { kind: 'class', value: m[1]! };
    throw new Error(`main-content-walk: the strip selector ${JSON.stringify(s)} has no rule`);
  });
}

export const STRIP_RULES: readonly StripRule[] = [
  ...stripRules(AI_STRUCTURAL_STRIP),
  ...stripRules(CMP_STRIP_SELECTORS),
];

/** An element, as css-select counts one: a tag, a script or a style. */
const isElement = (n: AnyNode): n is Element =>
  n.type === 'tag' || n.type === 'script' || n.type === 'style';

/** css-select's whitespace for a class list: JavaScript's `\s`. */
const CLASS_SPACE = /\s/;

function hasClass(list: string, value: string): boolean {
  let at = list.indexOf(value);
  while (at !== -1) {
    const before = at === 0 || CLASS_SPACE.test(list[at - 1]!);
    const end = at + value.length;
    const after = end === list.length || CLASS_SPACE.test(list[end]!);
    if (before && after) return true;
    at = list.indexOf(value, at + 1);
  }
  return false;
}

function matches(el: Element, r: StripRule): boolean {
  if (r.kind === 'tag') return el.name === r.name;
  if (r.kind === 'equals') return el.attribs[r.attribute] === r.value;
  const list = el.attribs.class;
  return list !== undefined && hasClass(list, r.value);
}

const stripped = (el: Element): boolean => STRIP_RULES.some((r) => matches(el, r));

/** JavaScript's `\s`, the whitespace `collapseWs` collapses. */
function isSpace(c: number): boolean {
  return (
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
    c === 0xfeff
  );
}

/** `collapseWs(s).length`, without building the collapsed string. */
export function collapsedLength(s: string): number {
  let n = 0;
  let gap = false;
  for (let i = 0; i < s.length; i++) {
    if (isSpace(s.charCodeAt(i))) {
      gap = true;
      continue;
    }
    if (gap && n > 0) n++;
    gap = false;
    n++;
  }
  return n;
}

interface Frame {
  node: AnyNode;
  /** Visited by extractMainContent's stats pass: the root, and tags reached through tags. */
  stats: boolean;
  /** Where this node's text starts in `parts`. */
  start: number;
  textLen: number;
  linkTextLen: number;
  linkCount: number;
}

/**
 * Feed it a whole document in pre-order: `enter` for every node, and `exit` after the descendants of
 * every node that has children. Then `result()` is `extractMainContent($)` for that document.
 */
export class MainContentWalk {
  private root: AnyNode | null = null;
  private done = false;
  /** Nesting inside a stripped element: its descendants are not read. */
  private skip = 0;
  private readonly frames: Frame[] = [];
  private readonly parts: string[] = [];
  /** Dropped link-dense blocks, as ranges of `parts`: start to the furthest end from it. */
  private readonly dropped = new Map<number, number>();
  /** How many blocks the density rule dropped, and whether the result fell back past them (tests). */
  blocksDropped = 0;
  fellBack = false;

  enter(node: AnyNode): void {
    if (this.done) return;
    const hasChildren = 'children' in node;
    if (this.root === null) {
      // `$('body').get(0)`: the first body element in document order.
      if (isElement(node) && node.name === 'body') {
        this.root = node;
        this.frames.push(frame(node, true, 0));
      }
      return;
    }
    if (this.skip > 0) {
      if (hasChildren) this.skip++;
      return;
    }
    const parent = this.frames[this.frames.length - 1]!;
    if (node.type === 'text') {
      this.parts.push(node.data);
      if (parent.stats) parent.textLen += collapsedLength(node.data);
      return;
    }
    if (isElement(node) && stripped(node)) {
      this.skip = 1;
      return;
    }
    if (hasChildren) {
      this.frames.push(frame(node, parent.stats && node.type === 'tag', this.parts.length));
    }
  }

  exit(node: AnyNode): void {
    if (this.done || this.root === null) return;
    if (this.skip > 0) {
      this.skip--;
      return;
    }
    const f = this.frames.pop();
    if (f?.node !== node) throw new Error('main-content-walk: exit out of order');
    if (f.stats) this.settle(f);
    if (node === this.root) this.done = true;
  }

  /** The element's stats are complete: decide whether it is a menu, and add them to its parent's. */
  private settle(f: Frame): void {
    const el = f.node as Element;
    if (el.name === 'a') f.linkTextLen = f.textLen;
    if (
      DENSITY_TAGS.has(el.name) &&
      f.linkCount >= MIN_MENU_LINKS &&
      f.textLen > 0 &&
      f.linkTextLen / f.textLen >= MAX_BLOCK_LINK_DENSITY &&
      f.textLen / f.linkCount < MENU_AVG_LINK_CHARS
    ) {
      const end = this.parts.length;
      this.dropped.set(f.start, Math.max(end, this.dropped.get(f.start) ?? 0));
      this.blocksDropped++;
    }
    const parent = this.frames[this.frames.length - 1];
    if (parent?.stats) {
      parent.textLen += f.textLen;
      parent.linkTextLen += f.linkTextLen;
      parent.linkCount += f.linkCount + (el.name === 'a' ? 1 : 0);
    }
  }

  result(): { mainTextChars: number; text: string } {
    if (this.root === null) return { mainTextChars: 0, text: '' };
    const fallback = this.fallsBack();
    const text = collapseWs((fallback ? this.parts : this.kept()).join(''));
    return { mainTextChars: text.length, text };
  }

  /**
   * `result().text.slice(0, chars)`, collapsing only as much of the text as that needs: the parts
   * up to a raw length, doubled until their collapsed text reaches `chars` or the parts run out.
   * A collapsed prefix agrees with the whole text's collapse wherever it reaches.
   */
  textPrefix(chars: number): string {
    if (this.root === null || chars <= 0) return '';
    const parts = this.fallsBack() ? this.parts : this.kept();
    let target = chars;
    for (;;) {
      const taken: string[] = [];
      let raw = 0;
      let k = 0;
      for (; k < parts.length && raw < target; k++) {
        taken.push(parts[k]!);
        raw += parts[k]!.length;
      }
      const text = collapseWs(taken.join(''));
      if (text.length >= chars || k === parts.length) return text.slice(0, chars);
      target *= 2;
    }
  }

  /** The parts outside every dropped block. */
  private kept(): string[] {
    const kept: string[] = [];
    for (let i = 0; i < this.parts.length; ) {
      const end = this.dropped.get(i);
      if (end !== undefined && end > i) {
        i = end;
        continue;
      }
      kept.push(this.parts[i]!);
      i++;
    }
    return kept;
  }

  /**
   * As extractMainContent: an all-links page, whose text the density drop emptied, keeps its text
   * from before the drop. Empty after collapsing means every kept part is whitespace.
   */
  private fallsBack(): boolean {
    if (this.dropped.size === 0) return false;
    const empty = this.kept().every((p) => collapsedLength(p) === 0);
    if (empty) this.fellBack = true;
    return empty;
  }
}

const frame = (node: AnyNode, stats: boolean, start: number): Frame => ({
  node,
  stats,
  start,
  textLen: 0,
  linkTextLen: 0,
  linkCount: 0,
});
