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
  crawlabilityMeasures,
  seoParts,
  technicalSeo,
  type TechnicalSeoInput,
} from './technical-seo.js';

const records = (type: Detection['type'], states: Partial<Record<Detection['state'], number>>) =>
  Object.entries(states).flatMap(([state, n]) =>
    Array.from({ length: n ?? 0 }, (_, i) => ({
      type,
      state: state as Detection['state'],
      fingerprint: `${type}-${state}-${i}`,
    })),
  );

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
    title_and_meta: null,
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

  it('TS1 measures: 49 of 50 URLs answer 200 (0.98), 9 of 10 link targets in one hop (0.9), 5 of 5 canonicals (1.0)', () => {
    const pages = Array.from({ length: 50 }, (_, i) => ({
      ...base.pages[0]!,
      url: `https://a.test/x${i}`,
      status_code: i === 0 ? 404 : 200,
    }));
    const detections = [
      ...records('redirect_chain', { not_detected: 9, detected: 1 }),
      ...records('canonical_mismatch', { not_detected: 5 }),
      ...records('hreflang_gap', { indeterminate: 2 }),
    ];
    const m = crawlabilityMeasures({ ...base, pages, detections });
    expect(m).toEqual({ answers_200: 0.98, redirect_chain: 0.9, canonical_mismatch: 1 });
    // mean (0.98 + 0.9 + 1.0)/3 = 0.96, the K of TS1
  });

  it('an indeterminate record decides nothing, and a detector with nothing decided does not apply', () => {
    const m = crawlabilityMeasures({
      ...base,
      detections: records('duplicate_pagination', { indeterminate: 3 }),
    });
    expect(Object.keys(m)).toEqual(['answers_200']);
  });

  it('title and meta description facts join the same mean once recorded, as one more equal measure', () => {
    const m = crawlabilityMeasures({
      ...base,
      detections: [],
      title_and_meta: { passing: 1, decided: 2 },
    });
    expect(m).toEqual({ answers_200: 1, title_and_meta: 0.5 });
  });
});

describe('crawlability detectors', () => {
  it.each([
    'redirect_chain',
    'canonical_mismatch',
    'duplicate_pagination',
    'hreflang_gap',
  ] as const)('%s records are a measure: one detected of two decided is 0.5', (type) => {
    const m = crawlabilityMeasures({
      ...inputOf(hub(4)),
      detections: records(type, { detected: 1, not_detected: 1 }),
    });
    expect(m[type]).toBe(0.5);
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
    expect(t.score).toBe(
      combine(
        v1.score,
        Object.values(crawlabilityMeasures(input)).reduce((a, b) => a + b, 0) /
          Object.keys(crawlabilityMeasures(input)).length,
      ),
    );
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
