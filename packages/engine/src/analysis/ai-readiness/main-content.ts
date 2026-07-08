import type * as cheerio from 'cheerio';
import { AI_STRUCTURAL_STRIP, CMP_STRIP_SELECTORS, MAX_BLOCK_LINK_DENSITY } from './constants.js';

/** A block with at least this many links AND high link-density is a menu/widget, not prose. */
const MIN_MENU_LINKS = 3;

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * §4.1 — deterministic main-content extraction. Operates on a CLONE of `<body>` (the same idiom as
 * js-detect.ts:79) so the shared `$` — reused for link + title extraction in extractPage — is NEVER
 * mutated, and no second `cheerio.load` runs (§4.1). Steps:
 *   1. structural strip (nav/footer/header/aside/script/style/noscript/landmarks — see AI_STRUCTURAL_STRIP);
 *   2. exact-id/class CMP consent-dialog strip (NO wildcards — a hero `class="banner"` survives, A3);
 *   3. Kohlschütter shallow density filter: drop a residual block ONLY when it is a genuine link list
 *      (>= MIN_MENU_LINKS links) AND link text dominates it — so prose with one or two links is untouched.
 * Returns the collapsed main text and its length.
 */
const DENSITY_BLOCK_SELECTOR = 'ul, ol, div, section, form';

export function extractMainContent($: cheerio.CheerioAPI): { mainTextChars: number; text: string } {
  // `cheerio.load` always wraps content in <html><head><body>, so `$('body')` is the content root.
  // Clone it (never $.root(), which would drag <head>/<title> into the text) so the shared `$` is intact.
  const $work = $('body').clone();
  $work.find(AI_STRUCTURAL_STRIP).remove();
  $work.find(CMP_STRIP_SELECTORS).remove();
  const beforeDensity = collapseWs($work.text());
  $work.find(DENSITY_BLOCK_SELECTOR).each((_, el) => {
    const $el = $(el);
    // Only judge LEAF-level blocks (no density-candidate descendant). This is the key that keeps the
    // filter O(n): a deeply-nested chain has ONE leaf, so we never re-walk every ancestor's subtree
    // (the O(depth^2) hang). The `.children()` check is direct-children-only → O(1) per block. It also
    // preserves card grids: the grid container is not a leaf (skipped), and each card is a leaf with too
    // few links to strip.
    if ($el.children(DENSITY_BLOCK_SELECTOR).length > 0) return;
    const total = collapseWs($el.text());
    if (total.length === 0) return;
    if ($el.find('a').length < MIN_MENU_LINKS) return; // prose with 1–2 links is content, never a menu
    const linkText = collapseWs($el.find('a').text());
    if (linkText.length / total.length >= MAX_BLOCK_LINK_DENSITY) $el.remove();
  });
  const afterDensity = collapseWs($work.text());
  // Fallback: if density stripping emptied the main content (an all-links page / a link-only list), keep
  // the pre-density text (structural + CMP boilerplate already removed) so the "What AI Sees" is never blank.
  const text = afterDensity.length > 0 ? afterDensity : beforeDensity;
  return { mainTextChars: text.length, text };
}
