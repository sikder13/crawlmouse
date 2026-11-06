/**
 * The builder files links the way the structure detectors do (detectors/scope.ts `out`), so the grade
 * and the detectors read the same links. Compared where scope keeps links: from a page answering 200,
 * to a URL robots.txt does not exclude.
 */
import { describe, expect, it } from 'vitest';
import { readRecorded, recordedInput } from '../../../fixtures/v2/build/recorded.js';
import { CHECK, crawlBatch, crawlRow, edge, SITE } from '../../../fixtures/v2/build/rows.js';
import { scopeOf } from '../detectors/scope.js';
import { assemble, type Assembled } from './assemble.js';
import { readBatches } from './batches.js';

const pairs = (es: readonly { from_url: string; to_url: string }[]) =>
  es.map((e) => `${e.from_url} -> ${e.to_url}`).sort();

function scoped(a: Assembled, pageCap: number): string[] {
  const s = scopeOf({
    check: { status: 'finished', coverage: a.coverage },
    page_cap: pageCap,
    homepage_url: a.homepage_url,
    pages: a.pages,
    edges: a.edges,
    disallowed: a.disallowed,
    previous_coverage: null,
  });
  return pairs([...s.out.values()].flat());
}

function ours(a: Assembled): string[] {
  const ok = new Set(a.pages.filter((p) => p.status_code === 200).map((p) => p.url));
  return pairs(a.filed_edges.filter((e) => ok.has(e.from_url)));
}

describe('filing a redirected page’s links', () => {
  it.each(['batches', 'variant'])('agrees with the detectors on the recorded %s', (dir) => {
    const input = recordedInput();
    const batches = readRecorded(dir).filter((b) => b.kind === 'crawl');
    const a = assemble({ ...input, render: null }, readBatches(batches, input.check, 'unreleased'));
    expect(ours(a)).toEqual(scoped(a, input.check.page_cap));
  });

  it('files the links of a page whose request landed elsewhere under the page, and a link to the landing URL too', () => {
    const HOME = 'https://f.test';
    const rows = [
      crawlRow({ url: HOME, outcome: 'fetched', status: 200, links_out: 1 }),
      crawlRow({
        url: `${HOME}/a/old-page`,
        outcome: 'fetched',
        status: 200,
        final_url: `${HOME}/b/new-page`,
        links_out: 1,
      }),
      crawlRow({ url: `${HOME}/c/child-page`, outcome: 'fetched', status: 200, links_out: 1 }),
    ];
    const edges = [
      edge(HOME, `${HOME}/a/old-page`),
      edge(`${HOME}/b/new-page`, `${HOME}/c/child-page`),
      edge(`${HOME}/c/child-page`, `${HOME}/b/new-page`),
    ];
    const a = assemble(
      {
        check: { id: CHECK, site_id: SITE, page_cap: 500 } as never,
        homepage_url: HOME,
        seeds: [],
        render: null,
      },
      readBatches([crawlBatch(0, rows, edges)], { id: CHECK, site_id: SITE }, 'unreleased'),
    );
    expect(ours(a)).toEqual([
      `${HOME} -> ${HOME}/a/old-page`,
      `${HOME}/a/old-page -> ${HOME}/c/child-page`,
      `${HOME}/c/child-page -> ${HOME}/a/old-page`,
    ]);
    expect(ours(a)).toEqual(scoped(a, 500));
    // The child is reached through the redirected page, so it has a depth and an inbound link.
    expect(a.pages.find((p) => p.url === `${HOME}/c/child-page`)).toMatchObject({
      depth: 2,
      links_in: 1,
    });
    // The link rows stay as the worker recorded them.
    expect(pairs(a.edges)).toEqual(pairs(edges));
  });
});
