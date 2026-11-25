/**
 * What a check holds so far, read back for the steps that plan from it: its seeds and its batch
 * results (from the evidence bucket, by the paths in `crawl_batches`), and the assembled pages the
 * access sample and the render candidates are planned over.
 */
import { totalmem } from 'node:os';
import { z } from 'zod';
import {
  assemble,
  boundedEdges,
  MAX_CHECK_EDGES,
  noEdgesKept,
  otherEdgesPerPage,
  OwnEdgesOverBound,
  ownEdgeBound,
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
 * The results a crawl batch is planned from (nextCrawlBatch reads pages and discovered URLs only),
 * with every crawl result's edges let go as it is read: a post holds none of the check's edges,
 * however many the check has (QA's gate on #182, F2). Otherwise what loadResults reads.
 */
export async function loadResultsForPlanning(
  deps: StepDeps,
  event: CheckRequested,
): Promise<BatchResult[]> {
  const rows = await deps.store.batches(event.checkId);
  const done = rows.filter((r) => r.status === 'done' && r.result_path !== null);
  const out: BatchResult[] = [];
  for (const r of done) {
    const b = BatchResultSchema.parse(await getJson(deps.evidence, r.result_path!));
    out.push(isCrawl(b) ? { ...b, link_edges: [] } : b);
  }
  return out;
}

/**
 * The memory this process may use, in MiB: the smaller of its container's limit
 * (`process.constrainedMemory`, which answers a huge number where there is none) and the machine's.
 * On a Vercel function this is the function instance's size. Under Fluid compute, invocations that
 * share an instance share its memory, so two builds at once on one instance could hold more than one
 * build was measured at: the bound is per build, not per instance. Not
 * AWS_LAMBDA_FUNCTION_MEMORY_SIZE: the engine's ensureCrawleeMemoryHint writes 3008 there when it is
 * unset (packages/engine/src/crawler.ts).
 */
export function buildMemoryMb(): number {
  const total = totalmem();
  const limit = typeof process.constrainedMemory === 'function' ? process.constrainedMemory() : 0;
  const bytes = limit > 0 ? Math.min(limit, total) : total;
  return Math.floor(bytes / 2 ** 20);
}

/**
 * The build's batch results, with the edges it holds bounded (F-248; engine build/edge-scope.ts). The
 * stored results are read one at a time, in the order loadResults reads them. While the edges read so
 * far are within MAX_CHECK_EDGES, the results are kept: a check within the bound gets what loadResults
 * gives, each result read once. Past it they are let go, and read again one at a time, each crawl
 * result keeping every edge between the crawl's own pages and every generic-anchor edge, and up to
 * `maxOther` of the rest per page (otherEdgesPerPage: fewer on a check of more than 500 pages), with
 * the number left out as `link_edges_dropped`; the results' page rows and other fields are kept whole.
 * When the own-page edges pass `maxOwn` (ownEdgeBound, by the memory the function has: inbox 080) the
 * build is not attempted: the check fails `build_failed`, by name, rather than being graded from part
 * of its graph or killed for memory.
 */
export async function loadResultsForBuild(
  deps: StepDeps,
  event: CheckRequested,
  cap: number = MAX_CHECK_EDGES,
  maxOwn: number = ownEdgeBound(buildMemoryMb()),
  maxOther: number = otherEdgesPerPage(event.pageCap),
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
  // What bounded this build, for the function's logs: the memory it read and the bounds it took.
  console.info(
    JSON.stringify({
      event: 'build.edge_bound',
      check_id: event.checkId,
      edges,
      memory_mb: buildMemoryMb(),
      own_edge_bound: maxOwn,
      other_edges_per_page: maxOther,
    }),
  );
  const kept = noEdgesKept();
  // Source pages whose edges an earlier result carried. The build keeps one edge per (from, to), so
  // a page stored in two results (a retried batch) has its edges once: what a later result leaves
  // out of such a page is not counted again. A page whose links changed between the two counts its
  // new targets short; the structure facts then state fewer links than the uncut build would.
  const sources = new Set<string>();
  const out: BatchResult[] = [];
  for (const r of done) {
    const b = await read(r.result_path!);
    if (!isCrawl(b)) {
      out.push(b);
      continue;
    }
    try {
      const link_edges = boundedEdges(b.link_edges, addresses, kept, maxOwn, maxOther);
      const held = new Set(link_edges);
      const dropped = b.link_edges.filter((e) => !held.has(e) && !sources.has(e.from_url)).length;
      for (const e of b.link_edges) sources.add(e.from_url);
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
