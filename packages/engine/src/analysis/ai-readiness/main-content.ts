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
 * THE STRIP SET — cheerio stays the matcher; only the REMOVAL was the problem.
 *
 * This began as `$work.find(AI_STRUCTURAL_STRIP).remove()` on a `$('body').clone()`, twice per page.
 * `.find()` is QUADRATIC in the searched node's direct-child count: measured through the real
 * `extractPage`, a 1.8 MB page of 200 000 flat `<h1>` siblings cost 176 894 ms against 579 ms with
 * extraction off. The cost is SYNCHRONOUS, so the crawl's wall-clock budget cannot preempt it and
 * Vercel's `maxDuration` kills the function — one page fails the whole audit. Not only an attacker
 * shape: a legitimate flat HTML index of 40 000 rows cost ~10 s per page. The trigger is sibling WIDTH,
 * not node count — the same node count nested 100-per-parent costs ~60 ms.
 *
 * A ROOT-LEVEL `$(sel)` IS LINEAR WHERE `.find(sel)` IS NOT. Measured on the same fixtures:
 *
 *   shape                    clone + .find().remove()      $(sel) -> Set + one walk
 *   40 000 flat siblings                    4 444 ms                        24 ms
 *   200 000 flat siblings (1.8 MB)        108 569 ms                       152 ms
 *   20 000 <nav> siblings                   1 637 ms                        16 ms
 *   ordinary page (3 000 blocks)               14 ms                         8 ms
 *
 * So the fix is to keep cheerio as the matcher and change only HOW the matches are applied: collect the
 * matched nodes once, then skip them (and their subtrees) during the single walk the density filter
 * already performs. No clone, no mutation, no removal.
 *
 * WHY NOT A HAND-ROLLED MATCHER. A previous attempt parsed these constants into tag/id/class/role sets
 * and tested each node itself. It was fast and it was WRONG: domhandler does not give every element
 * `type: 'tag'` — `<script>` is `'script'` and `<style>` is `'style'` — so the two highest-value strip
 * targets were never tested, and inline script/style bodies became "main content". On a Next.js shell
 * that inverted the flagship signal: `js_blind` -> `readable`, `contentWithoutJs` 0 -> 1.0 (weight 40),
 * AI score 33 `at_risk` -> 89 `ready`, and every `js_blind_page` finding silently vanished. Hand-rolling
 * a CSS matcher means owning CSS semantics — tag-name and attribute case rules, class token splitting,
 * and a DOM library's own type discriminants. Cheerio already owns them correctly, and code that does
 * not exist cannot diverge from it.
 *
 * ROOT IS EXCLUDED, deliberately: `.find()` searches DESCENDANTS ONLY, so it could never strip `<body>`
 * itself. A `$(sel)` query can (`<body role="banner">` is valid, if poor, ARIA), and the hand-rolled
 * version did — blanking the entire page and reporting a false `thin_page` on a fully server-rendered
 * site. Excluding root preserves the original semantic exactly.
 */
function buildStripSet($: cheerio.CheerioAPI, root: unknown): Set<unknown> {
  const stripped = new Set<unknown>();
  for (const selector of [AI_STRUCTURAL_STRIP, CMP_STRIP_SELECTORS]) {
    $(selector).each((_, el) => {
      if ((el as unknown) !== root) stripped.add(el as unknown);
    });
  }
  return stripped;
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
 * §4.1 — deterministic, O(n) main-content extraction. READ-ONLY over the shared `<body>` — it clones nothing and mutates nothing (the js-detect.ts:79
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
  // The clone existed only to protect the caller's DOM from `.remove()`; with the mutation gone it is
  // pure cost — a full copy of the body subtree on every crawled page — and it was also a latent crash,
  // since it recurses: `$('body').clone()` throws `Maximum call stack size exceeded` on a 22 KB page
  // nested ~2 000 deep, where this walk returns normally.
  const root = $('body').get(0) as unknown as DomNode | undefined;
  if (!root) return { mainTextChars: 0, text: '' };
  const stripped = buildStripSet($, root);

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
        if (k.type === 'tag' && !stripped.has(k)) post.push({ node: k, entered: false });
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
        if (stripped.has(kid)) continue; // stripped: contributes no text, and no link count either
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
      if (skip.has(node) || stripped.has(node)) continue;
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
