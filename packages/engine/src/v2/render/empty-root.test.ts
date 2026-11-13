import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_ROOT_MAX_RENDERS,
  EMPTY_ROOT_PER_TEMPLATE,
  emptyRoot,
  selectEmptyRoots,
  type EmptyRootCandidate,
} from './empty-root.js';

const shell = (
  path: string,
  template_key: string,
  pr: number | null,
  over: Partial<EmptyRootCandidate> = {},
): EmptyRootCandidate => ({
  url: `https://site.example${path}`,
  template_key,
  kind: 'thin',
  status_code: 200,
  is_html: true,
  pagerank_share: pr,
  fetched_under_our_robots: true,
  client_rendered: true,
  ...over,
});

const paths = (picks: { url: string }[]) =>
  picks.map((p) => p.url.slice('https://site.example'.length));

describe('the pinned numbers', () => {
  it('are at most five empty-root pages a check and two a template', () => {
    expect([EMPTY_ROOT_MAX_RENDERS, EMPTY_ROOT_PER_TEMPLATE]).toEqual([5, 2]);
  });
});

describe('the picks', () => {
  // Four templates; the keys sort /a, /b, /c, /d, and the pool lists them out of that order.
  const pool = [
    shell('/d/1', '/d', 0.9),
    shell('/b/1', '/b', 0.01),
    shell('/a/1', '/a', 0.02),
    shell('/c/1', '/c', 0.5),
    shell('/a/2', '/a', 0.3),
    shell('/b/2', '/b', 0.2),
    shell('/a/3', '/a', 0.1),
    shell('/b/3', '/b', 0.05),
    shell('/d/2', '/d', 0.8),
  ];

  it('go by template key, then PageRank, two a template and five in all', () => {
    expect(paths(selectEmptyRoots(pool, EMPTY_ROOT_MAX_RENDERS))).toEqual([
      '/a/2',
      '/a/3',
      '/b/2',
      '/b/3',
      '/c/1',
    ]);
  });

  it('stop at the cap the caller passes', () => {
    expect(paths(selectEmptyRoots(pool, 3))).toEqual(['/a/2', '/a/3', '/b/2']);
    expect(selectEmptyRoots(pool, 0)).toEqual([]);
  });

  it('break a PageRank tie by URL, and rank an unknown PageRank last', () => {
    const tied = [shell('/t/z', '/t', 0.4), shell('/t/none', '/t', null), shell('/t/a', '/t', 0.4)];
    expect(paths(selectEmptyRoots(tied, 5))).toEqual(['/t/a', '/t/z']);
    expect(paths(selectEmptyRoots([tied[1]!], 5))).toEqual(['/t/none']);
  });

  it('say why each was picked', () => {
    expect(selectEmptyRoots([shell('/x', '/x', 0.1)], 5)).toEqual([
      { url: 'https://site.example/x', template_key: '/x', picked_for: 'empty_root' },
    ]);
  });

  it('refuse a cap that is not a whole number of renders', () => {
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(() => selectEmptyRoots(pool, bad)).toThrow(RangeError);
    }
  });
});

describe('templates with a graded page (R2-B1)', () => {
  const graded = (path: string, template_key: string) =>
    shell(path, template_key, 0.5, { kind: 'content', client_rendered: false });

  it('r8: are left out, so the picks go to the template with no graded page', () => {
    const pool = [
      ...['/a', '/b', '/c'].flatMap((t) => [
        graded(`${t}/g`, t),
        shell(`${t}/1`, t, 0.01),
        shell(`${t}/2`, t, 0.01),
      ]),
      shell('/z/1', '/z', 0.01),
      shell('/z/2', '/z', 0.01),
    ];
    expect(paths(selectEmptyRoots(pool, EMPTY_ROOT_MAX_RENDERS))).toEqual(['/z/1', '/z/2']);
  });

  it('only a graded page counts: a 404 or non-HTML content page leaves the template in', () => {
    const pool = [
      shell('/a/404', '/a', 0.5, { kind: 'content', status_code: 404 }),
      shell('/a/pdf', '/a', 0.5, { kind: 'content', is_html: false }),
      shell('/a/1', '/a', 0.01),
    ];
    expect(paths(selectEmptyRoots(pool, 5))).toEqual(['/a/1']);
  });
});

describe('what an empty-root page is', () => {
  it('a thin page that answered 200 with HTML, fetched under our robots.txt, read as an app shell', () => {
    expect(emptyRoot(shell('/x', '/x', 0.1))).toBe(true);
  });

  it.each([
    ['a content page', { kind: 'content' as const }],
    ['a 404', { status_code: 404 }],
    ['not HTML', { is_html: false }],
    ['not read as an app shell', { client_rendered: false }],
    ['not fetched under our robots.txt group', { fetched_under_our_robots: false }],
  ])('not %s', (_name, over) => {
    const p = shell('/x', '/x', 0.1, over);
    expect(emptyRoot(p)).toBe(false);
    expect(selectEmptyRoots([p], 5)).toEqual([]);
  });

  it('a URL with any listing that is not one is not picked', () => {
    const twice = [shell('/x', '/x', 0.1), shell('/x', '/y', 0.2, { client_rendered: false })];
    expect(selectEmptyRoots(twice, 5)).toEqual([]);
  });

  it('a URL listed twice as one is picked once', () => {
    const twice = [shell('/x', '/y', 0.1), shell('/x', '/x', 0.1)];
    expect(selectEmptyRoots(twice, 5)).toEqual([
      { url: 'https://site.example/x', template_key: '/x', picked_for: 'empty_root' },
    ]);
  });
});

/**
 * The picks, computed another way: drop the templates with a page that answered 200 with HTML as
 * content; per remaining template in key order, its best two; then the first `max`.
 */
function expected(pool: readonly EmptyRootCandidate[], max: number): string[] {
  const graded = new Set(
    pool
      .filter((p) => p.kind === 'content' && p.status_code === 200 && p.is_html)
      .map((p) => p.template_key),
  );
  const byUrl = new Map<string, EmptyRootCandidate[]>();
  for (const p of pool) byUrl.set(p.url, [...(byUrl.get(p.url) ?? []), p]);
  const kept: EmptyRootCandidate[] = [];
  for (const all of byUrl.values()) {
    if (!all.every(emptyRoot)) continue;
    const listings = all.filter((p) => !graded.has(p.template_key));
    if (listings.length === 0) continue;
    const pr = (p: EmptyRootCandidate) => p.pagerank_share ?? -1;
    const best = Math.max(...listings.map(pr));
    const keys = listings.filter((p) => pr(p) === best).map((p) => p.template_key);
    kept.push(listings.find((p) => pr(p) === best && p.template_key === [...keys].sort()[0])!);
  }
  const templates = [...new Set(kept.map((p) => p.template_key))].sort();
  return templates
    .flatMap((t) =>
      kept
        .filter((p) => p.template_key === t)
        .sort(
          (a, b) => (b.pagerank_share ?? -1) - (a.pagerank_share ?? -1) || (a.url < b.url ? -1 : 1),
        )
        .slice(0, 2),
    )
    .slice(0, max)
    .map((p) => p.url);
}

const candidate = fc.record({
  path: fc.constantFrom('/1', '/2', '/3', '/4', '/5', '/6', '/7', '/8'),
  template_key: fc.constantFrom('/a', '/b', '/c', '/d'),
  pr: fc.option(fc.constantFrom(0.1, 0.2, 0.3), { nil: null }),
  kind: fc.constantFrom('thin' as const, 'thin' as const, 'content' as const),
  client_rendered: fc.boolean(),
});

describe('the picks, over generated pools (property)', () => {
  it('match an independent statement of the rule, and do not depend on the pool order', () => {
    fc.assert(
      fc.property(
        fc.array(candidate, { maxLength: 24 }),
        fc.integer({ min: 0, max: 8 }),
        fc.integer(),
        (rows, max, seed) => {
          const pool = rows.map((r) =>
            shell(r.path, r.template_key, r.pr, {
              kind: r.kind,
              client_rendered: r.client_rendered,
            }),
          );
          const picks = selectEmptyRoots(pool, max);
          expect(picks.map((p) => p.url)).toEqual(expected(pool, max));
          const k = Math.abs(seed) % Math.max(pool.length, 1);
          const reordered = [...pool.slice(k), ...pool.slice(0, k)].reverse();
          expect(selectEmptyRoots(reordered, max)).toEqual(picks);
          expect(picks.length).toBeLessThanOrEqual(max);
          const perTemplate = new Map<string, number>();
          for (const p of picks)
            perTemplate.set(p.template_key, (perTemplate.get(p.template_key) ?? 0) + 1);
          for (const n of perTemplate.values()) expect(n).toBeLessThanOrEqual(2);
        },
      ),
      { numRuns: 500 },
    );
  });
});
