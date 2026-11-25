/**
 * The part of the engine the check pipeline (CC-20b, apps/web/lib/v2/pipeline) uses, published as
 * `@crawlmouse/engine/v2/pipeline`. Like `./worker`, it loads no module that imports crawlee: the
 * package root re-exports the v1 crawler, which does.
 */
export {
  assemble,
  buildCheck,
  DETECTORS_RUN,
  answeredAt,
  askedAs,
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
export { nothingReadReason } from './build/nothing-read.js';
export {
  boundedEdges,
  MAX_CHECK_EDGES,
  MAX_OTHER_EDGES_PER_PAGE,
  MAX_OWN_EDGES,
  noEdgesKept,
  OwnEdgesOverBound,
  rowAddresses,
  type EdgesKept,
} from './build/edge-scope.js';
export type { CheckSide } from './diff/types.js';
export { stableId } from './diff/ids.js';
export { GRADE_VERSION } from './grade/weights.js';
export { renderCheck, inFlightFromEnv } from './render/run.js';
export type { RenderOutcome } from './render/run.js';
export { clientFromEnv, REQUEST_TIMEOUT_MS } from './render/client.js';
export { capsFromEnv } from './render/budget.js';
export type { DailyBudget } from './render/budget.js';
export type { JsTextState } from './render/state.js';
export { checkMap } from './layout/check-map.js';
export type { MapDrawing } from './layout/check-map.js';
export { safeFetch } from '../safe-fetch.js';
export {
  discoverSitemaps,
  parseSitemapEntries,
  parseSitemapUrls,
  type RobotsStatus,
} from '../sitemap.js';
export { canonicalizeUrl } from '../url-canonical.js';
export { templateKeyFor } from '../analysis/template-key.js';
// The fix page reads these two (apps/web/lib/v2/view): why a fix type has no packet, and which
// framework a check's stack puts first.
export { PACKETS } from './packets/registry.js';
export { frameworkOf } from './packets/stack.js';
// The research ledger's writer (apps/web/lib/v2/ledger) reads these: robots.txt as the build read it
// and each crawler's group in it, the without-JS state, and the registry's robots tokens.
export { robotsText } from './build/record.js';
export { parseRobotsTxt } from '../robots.js';
export type { ParsedRobots, RobotsRules } from '../robots.js';
export { jsTextState } from './render/state.js';
export { CRAWLER_REGISTRY_V2 } from './crawler-registry.js';
