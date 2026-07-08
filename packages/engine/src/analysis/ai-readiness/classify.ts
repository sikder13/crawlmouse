import type * as cheerio from 'cheerio';
import type { AiPageClass } from '@crawlmouse/types';
import { AI_CSR_MOUNT_SELECTORS, NOSCRIPT_JS_NOTICE, MIN_MAIN_TEXT_CHARS, PARTIAL_FLOOR } from './constants.js';

/**
 * §4.2 — the dual gate. The EXTRACTED main-content text is the verdict; CSR signals only distinguish a
 * blind shell from a genuinely thin page. Order matters:
 *   1. `mainTextChars >= MIN` → `readable` (the text gate wins — a server-rendered page IS readable even
 *      with a framework marker; that marker is only an annotation).
 *   2. else, with affirmative CSR evidence → `js_blind` when below PARTIAL_FLOOR, else `partial` (this is
 *      where the "__NEXT_DATA__ present but body fetched in useEffect" loophole lands — the text gate
 *      catches it regardless of the marker).
 *   3. else → `thin` — low text with NO CSR evidence is a thin page, never a blind one (a contact page
 *      must never be called JS-blind). Conservative bias preserved.
 */
export function classifyPageClass(mainTextChars: number, csrSignals: string[]): AiPageClass {
  if (mainTextChars >= MIN_MAIN_TEXT_CHARS) return 'readable';
  if (csrSignals.length > 0) return mainTextChars < PARTIAL_FLOOR ? 'js_blind' : 'partial';
  return 'thin';
}

/**
 * §4.2 — affirmative per-page CSR evidence (a per-page adaptation of the site-level detector's branches).
 * ONLY meaningful when the text is already below the readable gate (the caller gates on that), so a
 * readable SSR page never carries a spurious shell signal. Signals:
 *   - `empty_mount:<sel>` — a known SPA mount node exists with no element children AND no text (branch a);
 *   - `shell_mount:<sel>` — a known mount node exists (with a hydration shell) AND the page ships a JS
 *     bundle (branch c). A bundle is REQUIRED here so a mount-less thin static page can never trip it;
 *   - `noscript_js_notice` — the page itself declares it needs JavaScript (branch b).
 * A thin static page with no known mount id and no bundle yields NO signals → it stays `thin`.
 */
export function detectCsrSignals($: cheerio.CheerioAPI): string[] {
  const signals: string[] = [];
  const hasBundle = $('script[src]').length > 0;
  for (const sel of AI_CSR_MOUNT_SELECTORS) {
    const node = $(sel).first();
    if (node.length === 0) continue;
    const empty = node.children().length === 0 && node.text().trim() === '';
    if (empty) signals.push(`empty_mount:${sel}`);
    else if (hasBundle) signals.push(`shell_mount:${sel}`);
  }
  let notice = false;
  $('noscript').each((_, el) => {
    if (NOSCRIPT_JS_NOTICE.test($(el).text())) notice = true;
  });
  if (notice) signals.push('noscript_js_notice');
  return signals;
}
