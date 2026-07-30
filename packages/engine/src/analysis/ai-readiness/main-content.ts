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
  attribs?: Record<string, string>;
  children?: DomNode[];
}

/**
 * THE STRIP SELECTORS, PARSED ONCE INTO O(1) LOOKUPS.
 *
 * This used to be `$work.find(AI_STRUCTURAL_STRIP).remove()` + `.find(CMP_STRIP_SELECTORS).remove()`.
 * cheerio's `.find()` is QUADRATIC in a node's direct-child count, and this runs on EVERY crawled page,
 * twice. Measured through the real `extractPage` on a 1.8 MB page of 200 000 flat `<h1>` siblings:
 * 176 894 ms with extraction on versus 579 ms with it off — a 232x amplification. The cost is
 * SYNCHRONOUS, so the crawl's wall-clock budget cannot preempt it and Vercel's `maxDuration` kills the
 * function: one page fails the whole audit. It is not only an attacker shape — a legitimate flat HTML
 * index of 40 000 rows cost ~10 s per page. The trigger is sibling WIDTH, not node count (the same node
 * count nested 100-per-parent costs ~60 ms).
 *
 * Note the provenance, because it is the lesson: commit `37ab167` was titled "make SPEC 05 §4 density
 * filter O(n) — kill the O(n^2) CPU DoS on interleaved/wide DOMs". It made the hand-written density walk
 * below O(n) and left these two selector calls, immediately above it, quadratic on the very same input
 * shape. The class was fixed at one instance.
 *
 * DERIVED, not re-listed. Parsing the existing selector constants keeps them the single source of truth:
 * a hand-copied set here would silently stop matching the day someone edits the constant. An unsupported
 * selector shape THROWS at module load — a loud build/test failure rather than a silent no-strip.
 */
function parseStripSelectors(...lists: string[]): {
  tags: Set<string>;
  ids: Set<string>;
  classes: Set<string>;
  roles: Set<string>;
} {
  const tags = new Set<string>();
  const ids = new Set<string>();
  const classes = new Set<string>();
  const roles = new Set<string>();
  for (const list of lists) {
    for (const raw of list.split(',')) {
      const sel = raw.trim();
      if (!sel) continue;
      const role = /^\[role="([^"]+)"\]$/.exec(sel);
      if (role) roles.add(role[1]!);
      else if (sel.startsWith('#')) ids.add(sel.slice(1));
      else if (sel.startsWith('.')) classes.add(sel.slice(1));
      else if (/^[a-z][a-z0-9-]*$/i.test(sel)) tags.add(sel.toLowerCase());
      else throw new Error(`main-content: unsupported strip selector ${JSON.stringify(sel)}`);
    }
  }
  return { tags, ids, classes, roles };
}

const STRIP = parseStripSelectors(AI_STRUCTURAL_STRIP, CMP_STRIP_SELECTORS);

/** O(1) equivalent of "this node matches one of the strip selectors". */
function isStripped(node: DomNode): boolean {
  if (node.name && STRIP.tags.has(node.name)) return true;
  const a = node.attribs;
  if (!a) return false;
  if (a.role !== undefined && STRIP.roles.has(a.role)) return true;
  if (a.id !== undefined && STRIP.ids.has(a.id)) return true;
  if (a.class !== undefined) {
    for (const c of a.class.split(/\s+/)) if (STRIP.classes.has(c)) return true;
  }
  return false;
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
  // No clone and no mutation: stripped nodes are SKIPPED by both passes instead of being spliced out.
  // The clone existed only to protect the caller's DOM from `.remove()`, so with the mutation gone it is
  // pure cost — a full copy of the body subtree on every crawled page.
  const root = $('body').get(0) as unknown as DomNode | undefined;
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
        if (k.type === 'tag' && !isStripped(k)) post.push({ node: k, entered: false });
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
        if (isStripped(kid)) continue; // stripped: contributes no text, and no link count either
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
      if (skip.has(node) || (node.type === 'tag' && isStripped(node))) continue;
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
