/**
 * The part of the engine the check pipeline (CC-20b, apps/web/lib/v2/pipeline) uses, published as
 * `@crawlmouse/engine/v2/pipeline`. Like `./worker`, it loads no module that imports crawlee: the
 * package root re-exports the v1 crawler, which does.
 */
export {
  assemble,
  buildCheck,
  DETECTORS_RUN,
  nextCrawlBatch,
  readBatches,
  renderCandidates,
  sample,
  serialiseBuilt,
  SUMMARY_BYTES,
} from './build/index.js';
export type {
  Assembled,
  BuildInput,
  BuiltCheck,
  DiffInputs,
  PhaseSummary,
  Sample,
  SampledPage,
  Seed,
} from './build/index.js';
export type { CheckSide } from './diff/types.js';
export { GRADE_VERSION } from './grade/weights.js';
export { renderCheck, inFlightFromEnv } from './render/run.js';
export type { RenderOutcome } from './render/run.js';
export { clientFromEnv } from './render/client.js';
export { capsFromEnv } from './render/budget.js';
export type { DailyBudget } from './render/budget.js';
export type { JsTextState } from './render/state.js';
export { checkMap } from './layout/check-map.js';
export type { MapDrawing } from './layout/check-map.js';
export { safeFetch } from '../safe-fetch.js';
export { discoverSitemaps, parseSitemapUrls } from '../sitemap.js';
export { canonicalizeUrl } from '../url-canonical.js';
export { templateKeyFor } from '../analysis/template-key.js';
