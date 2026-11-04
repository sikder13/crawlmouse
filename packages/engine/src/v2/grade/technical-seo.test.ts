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
  technicalSeo,
  type TechnicalSeoInput,
} from './technical-seo.js';

const records = (type: Detection['type'], states: Partial<Record<Detection['state'], number>>) =>
  Object.entries(states).flatMap(([state, n]) =>
    Array.from({ length: n ?? 0 }, () => ({ type, state: state as Detection['state'] })),
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

  it('title and meta description facts join the same mean once recorded, with no re-weighting', () => {
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
