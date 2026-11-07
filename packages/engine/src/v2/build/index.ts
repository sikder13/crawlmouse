/**
 * The check builder (CC-20a): what CC-20b calls. `buildCheck` turns a check's batches into its rows;
 * `readBatches` + `assemble` give the planners what the check holds so far.
 */
export { assemble, SAMPLE_MAX_PAGES, type Assembled } from './assemble.js';
export { readBatches, type Batches } from './batches.js';
export { buildCheck, serialiseBuilt } from './build.js';
export { DETECTORS_RUN } from './diff.js';
export {
  nextCrawlBatch,
  renderCandidates,
  sample,
  type RenderPlan,
  type Sample,
  type SampledPage,
} from './plan.js';
export { PARTIAL_RULE } from './status.js';
export { SUMMARY_BYTES } from './summaries.js';
export type { BuildInput, BuiltCheck, DiffInputs, PhaseSummary, Seed } from './types.js';
