/**
 * The cost of the link map's "every page" scope on a measured check (CC-22b D4). A real check has
 * no recording, so `/audit/[id]/map?scope=all` lays its record out when the page is asked for.
 * This measures that at the most pages a check crawls (DEFAULT_PAGE_CAP) and holds it to a budget.
 * If the cap is raised past the size measured here, the first test fails until this is measured
 * again at the new cap.
 */
import { buildCheck } from '@crawlmouse/engine/v2/pipeline';
import { describe, expect, it } from 'vitest';
import {
  crawlRow,
  edge,
  oneBatchBuild,
} from '../../../../../packages/engine/fixtures/v2/build/rows';
import { DEFAULT_PAGE_CAP } from '../pipeline/limits';
import { linkMapView } from './link-map';
import { datasetOfBuilds } from './test-support/built-dataset';

const PAGES = 500;
/** One request's share of a 300-second function: the layout may take this long, and no longer. */
export const ALL_SCOPE_BUDGET_MS = 5_000;
export const ALL_SCOPE_BUDGET_HEAP_MB = 256;

const HOME = 'https://large-site.test';
/** The homepage links to 24 section pages; each section links to its share of the other pages. */
function largeSite() {
  const sections = Array.from({ length: 24 }, (_, i) => `${HOME}/section-${i}`);
  const leaves = Array.from(
    { length: PAGES - 1 - sections.length },
    (_, i) => `${HOME}/s${i % sections.length}/page-${i}`,
  );
  const edges = [
    ...sections.map((s) => edge(HOME, s)),
    ...leaves.map((l, i) => edge(sections[i % sections.length]!, l)),
    // Links back and across, so the walk has more than one way to each page.
    ...leaves.map((l) => edge(l, HOME)),
    ...leaves.slice(1).map((l, i) => edge(leaves[i]!, l)),
  ];
  const out = (url: string) => edges.filter((e) => e.from_url === url).length;
  const rows = [HOME, ...sections, ...leaves].map((url) =>
    crawlRow({ url, outcome: 'fetched', status: 200, links_out: out(url) }),
  );
  return oneBatchBuild(HOME, rows, edges);
}

describe('laying out every page of a check at the page cap', () => {
  it('is measured at the cap the pipeline crawls to', () => {
    expect(DEFAULT_PAGE_CAP).toBeLessThanOrEqual(PAGES);
  });

  it(`draws ${PAGES} pages inside ${ALL_SCOPE_BUDGET_MS} ms and ${ALL_SCOPE_BUDGET_HEAP_MB} MB of heap`, () => {
    const input = largeSite();
    const built = buildCheck(input);
    const d = datasetOfBuilds(input.site, [built]);
    expect(d.page_results).toHaveLength(PAGES);
    globalThis.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    const view = linkMapView(d, built.check.id, { scope: 'all' });
    const ms = performance.now() - startedAt;
    const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 2 ** 20;
    console.log(
      `link map, every page: ${view.nodes.length} nodes of ${PAGES} pages in ${ms.toFixed(0)} ms, heap +${heapMb.toFixed(1)} MB`,
    );
    expect(view.nodes).toHaveLength(PAGES);
    expect(view.renderer).toBe('svg');
    expect(ms).toBeLessThan(ALL_SCOPE_BUDGET_MS);
    expect(heapMb).toBeLessThan(ALL_SCOPE_BUDGET_HEAP_MB);
  }, 120_000);
});
