import { BatchResultSchema, type BatchResult, type LinkEdge } from '@crawlmouse/types/v2';
import { totalmem } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  assemble,
  readBatches,
  renderCandidates,
  sample,
  LARGE_CHECK_OTHER_EDGES_PER_PAGE,
  MAX_OTHER_EDGES_PER_PAGE,
  ownEdgeBound as ownEdgeBoundFor,
} from '@crawlmouse/engine/v2/pipeline';
import {
  readRecorded,
  recordedInput,
} from '../../../../../../packages/engine/fixtures/v2/build/recorded';
import { putJson } from '../evidence';
import { memoryEvidenceStore } from '../test-support/memory-evidence';
import { batchSteps } from './batches';
import type { StepDeps } from './deps';
import { finishSteps } from './finish';
import {
  buildMemoryMb,
  isCrawl,
  loadResults,
  loadResultsForBuild,
  loadResultsForPlanning,
  pathOf,
} from './stored';

/** The build step's loader (F-248): unchanged within the bound, bounded and streamed over it. */
const EVENT = { checkId: 'c0000000-0000-4000-8000-000000000001' } as never;

async function setup(extraPerPage: number, storedTwice = false) {
  const read = (readRecorded('batches') as unknown[]).map((r) => {
    const b = BatchResultSchema.parse(r);
    if (!isCrawl(b)) return b;
    const extra: LinkEdge[] = b.pages
      .filter((p) => p.outcome === 'fetched')
      .flatMap((p) =>
        Array.from({ length: extraPerPage }, (_, i) => ({
          check_id: b.check_id,
          from_url: p.url,
          to_url: `${new URL(p.url).origin}/never-crawled/${p.url.length}-${i}`,
          // Every fifth is generic anchor text, which the bound keeps wherever it points.
          anchor_text: i % 5 === 0 ? 'click here' : 'Article',
          is_generic_anchor: i % 5 === 0,
          js_only: false,
        })),
      );
    return { ...b, link_edges: [...b.link_edges, ...extra] };
  });
  // A retried batch: the first crawl result stored a second time, at the end.
  const results = storedTwice ? [...read, read.find(isCrawl)!] : read;
  const evidence = memoryEvidenceStore();
  const rows = results.map((_, i) => ({ status: 'done', result_path: `e/batch-${i + 1}.json.gz` }));
  for (const [i, r] of results.entries()) await putJson(evidence, rows[i]!.result_path, r);
  let reads = 0;
  const counted = { ...evidence, get: (p: string) => (reads++, evidence.get(p)) };
  const deps = { store: { batches: async () => rows }, evidence: counted } as unknown as StepDeps;
  const edges = (bs: readonly BatchResult[]) =>
    bs.filter(isCrawl).reduce((n, b) => n + b.link_edges.length, 0);
  return { deps, results, edges, reads: () => reads };
}

/** The recorded batches with 120,000 generic-anchor edges added: between the 2 GB and 4 GB bounds. */
async function between() {
  const read = (readRecorded('batches') as unknown[]).map((r) => BatchResultSchema.parse(r));
  const pages = read.filter(isCrawl).flatMap((b) => b.pages.filter((p) => p.outcome === 'fetched'));
  const each = Math.ceil(120_000 / pages.length);
  const crawl = read.find(isCrawl)!;
  const generic: LinkEdge[] = pages.flatMap((p) =>
    Array.from({ length: each }, (_, i) => ({
      check_id: crawl.check_id,
      from_url: p.url,
      to_url: `${new URL(p.url).origin}/never-crawled/g-${p.url.length}-${i}`,
      anchor_text: 'click here',
      is_generic_anchor: true,
      js_only: false,
    })),
  );
  const results = read.map((b) =>
    b === crawl ? { ...crawl, link_edges: [...crawl.link_edges, ...generic] } : b,
  );
  const evidence = memoryEvidenceStore();
  const rows = results.map((_, i) => ({ status: 'done', result_path: `e/batch-${i + 1}.json.gz` }));
  for (const [i, r] of results.entries()) await putJson(evidence, rows[i]!.result_path, r);
  const deps = { store: { batches: async () => rows }, evidence } as unknown as StepDeps;
  return { deps, evidence, rows };
}

/** Runs `fn` with the process reading `mb` MiB as its container's memory. */
async function atMemory(mb: number, fn: () => Promise<unknown>) {
  const limit = vi.spyOn(process, 'constrainedMemory').mockReturnValue(mb * 2 ** 20);
  try {
    await fn();
  } finally {
    limit.mockRestore();
  }
}

describe('loadResultsForBuild (F-248)', () => {
  it('within the bound, answers what loadResults does, reading each result once', async () => {
    const s = await setup(5);
    const total = s.edges(s.results);
    const bounded = await loadResultsForBuild(s.deps, EVENT, total);
    expect(s.reads()).toBe(s.results.length);
    expect(bounded).toEqual(await loadResults(s.deps, EVENT));
  });

  it('over the bound, keeps every own-page and generic-anchor edge and the share of the rest, records what it left out, and reads each result twice', async () => {
    const s = await setup(40);
    const total = s.edges(s.results);
    const bounded = await loadResultsForBuild(s.deps, EVENT, Math.floor(total / 4));
    expect(s.reads()).toBe(2 * s.results.length);
    const whole = (e: LinkEdge) => !e.to_url.includes('/never-crawled/') || e.is_generic_anchor;
    const kept = (bs: readonly BatchResult[]) =>
      bs.filter(isCrawl).flatMap((b) => b.link_edges.filter(whole));
    const full = await loadResults(s.deps, EVENT);
    expect(kept(bounded)).toEqual(kept(full));
    expect(
      kept(full).some((e) => e.is_generic_anchor && e.to_url.includes('/never-crawled/')),
    ).toBe(true);
    const elsewhere = new Map<string, number>();
    for (const e of bounded.filter(isCrawl).flatMap((b) => b.link_edges))
      if (!whole(e)) elsewhere.set(e.from_url, (elsewhere.get(e.from_url) ?? 0) + 1);
    expect(new Set(elsewhere.values())).toEqual(new Set([MAX_OTHER_EDGES_PER_PAGE]));
    // Each result records how many edges it left out, so the count of links stays true.
    const fullCrawls = full.filter(isCrawl);
    for (const [i, b] of bounded.filter(isCrawl).entries()) {
      const cut = fullCrawls[i]!.link_edges.length - b.link_edges.length;
      expect(cut).toBeGreaterThan(0);
      expect(b.link_edges_dropped).toBe(cut);
    }
    // Only edges are cut: the pages, the access tests and every other field are the results' own.
    const strip = (bs: readonly BatchResult[]) =>
      // toEqual reads an undefined field as absent, so the count of edges left out drops out here.
      bs.map((b) => (isCrawl(b) ? { ...b, link_edges: [], link_edges_dropped: undefined } : b));
    expect(strip(bounded)).toEqual(strip(full));
  });

  it('counts an edge left out once when a page is stored in two results (review of 93a7d3f5)', async () => {
    const s = await setup(40, true);
    const bounded = await loadResultsForBuild(s.deps, EVENT, Math.floor(s.edges(s.results) / 4));
    const full = await loadResults(s.deps, EVENT);
    const distinct = (bs: readonly BatchResult[]) =>
      new Set(
        bs.filter(isCrawl).flatMap((b) => b.link_edges.map((e) => `${e.from_url} ${e.to_url}`)),
      ).size;
    const dropped = bounded.filter(isCrawl).reduce((n, b) => n + (b.link_edges_dropped ?? 0), 0);
    expect(dropped).toBeGreaterThan(0);
    // What the build counts as links (one per from and to, plus what was left out) is the uncut count.
    expect(distinct(bounded) + dropped).toBe(distinct(full));
  });

  it('keeps fewer edges elsewhere a page on a check of more than 500 pages (inbox 079)', async () => {
    const s = await setup(40);
    const large = { checkId: 'c0000000-0000-4000-8000-000000000001', pageCap: 2000 } as never;
    const bounded = await loadResultsForBuild(s.deps, large, Math.floor(s.edges(s.results) / 4));
    const whole = (e: LinkEdge) => !e.to_url.includes('/never-crawled/') || e.is_generic_anchor;
    const elsewhere = new Map<string, number>();
    for (const e of bounded.filter(isCrawl).flatMap((b) => b.link_edges))
      if (!whole(e)) elsewhere.set(e.from_url, (elsewhere.get(e.from_url) ?? 0) + 1);
    expect(new Set(elsewhere.values())).toEqual(new Set([LARGE_CHECK_OTHER_EDGES_PER_PAGE]));
  });

  it('holds the bound the function’s memory allows: 100,000 own-page edges at 2 GB, 250,000 at 4 GB', () => {
    expect(ownEdgeBoundFor(2048)).toBe(100_000);
    expect(ownEdgeBoundFor(4096)).toBe(250_000);
    expect(buildMemoryMb()).toBeGreaterThan(0);
  });

  it('reads memory as the smaller of the container’s limit and the machine’s, the machine’s when there is no limit', () => {
    const machine = Math.floor(totalmem() / 2 ** 20);
    const limit = vi.spyOn(process, 'constrainedMemory');
    try {
      limit.mockReturnValue(2048 * 2 ** 20);
      expect(buildMemoryMb()).toBe(Math.min(2048, machine));
      limit.mockReturnValue(0);
      expect(buildMemoryMb()).toBe(machine);
      limit.mockReturnValue(Number.MAX_SAFE_INTEGER);
      expect(buildMemoryMb()).toBe(machine);
    } finally {
      limit.mockRestore();
    }
  });

  // QA's gate on #182, F6: the loader's default own-page bound is the one the function's memory
  // allows. Generic-anchor edges count toward it, so 120,000 of them sit between the two bounds.
  it('takes its default own-page bound from the function’s memory: past 100,000 fails at 2 GB, holds at 4 GB', async () => {
    const { deps } = await between();
    await atMemory(2048, () =>
      expect(loadResultsForBuild(deps, EVENT)).rejects.toMatchObject({ reason: 'build_failed' }),
    );
    await atMemory(4096, () => expect(loadResultsForBuild(deps, EVENT)).resolves.toBeDefined());
  }, 60_000);

  it('fails the check build_failed, by name, when the own-page edges pass their bound', async () => {
    const s = await setup(40);
    const own = s.results
      .filter(isCrawl)
      .flatMap((b) => b.link_edges)
      .filter((e) => !e.to_url.includes('/never-crawled/') || e.is_generic_anchor).length;
    await expect(loadResultsForBuild(s.deps, EVENT, 1, own - 1)).rejects.toMatchObject({
      reason: 'build_failed',
    });
    await expect(loadResultsForBuild(s.deps, EVENT, 1, own)).resolves.toBeDefined();
  });
});

// QA's gate on #182, F2: crawl planning reads only pages and discovered URLs, so its loader keeps no
// edge. Each result's edges are let go as it is read, so a post holds none of the check's edges.
describe('loadResultsForPlanning (F2)', () => {
  it('answers what loadResults does with every crawl result’s edges dropped', async () => {
    const s = await setup(40);
    const planned = await loadResultsForPlanning(s.deps, EVENT);
    const full = await loadResults(s.deps, EVENT);
    expect(planned.filter(isCrawl).every((b) => b.link_edges.length === 0)).toBe(true);
    expect(planned).toEqual(full.map((b) => (isCrawl(b) ? { ...b, link_edges: [] } : b)));
  });
});

// QA's gate on #182, F2: the render step and an access post plan over the build's bounded view, so a
// check past the bound fails build_failed there, by name, instead of holding every edge it stored.
describe('render and access planning read the build’s bounded view (F2)', () => {
  const event = {
    checkId: 'c0000000-0000-4000-8000-000000000001',
    siteId: 's0000000-0000-4000-8000-000000000001',
    accountId: null,
    host: 'built-site.test',
    homepageUrl: 'https://built-site.test',
    trigger: 'manual',
    pageCap: 500,
  } as const;

  // Why the bounded view moves no grade: past the cap it keeps every own-page edge, so the pages, their
  // PageRank, the access sample and the render candidates are the ones the whole set of edges gives.
  it('over the cap, the access sample and the render candidates are the ones the full edges give', async () => {
    const s = await setup(40);
    const total = s.edges(s.results);
    const bounded = await loadResultsForBuild(s.deps, EVENT, Math.floor(total / 4));
    const full = await loadResults(s.deps, EVENT);
    expect(s.edges(bounded)).toBeLessThan(total);
    const input = recordedInput();
    const planOver = (results: BatchResult[]) => {
      const a = assemble(
        { ...input, render: null },
        readBatches(results, { id: input.check.id, site_id: input.check.site_id }, 'unreleased'),
      );
      const picked = sample(a);
      return {
        pageranks: a.pages.map((p) => [p.url, p.pagerank_share]),
        picked,
        render: renderCandidates(a, [...picked.stage1, ...picked.stage2], [], new Map()),
      };
    };
    expect(planOver(bounded)).toEqual(planOver(full));
  });

  it('render fails build_failed past the bound at 2 GB', async () => {
    const { deps, evidence } = await between();
    await putJson(evidence, pathOf(event, 'seeds'), []);
    const withClock = { ...deps, now: () => 0 } as StepDeps;
    await atMemory(2048, () =>
      expect(finishSteps(withClock).render(event, {} as never)).rejects.toMatchObject({
        reason: 'build_failed',
      }),
    );
  }, 60_000);

  it('an access post fails build_failed past the bound at 2 GB', async () => {
    const { deps, evidence } = await between();
    await putJson(evidence, pathOf(event, 'seeds'), []);
    const withWorker = {
      ...deps,
      store: { ...deps.store, batch: async () => null },
      worker: () => ({ pollBatch: async () => ({ status: 'not_found' }) }),
      now: () => 0,
    } as unknown as StepDeps;
    await atMemory(2048, () =>
      expect(
        batchSteps(withWorker).post(event, { kind: 'access', batch: 9, stage: 1 }, {} as never),
      ).rejects.toMatchObject({ reason: 'build_failed' }),
    );
  }, 60_000);
});
