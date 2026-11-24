/**
 * What a check holds so far, read back for the steps that plan from it: its seeds and its batch
 * results (from the evidence bucket, by the paths in `crawl_batches`), and the assembled pages the
 * access sample and the render candidates are planned over.
 */
import { z } from 'zod';
import {
  assemble,
  boundedEdges,
  MAX_CHECK_EDGES,
  MAX_OWN_EDGES,
  noEdgesKept,
  OwnEdgesOverBound,
  readBatches,
  rowAddresses,
  type Assembled,
  type Seed,
} from '@crawlmouse/engine/v2/pipeline';
import {
  BatchResultSchema,
  type BatchResult,
  type Check,
  type CrawlBatchResult,
} from '@crawlmouse/types/v2';
import { CheckFailure, type CheckRequested } from '../../../../../../inngest/check-events';
import { getJson } from '../evidence';
import { evidencePath, type EvidenceName, type EvidenceOwner } from '../types';
import type { StepDeps } from './deps';

export const ownerOf = (e: CheckRequested): EvidenceOwner => ({
  accountId: e.accountId,
  siteId: e.siteId,
  checkId: e.checkId,
});

export const pathOf = (e: CheckRequested, name: EvidenceName): string =>
  evidencePath(ownerOf(e), name);

export const iso = (ms: number): string => new Date(ms).toISOString();

const SeedsSchema = z.array(
  z.strictObject({
    url: z.string(),
    source: z.enum(['homepage', 'sitemap']),
    lastmod: z.string().nullable(),
  }),
);

export async function loadSeeds(deps: StepDeps, event: CheckRequested): Promise<Seed[]> {
  return SeedsSchema.parse(await getJson(deps.evidence, pathOf(event, 'seeds')));
}

/** The results of the check's batches read so far, in batch order. */
export async function loadResults(deps: StepDeps, event: CheckRequested): Promise<BatchResult[]> {
  const rows = await deps.store.batches(event.checkId);
  const done = rows.filter((r) => r.status === 'done' && r.result_path !== null);
  return Promise.all(
    done.map(async (r) => BatchResultSchema.parse(await getJson(deps.evidence, r.result_path!))),
  );
}

export const isCrawl = (b: BatchResult): b is CrawlBatchResult => b.kind === 'crawl';

/**
 * The build's batch results, with the edges it holds bounded (F-248; engine build/edge-scope.ts). The
 * stored results are read one at a time, in the order loadResults reads them. While the edges read so
 * far are within MAX_CHECK_EDGES, the results are kept: a check within the bound gets what loadResults
 * gives, each result read once. Past it they are let go, and read again one at a time, each crawl
 * result keeping every edge between the crawl's own pages and every generic-anchor edge, and up to
 * MAX_OTHER_EDGES_PER_PAGE of the rest per page, with the number left out as `link_edges_dropped`;
 * the results' page rows and other fields are kept whole. When the own-page edges pass
 * MAX_OWN_EDGES the build is not attempted: the check fails `build_failed`, by name, rather than being
 * graded from part of its graph or killed for memory.
 */
export async function loadResultsForBuild(
  deps: StepDeps,
  event: CheckRequested,
  cap: number = MAX_CHECK_EDGES,
  maxOwn: number = MAX_OWN_EDGES,
): Promise<BatchResult[]> {
  const rows = await deps.store.batches(event.checkId);
  const done = rows.filter((r) => r.status === 'done' && r.result_path !== null);
  const read = async (path: string) => BatchResultSchema.parse(await getJson(deps.evidence, path));
  const addresses = new Set<string>();
  let edges = 0;
  let held: BatchResult[] | null = [];
  for (const r of done) {
    const b = await read(r.result_path!);
    if (isCrawl(b)) {
      for (const a of rowAddresses(b.pages)) addresses.add(a);
      edges += b.link_edges.length;
    }
    held = held !== null && edges <= cap ? [...held, b] : null;
  }
  if (held !== null) return held;
  const kept = noEdgesKept();
  const out: BatchResult[] = [];
  for (const r of done) {
    const b = await read(r.result_path!);
    if (!isCrawl(b)) {
      out.push(b);
      continue;
    }
    try {
      const link_edges = boundedEdges(b.link_edges, addresses, kept, maxOwn);
      const dropped = b.link_edges.length - link_edges.length;
      out.push({ ...b, link_edges, ...(dropped > 0 && { link_edges_dropped: dropped }) });
    } catch (e) {
      if (e instanceof OwnEdgesOverBound) throw new CheckFailure('build_failed', { cause: e });
      throw e;
    }
  }
  return out;
}

/** The worker release a batch's rows name: the first that names one; null when none does. */
export function releaseOf(b: BatchResult): string | null {
  const releases =
    b.kind === 'crawl'
      ? b.pages.map((p) => p.worker_release)
      : b.access_tests.map((t) => t.worker_release);
  return releases.find((r) => r !== null) ?? null;
}

/** The release of the check's first batch that names one (the orchestration refuses any other). */
export const releaseOfAll = (results: readonly BatchResult[]): string | null =>
  results.map(releaseOf).find((r) => r !== null) ?? null;

/** The pages the check holds so far, as the builder assembles them, and the check row. */
export async function assembledSoFar(
  deps: StepDeps,
  event: CheckRequested,
  seeds: readonly Seed[],
  results: readonly BatchResult[],
): Promise<{ check: Check; assembled: Assembled }> {
  const check = await deps.store.check(event.checkId);
  const now = iso(deps.now());
  const batches = readBatches(
    results,
    { id: event.checkId, site_id: event.siteId },
    // When no row names a release, readBatches compares none, so the value is not read.
    releaseOfAll(results) ?? 'unreleased',
  );
  const assembled = assemble(
    {
      check: {
        id: check.id,
        site_id: check.site_id,
        previous_check_id: check.previous_check_id,
        trigger: check.trigger,
        queued_at: check.queued_at,
        started_at: check.started_at ?? now,
        // The check has not finished; assemble reads its id and page cap, and this is the instant
        // the plan is made.
        finished_at: now,
        expires_at: check.expires_at,
        page_cap: event.pageCap,
        grade_version: check.grade_version,
      },
      homepage_url: event.homepageUrl,
      seeds,
      render: null,
    },
    batches,
  );
  return { check, assembled };
}
