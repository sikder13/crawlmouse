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
export function extractMainContent($: cheerio.CheerioAPI): { mainTextChars: number; text: string } {
  // `cheerio.load` always wraps content in <html><head><body>, so `$('body')` is the content root.
  // Clone it (never $.root(), which would drag <head>/<title> into the text) so the shared `$` is intact.
  const $work = $('body').clone();
  $work.find(AI_STRUCTURAL_STRIP).remove();
  $work.find(CMP_STRIP_SELECTORS).remove();
  $work.find('ul, ol, div, section, form').each((_, el) => {
    const $el = $(el);
    const total = collapseWs($el.text());
    if (total.length === 0) return;
    if ($el.find('a').length < MIN_MENU_LINKS) return; // prose with 1–2 links is content, never a menu
    const linkText = collapseWs($el.find('a').text());
    if (linkText.length / total.length >= MAX_BLOCK_LINK_DENSITY) $el.remove();
  });
  const text = collapseWs($work.text());
  return { mainTextChars: text.length, text };
}
