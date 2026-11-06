/**
 * What produced a built check, and what delivering it cost: one MeasurementLineage and, for a site an
 * account keeps, one UsageEvent (docs/specs/v2/06b-data-foundations.md §1 and the usage section).
 */
import { createHash } from 'node:crypto';
import {
  serialiseRegistry,
  type Check,
  type CrawlerRegistryEntry,
  type MeasurementLineage,
  type UsageEvent,
} from '@crawlmouse/types/v2';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import { stableId } from '../diff/ids.js';
import { GRADE_VERSION } from '../grade/weights.js';
import type { BatchResult } from '@crawlmouse/types/v2';
import type { RenderOutcome } from '../render/run.js';
import type { BuildInput } from './types.js';

/**
 * crawlerRegistryVersion (packages/types/src/v2/crawler-registry.ts), synchronously: sha256 hex of
 * serialiseRegistry(entries), the same bytes Web Crypto digests there. lineage.test.ts holds the two
 * equal on CRAWLER_REGISTRY_V2.
 */
export function registryVersion(entries: readonly CrawlerRegistryEntry[]): string {
  return createHash('sha256').update(serialiseRegistry(entries), 'utf8').digest('hex');
}

/**
 * The lineage of a built check. The detector rules are CC-17's GRADE_VERSION; the registry is the one
 * the access detectors read, CRAWLER_REGISTRY_V2; the graded-population definition (SPEC 5.1a) is not
 * versioned yet, so `population_version` is null (06b §1). The id is derived from the five values the
 * table keeps unique, so the same builds always name the same id.
 */
export function lineageOf(input: Pick<BuildInput, 'lineage' | 'now'>): MeasurementLineage {
  const values = {
    engine_sha: input.lineage.engine_sha,
    detector_ruleset_version: GRADE_VERSION,
    crawler_registry_version: registryVersion(CRAWLER_REGISTRY_V2),
    worker_release: input.lineage.worker_release,
    population_version: null,
  };
  return {
    id: stableId(
      'measurement_lineage',
      values.engine_sha,
      values.detector_ruleset_version,
      values.crawler_registry_version,
      values.worker_release,
      '',
    ),
    ...values,
    created_at: input.now,
  };
}

/**
 * The usage event of a delivered check: `delivered` when either grade was given, `withheld` when both
 * were withheld; every delivered result is billable (owner ruling, CC-20a). Null for a site no account
 * keeps, which is not metered (UsageEventSchema needs an account; its volume is counted in PostHog).
 */
export function usageOf(
  accountId: string | null,
  check: Check,
  batches: readonly Pick<BatchResult, 'requests' | 'started_at' | 'finished_at'>[],
  render: Pick<RenderOutcome, 'browser_ms'> | null,
): UsageEvent | null {
  if (accountId === null) return null;
  const given =
    (check.technical_seo !== null && check.technical_seo.score !== null) ||
    (check.ai_readability !== null && !check.ai_readability.withheld);
  const result = given ? 'delivered' : 'withheld';
  const workerMs = batches.reduce(
    (n, b) => n + (Date.parse(b.finished_at) - Date.parse(b.started_at)),
    0,
  );
  return {
    id: stableId('usage_event', 'check_finished', check.id),
    account_id: accountId,
    kind: 'check_finished',
    check_id: check.id,
    report_id: null,
    result,
    billable: result === 'delivered',
    compute_seconds: (workerMs + (render?.browser_ms ?? 0)) / 1000,
    request_count: batches.reduce((n, b) => n + b.requests, 0),
    occurred_at: check.finished_at!,
  };
}
