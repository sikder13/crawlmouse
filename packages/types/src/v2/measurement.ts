/**
 * Data foundations (CC-06b): what produced a measurement, and what a measurement asserts.
 *
 * MeasurementLineage names the builds and versions behind a row, so a time series can be split
 * wherever one of them changed. The status functions map the contract's existing states onto
 * MeasurementStatus. The database computes the same values in generated columns
 * (checks.technical_seo_status, checks.ai_readability_status, access_tests.measurement_status,
 * research.crawler_observations.measurement_status), and v2-006b-data-foundations.test.ts compares the
 * two over every input that decides them.
 */
import { z } from 'zod';
import { IdSchema, TimestampSchema } from './common.js';
import type { CheckStatus, DetectionState, MeasurementStatus, Verdict } from './enums.js';

const SEMVER = /^\d+\.\d+\.\d+$/;

export const MeasurementLineageSchema = z.strictObject({
  id: IdSchema,
  /** The git commit the engine was built from. */
  engine_sha: z.string().regex(/^[0-9a-f]{40}$/),
  /** The version of the detector rules (verdict table, thresholds, signatures). */
  detector_ruleset_version: z.string().regex(SEMVER),
  /** sha256 of the crawler registry's serialised entries: crawlerRegistryVersion(). */
  crawler_registry_version: z.string().regex(/^[0-9a-f]{64}$/),
  /** The worker build that fetched; null for a lineage no worker took part in. */
  worker_release: z
    .string()
    .regex(/^[!-~]{1,200}$/)
    .nullable(),
  /** The version of the graded-population definition (SPEC 5.1a); null where none applies. */
  population_version: z.string().regex(SEMVER).nullable(),
  created_at: TimestampSchema,
});

export type MeasurementLineage = z.infer<typeof MeasurementLineageSchema>;

/**
 * A crawler verdict's status. `edge_blocks_automation`: the site's edge refused our requests whoever
 * we said we were. `not_measured`: no usable response to decide from. Every other verdict is measured,
 * as UNMEASURED_VERDICTS in check.ts has it.
 */
export function verdictStatus(verdict: Verdict): MeasurementStatus {
  if (verdict === 'edge_blocks_automation') return 'not_measurable';
  if (verdict === 'not_measured') return 'unevaluable';
  return 'measured';
}

/** A detector's status (a signal's `state`, a fix's `last_state`). */
export function detectionStatus(state: DetectionState): MeasurementStatus {
  return state === 'indeterminate' ? 'unevaluable' : 'measured';
}

const ENDED: readonly CheckStatus[] = ['finished', 'partial', 'failed'];

/**
 * The status of a check's Technical SEO grade: null until the check has ended; `not_measurable` when
 * the check ended with no grade; `withheld` when SPEC 5.1a refused it; otherwise `measured`.
 *
 * `measured` is not "fully measured": a graded check whose `refusal.unevaluable` lists triggers could
 * not evaluate those refusal conditions, and the triggers stay on the grade's `refusal`.
 */
export function technicalSeoStatus(check: {
  status: CheckStatus;
  technical_seo: { refusal: { refused: boolean } } | null;
}): MeasurementStatus | null {
  if (!ENDED.includes(check.status)) return null;
  if (check.technical_seo === null) return 'not_measurable';
  return check.technical_seo.refusal.refused ? 'withheld' : 'measured';
}

/**
 * The status of a check's AI readability grade: null until the check has ended; `not_measurable` when
 * the check ended with no grade; `withheld` when fewer than two scored crawlers were measured (FACTS
 * I4); otherwise `measured`.
 */
export function aiReadabilityStatus(check: {
  status: CheckStatus;
  ai_readability: { withheld: boolean } | null;
}): MeasurementStatus | null {
  if (!ENDED.includes(check.status)) return null;
  if (check.ai_readability === null) return 'not_measurable';
  return check.ai_readability.withheld ? 'withheld' : 'measured';
}
