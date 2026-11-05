/**
 * Technical SEO v2 against hand arithmetic for crawlability and the 60/40 blend, and against v1 itself
 * for the structure part, which is v1's grade by decision (SPEC 17).
 */
import { TechnicalSeoSchema } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { site, type PageSpec } from '../../../fixtures/v2/detectors/builders.js';
import { computeGrade } from '../../grade.js';
import { deriveGradeInputs, gradeInputsFrom } from '../../grade-inputs.js';
import { buildGraph } from '../../graph.js';
import { detectStructure } from '../detectors/index.js';
import type { Detection } from '../detectors/types.js';
import {
  combine,
  crawlability,
  defectivePages,
  seoParts,
  technicalSeo,
  type TechnicalSeoInput,
} from './technical-seo.js';

const PREFIX: Partial<Record<Detection['type'], string>> = {
  redirect_chain: 'redirect',
  canonical_mismatch: 'canonical',
  duplicate_pagination: 'pagination',
  hreflang_gap: 'hreflang',
  orphan_pages: 'orphan',
  deep_pages: 'depth',
  generic_anchor_text: 'anchors',
};

/**
 * A CC-16 record of `type` in `state` about `subject` (a URL, or for pagination and hreflang a
 * template or cluster), with `affected` pages.
 */
const record = (
  type: Detection['type'],
  state: Detection['state'],
  subject: string,
  affected: string[],
) => ({
  type,
  state,
  key: `${PREFIX[type]}:${subject}`,
  fingerprint: `${type}-${state}-${subject}`,
  affected_urls: affected,
});

function inputOf(
  specs: readonly PageSpec[],
  over: Partial<TechnicalSeoInput> = {},
): TechnicalSeoInput {
  const s = site(specs);
  return {
    pages: s.pages,
    edges: s.edges,
    homepage_url: s.homepage_url,
    homepage_client_rendered: false,
    detections: detectStructure(s),
    refusal: { excludedPageCount: 0, estimateSource: 'frontier', crawlTruncated: false },
    added_links: [],
    ...over,
  };
}

/** A homepage linking to `n` content pages, each linking back. */
const hub = (n: number, extra: PageSpec[] = []): PageSpec[] => [
  { path: '/', links: Array.from({ length: n }, (_, i) => `/p/${i}`) },
  ...Array.from({ length: n }, (_, i) => ({ path: `/p/${i}`, links: ['/'] })),
  ...extra,
];

describe('the 60/40 blend', () => {
  it('TS1: 0.6 × 72.5 + 40 × 0.96 = 43.5 + 38.4 = 81.90', () => {
    expect(combine(72.5, 0.96)).toBe(81.9);
  });
  it('the ends: 0.6 × 100 + 40 × 1 = 100, and 0 + 0 = 0', () => {
    expect(combine(100, 1)).toBe(100);
    expect(combine(0, 0)).toBe(0);
  });
});

describe('crawlability', () => {
  const base = inputOf(hub(4));
  const url = (i: number) => `https://a.test/x${i}`;
  const fifty = Array.from({ length: 50 }, (_, i) => ({
    ...base.pages[0]!,
    url: url(i),
    status_code: i === 0 ? 404 : 200,
  }));

  it('TS1: of 50 URLs, one answers 404 and two carry defects (one carries two), so 47 / 50 = 0.94', () => {
    const detections = [
      record('canonical_mismatch', 'detected', url(1), [url(1)]),
      record('canonical_mismatch', 'detected', url(2), [url(2)]),
      record('hreflang_gap', 'detected', url(2), [url(2)]),
      record('redirect_chain', 'not_detected', url(3), [url(4)]),
      record('hreflang_gap', 'indeterminate', url(4), [url(4)]),
    ];
    const input = { ...base, pages: fifty, detections };
    expect(defectivePages(input)).toEqual([url(1), url(2)]);
    expect(crawlability(input)).toBe(0.94);
    // 0.6 × 72.5 + 40 × 0.94 = 43.5 + 37.6
    expect(combine(72.5, 0.94)).toBe(81.1);
  });

  it('one site-wide link to a redirect costs at most one URL: the redirecting one, not the 49 linking pages', () => {
    // x0 answers 301 and is a two-hop chain; every other page links to it
    const pages = fifty.map((p, i) => (i === 0 ? { ...p, status_code: 301 } : p));
    const linking = pages.slice(1).map((p) => p.url);
    const withRecord = {
      ...base,
      pages,
      detections: [record('redirect_chain', 'detected', url(0), linking)],
    };
    const without = { ...base, pages, detections: [] };
    expect(defectivePages(withRecord)).toEqual([url(0)]);
    // the redirecting URL answers 301, so it is outside the numerator already: 49 / 50 either way
    expect(crawlability(withRecord)).toBe(0.98);
    expect(crawlability(without)).toBe(0.98);
    // a redirect URL that was not crawled costs nothing
    const uncrawled = {
      ...withRecord,
      detections: [record('redirect_chain', 'detected', 'https://a.test/gone-away', linking)],
    };
    expect(crawlability(uncrawled)).toBe(1 - 1 / 50);
  });

  it('a duplicate pagination record marks the repeated pages, an hreflang gap the incomplete members', () => {
    const input = {
      ...base,
      pages: fifty,
      detections: [
        record('duplicate_pagination', 'detected', '/blog/page/{n}', [url(5), url(6)]),
        record('hreflang_gap', 'detected', url(7), [url(8)]),
      ],
    };
    expect(defectivePages(input)).toEqual([url(5), url(6), url(8)]);
  });

  it('a URL that answers 404 and carries a defect counts once', () => {
    const input = {
      ...base,
      pages: fifty,
      detections: [record('canonical_mismatch', 'detected', url(0), [url(0)])],
    };
    expect(crawlability(input)).toBe(0.98);
  });

  it('one defective URL on a 45-page site moves Technical SEO by 40/45 = 0.89', () => {
    const pages = fifty.slice(1, 46);
    expect(pages).toHaveLength(45);
    const clean = { ...base, pages, detections: [] };
    const one = {
      ...clean,
      detections: [record('duplicate_pagination', 'detected', '/x/{n}', [url(5)])],
    };
    expect(crawlability(clean)).toBe(1);
    expect(40 * (crawlability(clean) - crawlability(one))).toBeCloseTo(40 / 45, 12);
  });

  it('a record not detected, or undecided, marks no URL; a URL not crawled counts nothing', () => {
    const input = {
      ...base,
      detections: [
        record('redirect_chain', 'not_detected', base.pages[1]!.url, []),
        record('canonical_mismatch', 'indeterminate', base.pages[1]!.url, [base.pages[1]!.url]),
        record('hreflang_gap', 'detected', 'https://elsewhere.test/', ['https://elsewhere.test/']),
      ],
    };
    expect(defectivePages(input)).toEqual([]);
    expect(crawlability(input)).toBe(1);
  });

  it('a structure record that is not a crawlability detector marks no URL', () => {
    const input = {
      ...base,
      detections: [
        record('orphan_pages', 'detected', base.pages[1]!.url, [base.pages[1]!.url]),
        record('deep_pages', 'detected', base.pages[2]!.url, [base.pages[2]!.url]),
        record('generic_anchor_text', 'detected', base.pages[3]!.url, [base.pages[3]!.url]),
      ],
    };
    expect(crawlability(input)).toBe(1);
  });

  it('a page read that declares no title, or no meta description, carries a defect (CC-12d)', () => {
    const declares = { text: 'x', chars: 1, cut: false };
    const none = { text: null, chars: 0, cut: false };
    const at = (i: number, edit: object) => ({
      ...base,
      detections: [],
      pages: base.pages.map((p, j) =>
        j === i ? { ...p, title: declares, meta_description: declares, ...edit } : p,
      ),
    });
    expect(crawlability(at(1, { title: none }))).toBe(4 / 5);
    expect(crawlability(at(1, { meta_description: none }))).toBe(4 / 5);
    expect(crawlability(at(1, {}))).toBe(1);
    // not read (null), or not a page answering 200 as HTML: no defect of this kind
    expect(crawlability(at(1, { title: null, meta_description: null }))).toBe(1);
    expect(crawlability(at(1, { title: none, is_html: false }))).toBe(1);
  });
});

describe('crawlability detectors', () => {
  it.each([
    ['redirect_chain', 'the redirecting URL, not the pages linking to it'],
    ['canonical_mismatch', 'the page'],
    ['duplicate_pagination', 'the repeated later page'],
    ['hreflang_gap', 'the member with an incomplete annotation'],
  ] as const)('a detected %s record marks %s', (type, _what) => {
    const input = inputOf(hub(4));
    const [a, b] = [input.pages[2]!.url, input.pages[3]!.url];
    // the subject is `a`; `b` is in the affected pages only for redirect chains (a linking page)
    const subject = type === 'duplicate_pagination' ? '/p/{n}' : a;
    const affected = type === 'redirect_chain' ? [b] : [a];
    expect(
      defectivePages({ ...input, detections: [record(type, 'detected', subject, affected)] }),
    ).toEqual([a]);
  });
});

describe('the grade', () => {
  it('its structure part is v1 computeGrade on the same link graph, unchanged', () => {
    const input = inputOf(hub(6, [{ path: '/orphan' }]));
    const t = technicalSeo(input);
    const graded = new Set(input.pages.map((p) => p.url));
    const graph = buildGraph(
      input.pages.map((p) => ({ url: p.url, urlHash: p.url, statusCode: p.status_code })),
      input.edges.map((e) => ({
        fromUrl: e.from_url,
        toUrl: e.to_url,
        anchorText: e.anchor_text,
        isGenericAnchor: e.is_generic_anchor,
      })),
    );
    const ga = deriveGradeInputs(graph, {
      homepageUrl: input.homepage_url,
      isGradeable: (u) => graded.has(u),
      jsRendered: false,
    });
    const v1 = computeGrade(gradeInputsFrom(ga, input.pages.length));
    expect(t.site_structure_score).toBe(v1.score);
    expect(t.breakdown).toEqual(v1.breakdown);
    expect(t.score).toBe(combine(v1.score, crawlability(input)));
    expect(TechnicalSeoSchema.safeParse(t).success).toBe(true);
  });

  it('matches v1 with the pages v1 leaves out of the grade: a 404, a 301, an archive page and a PDF', () => {
    const specs: PageSpec[] = [
      {
        path: '/',
        links: ['/p/0', '/p/1', '/p/2', '/p/3', '/p/4', '/p/5', '/gone', '/moved', '/tag/a'],
      },
      ...Array.from({ length: 6 }, (_, i) => ({ path: `/p/${i}`, links: ['/', '/tag/a'] })),
      { path: '/gone', status: 404 },
      { path: '/moved', status: 301 },
      { path: '/tag/a', kind: 'archive', links: ['/p/0', '/p/1'] },
      // the homepage links the 404 and the 301, which would hold PageRank as nodes; no page links
      // the PDF (found through the sitemap); /lonely is a graded orphan, so the size of the graded
      // population moves the orphan ratio
      { path: '/file.pdf' },
      { path: '/lonely' },
    ];
    const base = inputOf(specs);
    const input = {
      ...base,
      pages: base.pages.map((p) => (p.url.endsWith('/file.pdf') ? { ...p, is_html: false } : p)),
    };
    // v1's population, written out: the HTML content pages answering 200; its page count, the
    // pages answering 2xx or 3xx (audit.ts), which leaves out only the 404
    const gradeable = new Set(
      ['/', '/p/0', '/p/1', '/p/2', '/p/3', '/p/4', '/p/5', '/lonely'].map(
        (p) => `https://a.test${p === '/' ? '' : p}`,
      ),
    );
    // v1's SPEC 01 graph, written out: its nodes are the pages answering 200 (audit.ts), so the
    // 404 and the 301 are not nodes and the links to them drop
    const nodes = [
      '/',
      '/p/0',
      '/p/1',
      '/p/2',
      '/p/3',
      '/p/4',
      '/p/5',
      '/tag/a',
      '/file.pdf',
      '/lonely',
    ].map((p) => `https://a.test${p === '/' ? '' : p}`);
    expect(
      input.pages
        .filter((p) => !nodes.includes(p.url))
        .map((p) => p.status_code)
        .sort(),
    ).toEqual([301, 404]);
    const graph = buildGraph(
      input.pages
        .filter((p) => nodes.includes(p.url))
        .map((p) => ({ url: p.url, urlHash: p.url, statusCode: p.status_code })),
      input.edges.map((e) => ({
        fromUrl: e.from_url,
        toUrl: e.to_url,
        anchorText: e.anchor_text,
        isGenericAnchor: e.is_generic_anchor,
      })),
    );
    const ga = deriveGradeInputs(graph, {
      homepageUrl: input.homepage_url,
      isGradeable: (u) => gradeable.has(u),
      jsRendered: false,
    });
    expect(ga.gradeableCount).toBe(8);
    const v1 = computeGrade(gradeInputsFrom(ga, 11));
    const t = technicalSeo(input);
    expect(t.site_structure_score).toBe(v1.score);
    expect(t.breakdown).toEqual(v1.breakdown);
  });

  it("v1's page count is the pages answering 2xx or 3xx: it decides v1's thin-crawl cap of 60 under 5 pages", () => {
    // read before the refusal: a site this small is refused, and the cap is v1's own
    const structure = (specs: PageSpec[]) => seoParts(inputOf(specs)).structure.score;
    // three 200s and a 301 count 4, so the cap applies; the 404 does not count
    const four = structure([
      { path: '/', links: ['/p/0', '/p/1', '/moved', '/gone'] },
      { path: '/p/0', links: ['/'] },
      { path: '/p/1', links: ['/'] },
      { path: '/moved', status: 301 },
      { path: '/gone', status: 404 },
    ]);
    expect(four).toBe(60);
    // four 200s and a 301 count 5, so it does not
    const five = structure([
      { path: '/', links: ['/p/0', '/p/1', '/p/2', '/moved'] },
      { path: '/p/0', links: ['/'] },
      { path: '/p/1', links: ['/'] },
      { path: '/p/2', links: ['/'] },
      { path: '/moved', status: 301 },
    ]);
    expect(five).toBeGreaterThan(60);
  });

  it('an orphan lowers the structure part, so the grade', () => {
    const clean = technicalSeo(inputOf(hub(6)));
    const orphaned = technicalSeo(inputOf(hub(6, [{ path: '/orphan' }])));
    expect(orphaned.site_structure_score!).toBeLessThan(clean.site_structure_score!);
    expect(orphaned.score!).toBeLessThan(clean.score!);
  });

  it('only content pages are graded: four content pages and three archive pages are below the floor, by exclusion', () => {
    const archives = ['/tag/a', '/tag/b', '/tag/c'].map((path) => ({
      path,
      kind: 'archive' as const,
      links: ['/'],
    }));
    const t = technicalSeo(
      inputOf(hub(3, archives), {
        refusal: { excludedPageCount: 3, estimateSource: 'frontier', crawlTruncated: false },
      }),
    );
    // graded: '/' and /p/0..2 = 4 < 5; 4 + 3 excluded >= 5
    expect(t.refusal.triggers).toEqual(['too_few_gradeable_after_exclusion']);
  });

  it('carries the 5.1a refusal: a site of 3 pages is too small to grade, and has no score', () => {
    const t = technicalSeo(inputOf(hub(2)));
    expect(t.refusal).toMatchObject({ refused: true, triggers: ['site_too_small_to_measure'] });
    expect(t).toMatchObject({ score: null, grade: null, site_structure_score: null });
    expect(TechnicalSeoSchema.safeParse(t).success).toBe(true);
  });

  it('a truncated crawl below the floor says so instead of calling the site small', () => {
    const t = technicalSeo(
      inputOf(hub(2), {
        refusal: { excludedPageCount: 0, estimateSource: 'frontier', crawlTruncated: true },
      }),
    );
    expect(t.refusal.triggers).toEqual(['too_few_gradeable_pages']);
  });

  it('a site with no internal links observed is refused (no_observed_links)', () => {
    const t = technicalSeo(
      inputOf(Array.from({ length: 6 }, (_, i) => ({ path: i ? `/p/${i}` : '/' }))),
    );
    expect(t.refusal.triggers).toContain('no_observed_links');
    expect(t.score).toBeNull();
  });
});
