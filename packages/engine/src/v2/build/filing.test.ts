/**
 * The builder files links the way the structure detectors do (detectors/scope.ts `out`), so the grade
 * and the detectors read the same links. Compared where scope keeps links: from a page answering 200,
 * to a URL robots.txt does not exclude.
 */
import fc from 'fast-check';
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
    client_rendered: a.client_rendered,
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

  it('agrees with the detectors on generated checks, landings shared, crawled and stopped included', () => {
    const HOME = 'https://g.test';
    const url = (i: number) => (i === 0 ? HOME : `${HOME}/p/page-${i}`);
    const land = (j: number) => `${HOME}/l/landing-${j}`;
    // Each page answers 200, 404 or a redirect; a redirect lands on a landing URL (shared when two
    // pages pick the same j), on another crawled page, or stops at its 301.
    const page = fc.record({
      status: fc.constantFrom(200, 200, 404, 301),
      lands: fc.option(
        fc.oneof(
          fc.nat(3).map((j) => ({ landing: j })),
          fc.nat(9).map((k) => ({ page: k })),
        ),
        { nil: null },
      ),
    });
    fc.assert(
      fc.property(
        fc.array(page, { minLength: 2, maxLength: 10 }),
        fc.array(fc.tuple(fc.nat(13), fc.nat(13)), { maxLength: 40 }),
        (shape, links) => {
          const n = shape.length;
          const finalOf = (i: number) => {
            const l = shape[i]!.lands;
            if (l === null) return url(i);
            return 'landing' in l ? land(l.landing) : url(l.page % n);
          };
          const rows = shape.map((p, i) =>
            crawlRow({
              url: url(i),
              outcome: 'fetched',
              status: p.status,
              final_url: finalOf(i),
              links_out: 20,
            }),
          );
          // Links recorded from where each 200 page's request ended, to pages and landing URLs.
          const ends = [...Array.from({ length: n }, (_, i) => url(i)), ...[0, 1, 2, 3].map(land)];
          const edges = links
            .filter(([f]) => f < n && shape[f]!.status === 200)
            .map(([f, t]) => edge(finalOf(f), ends[t % ends.length]!))
            .filter(
              (e, i, all) =>
                e.from_url !== e.to_url &&
                all.findIndex((x) => x.from_url === e.from_url && x.to_url === e.to_url) === i,
            );
          const a = assemble(
            {
              check: { id: CHECK, site_id: SITE, page_cap: 500 } as never,
              homepage_url: HOME,
              seeds: [],
              render: null,
            },
            readBatches([crawlBatch(0, rows, edges)], { id: CHECK, site_id: SITE }, 'unreleased'),
          );
          expect(ours(a)).toEqual(scoped(a, 500));
        },
      ),
      { numRuns: 300 },
    );
  });
});
