import { BatchResultSchema, type BatchResult, type LinkEdge } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { edgeQuota } from '@crawlmouse/engine/v2/pipeline';
import { readRecorded } from '../../../../../../packages/engine/fixtures/v2/build/recorded';
import { putJson } from '../evidence';
import { memoryEvidenceStore } from '../test-support/memory-evidence';
import type { StepDeps } from './deps';
import { isCrawl, loadResults, loadResultsForBuild } from './stored';

/** The build step's loader (F-248): unchanged within the bound, bounded and streamed over it. */
const EVENT = { checkId: 'c0000000-0000-4000-8000-000000000001' } as never;

async function setup(extraPerPage: number) {
  const results = (readRecorded('batches') as unknown[]).map((r) => {
    const b = BatchResultSchema.parse(r);
    if (!isCrawl(b)) return b;
    const extra: LinkEdge[] = b.pages
      .filter((p) => p.outcome === 'fetched')
      .flatMap((p) =>
        Array.from({ length: extraPerPage }, (_, i) => ({
          check_id: b.check_id,
          from_url: p.url,
          to_url: `${new URL(p.url).origin}/never-crawled/${p.url.length}-${i}`,
          anchor_text: 'Article',
          is_generic_anchor: false,
          js_only: false,
        })),
      );
    return { ...b, link_edges: [...b.link_edges, ...extra] };
  });
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

describe('loadResultsForBuild (F-248)', () => {
  it('within the bound, answers what loadResults does, reading each result once', async () => {
    const s = await setup(5);
    const total = s.edges(s.results);
    const bounded = await loadResultsForBuild(s.deps, EVENT, total);
    expect(s.reads()).toBe(s.results.length);
    expect(bounded).toEqual(await loadResults(s.deps, EVENT));
  });

  it('over the bound, holds at most the bound, and reads each result twice', async () => {
    const s = await setup(40);
    const total = s.edges(s.results);
    const cap = Math.floor(total / 4);
    const bounded = await loadResultsForBuild(s.deps, EVENT, cap);
    expect(s.reads()).toBe(2 * s.results.length);
    expect(s.edges(bounded)).toBeLessThanOrEqual(cap);
    // Each source page keeps at most its share; a page with more links to unfetched pages than its
    // share keeps exactly that share of them.
    const pages = s.results.filter(isCrawl).reduce((n, b) => n + b.pages.length, 0);
    const quota = edgeQuota(pages, cap);
    const bySource = new Map<string, number>();
    const elsewhere = new Map<string, number>();
    for (const e of bounded.filter(isCrawl).flatMap((b) => b.link_edges)) {
      bySource.set(e.from_url, (bySource.get(e.from_url) ?? 0) + 1);
      if (e.to_url.includes('/never-crawled/'))
        elsewhere.set(e.from_url, (elsewhere.get(e.from_url) ?? 0) + 1);
    }
    expect(Math.max(...bySource.values())).toBeLessThanOrEqual(quota.own + quota.other);
    expect(new Set(elsewhere.values())).toEqual(new Set([quota.other]));
    // Only edges are cut: the pages, the access tests and every other field are the results' own.
    const strip = (bs: readonly BatchResult[]) =>
      bs.map((b) => (isCrawl(b) ? { ...b, link_edges: [] } : b));
    expect(strip(bounded)).toEqual(strip(await loadResults(s.deps, EVENT)));
  });
});
