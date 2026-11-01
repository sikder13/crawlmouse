/** CC-19: change detection and the fix lifecycle. CC-20's pipeline calls `diffCheck`. */
export { diffCheck } from './diff.js';
export type { CheckSide, DetectorOutcome, DiffInput, DiffResult, FixDraft } from './types.js';
export { LIFECYCLE, statusOf, type Action, type Outcome, type Prior } from './lifecycle.js';
export { COVERAGE_DEPENDENCE, FIX_SECTION, FIX_SUBJECT } from './subjects.js';
export { MIN_GRADE_SCORE_DELTA } from './changes.js';
export {
  BAD_AI_READABILITY_POINTS,
  BAD_TECHNICAL_SEO_POINTS,
  severityOf,
  type Severity,
} from './severity.js';
