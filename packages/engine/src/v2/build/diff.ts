/**
 * The diff of a built check against the site's last graded one: CC-19's diffCheck, given this check's
 * side and the outcomes CC-17 drew from the detectors. Its rows are returned as diffCheck gives them.
 */
import type { FixType } from '@crawlmouse/types/v2';
import { CONTENT_CHECKS } from '../content/checks.js';
import { DETECTORS } from '../detectors/index.js';
import { diffCheck } from '../diff/diff.js';
import type { CheckSide, DetectorOutcome, DiffResult } from '../diff/types.js';
import type { BuildInput, DiffInputs } from './types.js';

/**
 * The fix types whose detectors run on every built check: the structure detectors, the two access
 * detectors, and the content checks that carry a fix type. Fixed by the code, not read from what a
 * check happened to find, so a fix whose detector ran and found nothing can close.
 */
export const DETECTORS_RUN: readonly FixType[] = [
  ...DETECTORS.map((d) => d.type),
  'robots_txt_blocks_crawler',
  'edge_rule_blocks_crawler',
  'client_rendered_template',
  'js_only_navigation',
  ...Object.values(CONTENT_CHECKS).flatMap((c) => (c.fix ? [c.fix] : [])),
];

export function diffInputsOf(
  pageCap: number,
  robotsTxt: string | null,
  outcomes: readonly DetectorOutcome[],
): DiffInputs {
  return {
    page_cap: pageCap,
    robots_txt: robotsTxt,
    detectors: DETECTORS_RUN,
    indeterminate: outcomes
      .filter((o) => o.state === 'indeterminate')
      .map((o) => o.fingerprint)
      .sort(),
  };
}

export function diffBuilt(
  input: Pick<BuildInput, 'previous' | 'fixes' | 'events'>,
  current: CheckSide,
  outcomes: readonly DetectorOutcome[],
): DiffResult {
  return diffCheck({
    previous: input.previous,
    current,
    fixes: input.fixes,
    events: input.events,
    outcomes,
  });
}
