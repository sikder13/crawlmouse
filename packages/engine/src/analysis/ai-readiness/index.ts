/**
 * SPEC 05 — AI / Agent-Readiness analysis module. Stage 2: per-page extraction + classifier + excerpt.
 * Stage 3: score assembly (access matrix / WAF disclosure / llms.txt / legibility / retrieval path).
 */
export * from './constants.js';
export { extractMainContent } from './main-content.js';
export { buildExcerpt } from './excerpt.js';
export { classifyPageClass, detectCsrSignals } from './classify.js';
export { analyzeLegibility, detectFrameworkMarker } from './legibility.js';
export { computePageAiSignals } from './page-signals.js';
export { detectWaf } from './waf.js';
export { parseLlmsTxt, LLMS_TXT_NOTE, LLMS_TXT_MAX_BYTES, LLMS_TXT_SCAN_CAP, LLMS_TXT_FETCH_TIMEOUT_MS } from './llms-txt.js';
export { buildAccessMatrix } from './access-matrix.js';
export { stableFindingId } from './finding-id.js';
export { assembleAiReadiness, type AiReadinessInput, type AiReadinessPage } from './assemble.js';
