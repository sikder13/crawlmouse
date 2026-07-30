import type * as cheerio from 'cheerio';
import type { PageAiSignals } from '@crawlmouse/types';
import { extractMainContent } from './main-content.js';
import { buildExcerpt } from './excerpt.js';
import { classifyPageClass, detectCsrSignals } from './classify.js';
import { analyzeLegibility, detectFrameworkMarker } from './legibility.js';
import { AI_TITLE_MAX_BYTES, MIN_MAIN_TEXT_CHARS } from './constants.js';
import { toPersistableText } from '../../text-safety.js';

/**
 * §4 — the per-page AI-legibility signal bundle, computed inside the single existing cheerio parse (the
 * crawler passes `$`; we never re-`load`). Deterministic (R1) and NON-mutating (main-content extraction
 * never mutates or clones — the shared `$` is intact for link/title extraction). CSR signals are computed ONLY
 * when the text is below the readable gate, so a readable SSR page never carries a spurious shell signal.
 */
export function computePageAiSignals($: cheerio.CheerioAPI): PageAiSignals {
  const { mainTextChars, text } = extractMainContent($);
  const excerpt = buildExcerpt(text);
  const csrSignals = mainTextChars >= MIN_MAIN_TEXT_CHARS ? [] : detectCsrSignals($);
  const pageClass = classifyPageClass(mainTextChars, csrSignals);
  const frameworkMarker = detectFrameworkMarker($);
  // The AI feature's OWN bounded copy of the title. It deliberately does not reuse `pages.title`:
  // that is raw crawled text on the GRADE path (isGenericAnchor / anchor diversity) and capping it
  // would be a §5 non-regression change (FU-6). Bounding here means every downstream AI surface —
  // the simulator, the packets, the findings — inherits a bounded title and needs no cap of its own.
  const rawTitle = $('title').first().text().trim();
  const title = rawTitle ? toPersistableText(rawTitle, AI_TITLE_MAX_BYTES) : null;
  return {
    pageClass,
    mainTextChars,
    title,
    excerpt,
    csrSignals,
    frameworkMarker,
    ...analyzeLegibility($),
  };
}
