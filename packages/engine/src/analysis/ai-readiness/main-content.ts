import type * as cheerio from 'cheerio';
import {
  AI_STRUCTURAL_STRIP,
  CMP_STRIP_SELECTORS,
  MAX_BLOCK_LINK_DENSITY,
  MENU_AVG_LINK_CHARS,
} from './constants.js';

/** Candidate block containers judged for link-density (a menu/link-list is dropped from the main text). */
const DENSITY_TAGS = new Set(['ul', 'ol', 'div', 'section', 'form']);
/** A block with at least this many links is eligible to be judged a menu; fewer links is prose. */
const MIN_MENU_LINKS = 3;

/** Minimal structural view of a domhandler node (cheerio's underlying DOM). */
interface DomNode {
  type: string;
  name?: string;
  data?: string;
  children?: DomNode[];
}
interface Stats {
  textLen: number;
  linkTextLen: number;
  linkCount: number;
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * §4.1 — deterministic, O(n) main-content extraction. Operates on a CLONE of `<body>` (the js-detect.ts:79
 * idiom) so the shared `$` — reused for link + title extraction in extractPage — is NEVER mutated, and no
 * second `cheerio.load` runs (§4.1).
 *
 * Cost is O(n) and nesting-depth-safe: after the structural + CMP strip, a SINGLE iterative post-order pass
 * computes per-element subtree stats (text length, link-text length, link count) — each node visited once,
 * reading only its direct children's memoized stats. The explicit heap stacks mean arbitrary nesting can't
 * overflow the call stack, and there are NO per-block `.text()`/`.find()` re-walks (the O(depth^2) trap:
 * two density blocks nested through a non-density wrapper made every ancestor re-walk the shared subtree).
 *
 * Link-dense boilerplate (a menu/link list) is dropped at the CONTAINER level, but ONLY when its links are
 * SHORT on average (`MENU_AVG_LINK_CHARS`) — so a card grid / blog index (link-dense but each link wraps a
 * real title+blurb) is KEPT. A pre-density fallback guarantees the "What AI Sees" excerpt is never blank.
 */
export function extractMainContent($: cheerio.CheerioAPI): { mainTextChars: number; text: string } {
  const $work = $('body').clone();
  $work.find(AI_STRUCTURAL_STRIP).remove();
  $work.find(CMP_STRIP_SELECTORS).remove();
  const root = $work.get(0) as unknown as DomNode | undefined;
  if (!root) return { mainTextChars: 0, text: '' };

  // ── Pass 1: iterative post-order subtree stats + drop decisions. O(n). ──
  const stats = new Map<DomNode, Stats>();
  const dropped = new Set<DomNode>();
  const post: Array<{ node: DomNode; entered: boolean }> = [{ node: root, entered: false }];
  while (post.length) {
    const frame = post[post.length - 1]!;
    const node = frame.node;
    if (!frame.entered) {
      frame.entered = true;
      const kids = node.children ?? [];
      for (let i = kids.length - 1; i >= 0; i--) {
        const k = kids[i]!;
        if (k.type === 'tag') post.push({ node: k, entered: false });
      }
      continue; // process children before this node (true post-order)
    }
    post.pop();
    let textLen = 0;
    let linkTextLen = 0;
    let linkCount = 0;
    for (const kid of node.children ?? []) {
      if (kid.type === 'text') {
        textLen += collapseWs(kid.data ?? '').length;
      } else if (kid.type === 'tag') {
        const s = stats.get(kid);
        if (s) {
          textLen += s.textLen;
          linkTextLen += s.linkTextLen;
          linkCount += s.linkCount;
        }
        if (kid.name === 'a') linkCount += 1;
      }
    }
    if (node.name === 'a') linkTextLen = textLen; // all text under an anchor is link text
    stats.set(node, { textLen, linkTextLen, linkCount });
    if (node.name && DENSITY_TAGS.has(node.name) && linkCount >= MIN_MENU_LINKS && textLen > 0) {
      const density = linkTextLen / textLen;
      const avgLinkText = textLen / linkCount;
      if (density >= MAX_BLOCK_LINK_DENSITY && avgLinkText < MENU_AVG_LINK_CHARS) dropped.add(node);
    }
  }

  // ── Pass 2: iterative pre-order text build, skipping any dropped (link-dense) subtree. O(n). ──
  const build = (skip: Set<DomNode>): string => {
    const parts: string[] = [];
    const st: DomNode[] = [root];
    while (st.length) {
      const node = st.pop()!;
      if (skip.has(node)) continue;
      if (node.type === 'text') {
        parts.push(node.data ?? '');
        continue;
      }
      const kids = node.children ?? [];
      for (let i = kids.length - 1; i >= 0; i--) st.push(kids[i]!);
    }
    return collapseWs(parts.join(''));
  };

  let text = build(dropped);
  // Fallback: if density stripping emptied the content (an all-links page), keep the pre-density text so
  // the "What AI Sees" excerpt is never blank.
  if (text.length === 0 && dropped.size > 0) text = build(new Set());
  return { mainTextChars: text.length, text };
}
