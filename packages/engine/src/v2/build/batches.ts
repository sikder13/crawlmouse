/**
 * The check's batch results, parsed and put in one order. A batch CC-20b retried can arrive twice:
 * the same result twice is kept once, two different results for one batch id are refused, and so is a
 * URL crawled in two batches. Batches go in batch-number order whatever order they arrive in, so the
 * output does not depend on arrival.
 */
import {
  BatchResultSchema,
  type AccessBatchResult,
  type BatchResult,
  type CrawlBatchResult,
} from '@crawlmouse/types/v2';
import { canonicalizeUrl } from '../../url-canonical.js';

export interface Batches {
  crawl: CrawlBatchResult[];
  access: AccessBatchResult[];
}

/** The batch number after the check id in `batch_id` (`<check_id>:<n>`, BatchResultSchema). */
const batchNumber = (b: BatchResult): number => Number(b.batch_id.split(':')[1]);

export function readBatches(
  raw: readonly unknown[],
  check: { id: string; site_id: string },
  workerRelease: string,
): Batches {
  const byId = new Map<string, { batch: BatchResult; json: string }>();
  raw.forEach((r, i) => {
    const parsed = BatchResultSchema.safeParse(r);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      throw new Error(
        `buildCheck: batch ${i} is not a batch result: ${issue.path.join('.')}: ${issue.message}`,
      );
    }
    const batch = parsed.data;
    if (batch.check_id !== check.id || batch.site_id !== check.site_id) {
      throw new Error(`buildCheck: batch ${batch.batch_id} belongs to check ${batch.check_id}`);
    }
    if (!batch.batch_id.startsWith(`${check.id}:`)) {
      throw new Error(`buildCheck: batch id ${batch.batch_id} is not of check ${check.id}`);
    }
    const json = JSON.stringify(batch);
    const seen = byId.get(batch.batch_id);
    if (seen && seen.json !== json) {
      throw new Error(`buildCheck: batch ${batch.batch_id} arrived twice with different results`);
    }
    byId.set(batch.batch_id, { batch, json });
  });
  const batches = [...byId.values()]
    .map((b) => b.batch)
    .sort((a, b) => batchNumber(a) - batchNumber(b));

  const crawled = new Set<string>();
  for (const b of batches) {
    const releases =
      b.kind === 'crawl'
        ? b.pages.map((p) => p.worker_release)
        : b.access_tests.map((t) => t.worker_release);
    const other = releases.find((r) => r !== null && r !== workerRelease);
    if (other !== undefined) {
      throw new Error(
        `buildCheck: batch ${b.batch_id} came from worker ${other}, not ${workerRelease}; the fetching lineage names one release`,
      );
    }
    if (b.kind !== 'crawl') continue;
    for (const p of b.pages) {
      if (p.url !== canonicalizeUrl(p.url)) {
        throw new Error(
          `buildCheck: ${p.url} is not in the canonical spelling the crawl keys pages on`,
        );
      }
      if (crawled.has(p.url)) throw new Error(`buildCheck: ${p.url} was crawled in two batches`);
      crawled.add(p.url);
    }
  }
  return {
    crawl: batches.filter((b): b is CrawlBatchResult => b.kind === 'crawl'),
    access: batches.filter((b): b is AccessBatchResult => b.kind === 'access'),
  };
}
