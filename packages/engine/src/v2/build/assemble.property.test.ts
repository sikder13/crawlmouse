/**
 * Assembly over generated checks (fast-check): which rows become pages, what the links say, and
 * depth, each held to a value the test computes itself.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalizeUrl } from '../../url-canonical.js';
import { CHECK, crawlBatch, crawlRow, edge, SITE } from '../../../fixtures/v2/build/rows.js';
import { assemble } from './assemble.js';
import { readBatches } from './batches.js';

const HOME = 'https://g.test';
const pageUrl = (i: number) => (i === 0 ? HOME : `${HOME}/p/item-${i}`);
const landing = (i: number) => `${HOME}/l/landing-${i}`;
const uncrawled = (j: number) => `${HOME}/u/away-${j}`;

type Outcome = 'ok' | 'gone' | 'redirect' | 'disallowed' | 'not_requested';

interface Generated {
  outcomes: Outcome[];
  links: [number, number, 'page' | 'away' | 'landing'][];
  extra: number[];
}

const generated = fc.integer({ min: 2, max: 30 }).chain((n) =>
  fc.record({
    outcomes: fc.tuple(
      fc.constant<Outcome>('ok'),
      ...Array.from({ length: n - 1 }, () =>
        fc.constantFrom<Outcome>(
          'ok',
          'ok',
          'ok',
          'gone',
          'redirect',
          'disallowed',
          'not_requested',
        ),
      ),
    ),
    // [from page, to target, where the link points: the page, an uncrawled URL, or (when the target
    // redirects) the URL its request landed on]
    links: fc.array(
      fc.tuple(fc.nat(n - 1), fc.nat(n - 1), fc.constantFrom('page', 'away', 'landing')),
      { maxLength: 80 },
    ),
    extra: fc.array(fc.nat(3), { minLength: n, maxLength: n }),
  }),
);

function input(g: Generated) {
  const n = g.outcomes.length;
  const serves = (i: number) => g.outcomes[i] === 'ok' || g.outcomes[i] === 'redirect';
  // A redirected page's links are recorded from where it landed, as the worker records them.
  const from = (i: number) => (g.outcomes[i] === 'redirect' ? landing(i) : pageUrl(i));
  const edges = g.links
    .filter(([f]) => serves(f))
    .map(([f, t, to]) =>
      edge(
        from(f),
        to === 'away'
          ? uncrawled(t)
          : to === 'landing' && g.outcomes[t] === 'redirect'
            ? landing(t)
            : pageUrl(t),
      ),
    )
    .filter((e) => e.from_url !== e.to_url);
  const recorded = (i: number) =>
    new Set(edges.filter((e) => e.from_url === from(i)).map((e) => e.to_url)).size;
  const rows = g.outcomes.map((o, i) =>
    crawlRow({
      url: pageUrl(i),
      outcome:
        o === 'disallowed'
          ? 'robots_disallowed'
          : o === 'not_requested'
            ? 'not_requested'
            : 'fetched',
      status: o === 'gone' ? 404 : 200,
      final_url: o === 'redirect' ? landing(i) : undefined,
      links_out: serves(i) ? recorded(i) + g.extra[i]! : 0,
    }),
  );
  const discovered = [...new Set(edges.map((e) => e.to_url))].filter((u) => u.includes('/u/'));
  const batch = crawlBatch(0, rows, edges, discovered);
  const built = assemble(
    {
      check: { id: CHECK, site_id: SITE, page_cap: 500 } as never,
      homepage_url: HOME,
      seeds: [{ url: HOME, source: 'homepage', lastmod: null }],
      render: null,
    },
    readBatches([batch], { id: CHECK, site_id: SITE }, 'unreleased'),
  );
  // The truth the test files by itself: page i's request landed on landing(i), a URL no other row names.
  const owner = new Map(
    g.outcomes.flatMap((o, i) => (o === 'redirect' ? [[landing(i), pageUrl(i)]] : [])),
  );
  const file = (u: string) => owner.get(u) ?? u;
  const seen = new Set<string>();
  const filed = edges
    .map((e) => ({ from_url: file(e.from_url), to_url: file(e.to_url) }))
    .filter(
      (e) =>
        e.from_url !== e.to_url &&
        !seen.has(`${e.from_url} ${e.to_url}`) &&
        !!seen.add(`${e.from_url} ${e.to_url}`),
    );
  return { n, rows, edges, built, from, serves, filed };
}

/** Breadth-first distances from the homepage over links whose both ends are pages. */
function bfs(
  pages: Set<string>,
  edges: { from_url: string; to_url: string }[],
): Map<string, number> {
  const dist = new Map([[HOME, 0]]);
  const queue = [HOME];
  while (queue.length) {
    const at = queue.shift()!;
    for (const e of edges) {
      if (e.from_url === at && pages.has(e.to_url) && !dist.has(e.to_url)) {
        dist.set(e.to_url, dist.get(at)! + 1);
        queue.push(e.to_url);
      }
    }
  }
  return dist;
}

describe('assemble, on generated checks', () => {
  it('puts every crawl row in exactly one place: a page, robots-disallowed, or discovered and not crawled', () => {
    fc.assert(
      fc.property(generated, (g) => {
        const { rows, built } = input(g);
        const pages = new Set(built.pages.map((p) => p.url));
        expect(pages.size).toBe(built.pages.length);
        const disallowed = new Set(built.disallowed.map((d) => d.url));
        for (const r of rows) {
          const places = [pages.has(r.url), disallowed.has(r.url), r.outcome === 'not_requested'];
          expect(places.filter(Boolean)).toHaveLength(1);
          expect(pages.has(r.url)).toBe(r.outcome === 'fetched');
        }
      }),
    );
  });

  it("files every link under a crawled page, or under the final URL a crawled page's request landed on", () => {
    fc.assert(
      fc.property(generated, (g) => {
        const { built } = input(g);
        const homes = new Set(
          built.pages.flatMap((p) => [
            p.url,
            ...(p.final_url ? [canonicalizeUrl(p.final_url)] : []),
          ]),
        );
        for (const e of built.edges) expect(homes.has(e.from_url)).toBe(true);
      }),
    );
  });

  it("counts a page's links as the worker found them: at least those recorded, and exactly those when none were left out", () => {
    fc.assert(
      fc.property(generated, (g) => {
        const { built, from, serves } = input(g);
        g.outcomes.forEach((_, i) => {
          const page = built.pages.find((p) => p.url === (i === 0 ? HOME : `${HOME}/p/item-${i}`));
          if (!page || !serves(i)) return;
          const recorded = built.edges.filter((e) => e.from_url === from(i)).length;
          expect(page.links_out).toBeGreaterThanOrEqual(recorded);
          if (g.extra[i] === 0) expect(page.links_out).toBe(recorded);
        });
      }),
    );
  });

  it('gives each page its inbound links once per linking page, so they sum to the filed links into pages', () => {
    fc.assert(
      fc.property(generated, (g) => {
        const { built, filed } = input(g);
        const pages = new Set(built.pages.map((p) => p.url));
        const into = filed.filter((e) => pages.has(e.to_url)).length;
        expect(built.pages.reduce((n, p) => n + p.links_in, 0)).toBe(into);
      }),
    );
  });

  it('keeps a link to a URL the crawl did not fetch: it is how the detectors know the crawl did not see every page it found', () => {
    fc.assert(
      fc.property(generated, (g) => {
        const { built, edges } = input(g);
        const away = new Set(
          edges.filter((e) => e.to_url.includes('/u/')).map((e) => `${e.from_url} ${e.to_url}`),
        );
        expect(built.edges.filter((e) => e.to_url.includes('/u/'))).toHaveLength(away.size);
      }),
    );
  });

  it('gives the homepage depth 0 and every other page its breadth-first distance over the filed links, or null', () => {
    fc.assert(
      fc.property(generated, (g) => {
        const { built, filed } = input(g);
        const pages = new Set(built.pages.map((p) => p.url));
        // Over the links filed under the page they were found on: a redirected page's links count.
        const dist = bfs(pages, filed);
        for (const p of built.pages) expect(p.depth).toBe(dist.get(p.url) ?? null);
        expect(built.pages.find((p) => p.url === HOME)!.depth).toBe(0);
      }),
    );
  });
});

describe('assemble, when the homepage is not a page', () => {
  it("gives no page a depth, rather than v1's fallback roots, which would put orphans at depth 0", () => {
    const rows = [
      crawlRow({ url: HOME, outcome: 'not_requested' }),
      crawlRow({ url: pageUrl(1), outcome: 'fetched', status: 200, links_out: 1 }),
      crawlRow({ url: pageUrl(2), outcome: 'fetched', status: 200 }),
    ];
    const built = assemble(
      {
        check: { id: CHECK, site_id: SITE, page_cap: 500 } as never,
        homepage_url: HOME,
        seeds: [],
        render: null,
      },
      readBatches(
        [crawlBatch(0, rows, [edge(pageUrl(1), pageUrl(2))])],
        { id: CHECK, site_id: SITE },
        'unreleased',
      ),
    );
    expect(built.pages.map((p) => p.depth)).toEqual([null, null]);
  });
});
