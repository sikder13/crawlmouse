import type * as cheerio from 'cheerio';
import type { PageAiSignals } from '@crawlmouse/types';
import { extractMainContent } from './main-content.js';
import { buildExcerpt } from './excerpt.js';
import { classifyPageClass, detectCsrSignals } from './classify.js';
import { analyzeLegibility, detectFrameworkMarker } from './legibility.js';
import { MIN_MAIN_TEXT_CHARS } from './constants.js';

/**
 * §4 — the per-page AI-legibility signal bundle, computed inside the single existing cheerio parse (the
 * crawler passes `$`; we never re-`load`). Deterministic (R1) and NON-mutating (main-content extraction
 * clones the body — the shared `$` is intact for link/title extraction). CSR signals are computed ONLY
 * when the text is below the readable gate, so a readable SSR page never carries a spurious shell signal.
 */
export function computePageAiSignals($: cheerio.CheerioAPI): PageAiSignals {
  const { mainTextChars, text } = extractMainContent($);
  const excerpt = buildExcerpt(text);
  const csrSignals = mainTextChars >= MIN_MAIN_TEXT_CHARS ? [] : detectCsrSignals($);
  const pageClass = classifyPageClass(mainTextChars, csrSignals);
  const frameworkMarker = detectFrameworkMarker($);
  return {
    pageClass,
    mainTextChars,
    excerpt,
    csrSignals,
    frameworkMarker,
    ...analyzeLegibility($),
  };
}
