import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FREE_MAX_RENDERS,
  PAGES_PER_FIX_TEMPLATE,
  renderable,
  selectRenders,
  type RenderCandidate,
} from './sample.js';

const page = (
  url: string,
  template_key: string,
  pr: number | null,
  over: Partial<RenderCandidate> = {},
) =>
  ({
    url: `https://site.example${url}`,
    template_key,
    kind: 'content',
    status_code: 200,
    is_html: true,
    pagerank_share: pr,
    fetched_under_our_robots: true,
    ...over,
  }) satisfies RenderCandidate;

describe('the pinned numbers', () => {
  it('are a Free cap of 25 and two pages for each template with an open fix', () => {
    expect([FREE_MAX_RENDERS, PAGES_PER_FIX_TEMPLATE]).toEqual([25, 2]);
  });
});

describe('the order of the picks', () => {
  const pages = [
    page('/', '/', 0.3),
    page('/p/a', '/p/{slug}', 0.05),
    page('/p/b', '/p/{slug}', 0.04),
    page('/p/c', '/p/{slug}', 0.2),
    page('/blog/x', '/blog/{slug}', 0.1),
    page('/blog/y', '/blog/{slug}', 0.09),
    page('/blog/z', '/blog/{slug}', 0.01),
    page('/about', '/about', 0.15),
  ];

  it('takes two pages of each open-fix template, then one of each template largest first, then PageRank', () => {
    expect(
      selectRenders(pages, ['/p/{slug}'], 8).map((p) => [p.url.slice(20), p.picked_for]),
    ).toEqual([
      ['/p/c', 'open_fix'],
      ['/p/a', 'open_fix'],
      ['/blog/x', 'template'],
      ['/', 'template'],
      ['/about', 'template'],
      ['/blog/y', 'pagerank'],
      ['/p/b', 'pagerank'],
      ['/blog/z', 'pagerank'],
    ]);
  });

  it('stops at the cap', () => {
    expect(selectRenders(pages, ['/p/{slug}'], 3).map((p) => p.url.slice(20))).toEqual([
      '/p/c',
      '/p/a',
      '/blog/x',
    ]);
  });

  it('renders nothing at a cap of zero', () => {
    expect(selectRenders(pages, [], 0)).toEqual([]);
  });

  it('refuses a cap that is not a whole number of renders', () => {
    expect(() => selectRenders(pages, [], -1)).toThrow(RangeError);
    expect(() => selectRenders(pages, [], 2.5)).toThrow(RangeError);
  });
});

describe('a URL the crawl lists twice', () => {
  it('is taken once, so an open-fix template still gets its two pages', () => {
    const pages = [page('/u1', '/f', 0.9), page('/u1', '/f', 0.9), page('/u2', '/f', 0.5)];
    expect(selectRenders(pages, ['/f'], 25).map((p) => [p.url.slice(20), p.picked_for])).toEqual([
      ['/u1', 'open_fix'],
      ['/u2', 'open_fix'],
    ]);
  });

  it('is taken at its higher PageRank, whatever the order', () => {
    const a = [page('/x', '/t', 0.9), page('/x', '/t', 0.1), page('/y', '/t', 0.5)];
    const b = [page('/x', '/t', 0.1), page('/x', '/t', 0.9), page('/y', '/t', 0.5)];
    expect(selectRenders(a, [], 1)).toEqual(selectRenders(b, [], 1));
    expect(selectRenders(a, [], 1).map((p) => p.url.slice(20))).toEqual(['/x']);
  });

  it('is taken under the template key that sorts first, whatever the order', () => {
    const a = [page('/u1', '/g', 0.9), page('/u1', '/f', 0.9)];
    const b = [...a].reverse();
    expect(selectRenders(a, [], 25)).toEqual(selectRenders(b, [], 25));
    expect(selectRenders(a, [], 25).map((p) => p.template_key)).toEqual(['/f']);
  });
});

describe('a URL with a listing the render may not take', () => {
  it('is not rendered, even under its other listing', () => {
    const pages = [
      page('/u', '/f', 0.9, { fetched_under_our_robots: false }),
      page('/u', '/g', 0.1),
    ];
    expect(selectRenders(pages, [], 25)).toEqual([]);
  });
});

describe('a page the render may not take', () => {
  it.each([
    ['one robots.txt disallows to our crawler', { fetched_under_our_robots: false }],
    ['a page that is not content', { kind: 'pagination' as const }],
    ['a page that did not answer 200', { status_code: 404 }],
    ['a response that is not HTML', { is_html: false }],
  ])('is never picked: %s, even with the highest PageRank', (_name, over) => {
    const pages = [page('/top', '/t', 0.9, over), page('/a', '/t', 0.1)];
    expect(renderable(pages[0]!)).toBe(false);
    expect(selectRenders(pages, ['/t'], 25).map((p) => p.url)).toEqual(['https://site.example/a']);
  });
});

// ─── Properties over generated crawls ──────────────────────────────────────────────────────────

const TEMPLATES = ['/', '/a/{slug}', '/b/{slug}', '/c/{slug}', '/d/{slug}', '/e', '/f/{id}'];

// Mostly renderable pages, so the properties have crawls to bite on; the rest vary each attribute
// `renderable` reads.
const row = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constant({
      kind: 'content',
      status_code: 200,
      is_html: true,
      fetched_under_our_robots: true,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constantFrom('content', 'pagination', 'tag'),
      status_code: fc.constantFrom(200, 301, 404),
      is_html: fc.boolean(),
      fetched_under_our_robots: fc.boolean(),
    }),
  },
);
const crawl = fc
  .array(
    fc.record({
      template_key: fc.constantFrom(...TEMPLATES),
      pagerank_share: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null, freq: 6 }),
      gate: row,
    }),
    { minLength: 15, maxLength: 60, size: 'max' },
  )
  .map((rows) =>
    rows.map(
      ({ gate, ...r }, i) =>
        ({ ...r, ...gate, url: `https://site.example/p${i}` }) as RenderCandidate,
    ),
  );

const fixTemplates = fc.subarray([...TEMPLATES, '/not-crawled/{slug}']);
const cap = fc.integer({ min: 0, max: 30 });

function byTemplate(pages: readonly RenderCandidate[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of pages.filter(renderable)) m.set(p.template_key, (m.get(p.template_key) ?? 0) + 1);
  return m;
}

/** The renders needed to cover every template, open-fix templates twice where they have two pages. */
function coverageNeed(pages: readonly RenderCandidate[], fixes: readonly string[]): number {
  let need = 0;
  for (const [t, n] of byTemplate(pages))
    need += fixes.includes(t) ? Math.min(PAGES_PER_FIX_TEMPLATE, n) : 1;
  return need;
}

describe('the selection, over any crawl', () => {
  it('holds the cap, picks no page twice, and picks only renderable pages of the crawl', () => {
    fc.assert(
      fc.property(crawl, fixTemplates, cap, (pages, fixes, max) => {
        const picked = selectRenders(pages, fixes, max);
        expect(picked.length).toBeLessThanOrEqual(max);
        expect(new Set(picked.map((p) => p.url)).size).toBe(picked.length);
        const byUrl = new Map(pages.map((p) => [p.url, p]));
        for (const p of picked) {
          const source = byUrl.get(p.url);
          expect(source && renderable(source)).toBe(true);
          expect(p.template_key).toBe(source!.template_key);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('covers every template, and each open-fix template twice where it can, when the cap allows', () => {
    fc.assert(
      fc.property(crawl, fixTemplates, cap, (pages, fixes, max) => {
        fc.pre(max >= coverageNeed(pages, fixes));
        const picked = selectRenders(pages, fixes, max);
        for (const [t, n] of byTemplate(pages)) {
          const want = fixes.includes(t) ? Math.min(PAGES_PER_FIX_TEMPLATE, n) : 1;
          expect(picked.filter((p) => p.template_key === t).length).toBeGreaterThanOrEqual(want);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('spends the whole cap on templates when it cannot cover them all: no PageRank pick', () => {
    fc.assert(
      fc.property(crawl, fixTemplates, cap, (pages, fixes, max) => {
        fc.pre(max < coverageNeed(pages, fixes));
        const picked = selectRenders(pages, fixes, max);
        expect(picked.length).toBe(max);
        expect(picked.some((p) => p.picked_for === 'pagerank')).toBe(false);
      }),
      { numRuns: 400 },
    );
  });

  it('fills what is left with the highest PageRank pages not yet picked', () => {
    fc.assert(
      fc.property(crawl, fixTemplates, cap, (pages, fixes, max) => {
        const picked = selectRenders(pages, fixes, max);
        const rank = (url: string) => pages.find((p) => p.url === url)!.pagerank_share ?? -1;
        const byPagerank = picked.filter((p) => p.picked_for === 'pagerank');
        if (byPagerank.length === 0) return;
        const lowest = Math.min(...byPagerank.map((p) => rank(p.url)));
        const chosen = new Set(picked.map((p) => p.url));
        for (const p of pages.filter(renderable)) {
          if (!chosen.has(p.url)) expect(p.pagerank_share ?? -1).toBeLessThanOrEqual(lowest);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('does not depend on the order the crawl lists its pages in', () => {
    fc.assert(
      fc.property(crawl, fixTemplates, cap, fc.integer(), (pages, fixes, max, seed) => {
        const shuffled = [...pages].sort(
          (a, b) =>
            ((seed ^ (a.url.length * 31) ^ a.url.charCodeAt(a.url.length - 1)) % 7) -
            ((seed ^ (b.url.length * 31) ^ b.url.charCodeAt(b.url.length - 1)) % 7),
        );
        expect(selectRenders(shuffled, [...fixes].reverse(), max)).toEqual(
          selectRenders(pages, fixes, max),
        );
      }),
      { numRuns: 300 },
    );
  });
});
