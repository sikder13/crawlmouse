/**
 * SPEC 05 — AI / Agent-Readiness analysis module (Stage 2: per-page extraction + classifier + excerpt).
 * Score assembly (access matrix / legibility / retrieval path / llms.txt) lands in Stage 3.
 */
export * from './constants.js';
export { extractMainContent } from './main-content.js';
export { buildExcerpt } from './excerpt.js';
export { classifyPageClass, detectCsrSignals } from './classify.js';
export { analyzeLegibility, detectFrameworkMarker } from './legibility.js';
export { computePageAiSignals } from './page-signals.js';
