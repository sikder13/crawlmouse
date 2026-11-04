/**
 * Technical SEO (v2): site structure 60 / crawlability 40.
 *
 *   structure    = v1's grade (packages/engine/src/grade.ts, its four components and weights unchanged)
 *                  of the link graph of the crawled pages, 0..100; also `site_structure_score`
 *   crawlability = mean over the measures that apply of the share of subjects that pass, 0..1
 *   score        = 0.6 × structure + 40 × crawlability
 *
 * The crawlability measures are: crawled URLs that answer 200; and, for each of CC-16's redirect,
 * canonical, pagination and hreflang detectors, the records decided `not_detected` of those decided.
 * A measure with nothing decided does not apply. Title and meta description facts are not recorded by
 * the crawl worker yet (CC-12d); they join as one more measure in the same mean, with no re-weighting.
 *
 * The 5.1a refusal is v1's `decideRefusal`, on the same evidence: a refused grade has no score.
 */
import type { LinkEdge, PageResult, TechnicalSeo } from '@crawlmouse/types/v2';
import { computeGrade, scoreToLetter } from '../../grade.js';
import { deriveGradeInputs, gradeInputsFrom } from '../../grade-inputs.js';
import { buildGraph } from '../../graph.js';
import { decideRefusal, type RefusalEvidence } from '../../refusal.js';
import type { Detection } from '../detectors/types.js';
import { mean, round } from './numbers.js';
import { SEO_WEIGHTS } from './weights.js';

/** The CC-16 detectors whose records are crawlability measures. */
export const CRAWLABILITY_DETECTORS = [
  'redirect_chain',
  'canonical_mismatch',
  'duplicate_pagination',
  'hreflang_gap',
] as const;

/** One crawlability measure: subjects that pass, of those decided. */
export interface Tally {
  passing: number;
  decided: number;
}

export interface TechnicalSeoInput {
  pages: readonly PageResult[];
  edges: readonly LinkEdge[];
  homepage_url: string;
  /** The homepage is served for JavaScript to fill in: v1's orphan suppression applies. */
  homepage_client_rendered: boolean;
  /** CC-16's records for this check. */
  detections: readonly Pick<Detection, 'type' | 'state'>[];
  /** Pages titled and described, of those read (CC-12d); null until the worker records them. */
  title_and_meta: Tally | null;
  /** What `decideRefusal` reads that the records do not carry. */
  refusal: Pick<RefusalEvidence, 'excludedPageCount' | 'estimateSource' | 'crawlTruncated'>;
}

/** A page is graded when it is a 200 HTML content page (v1's population). */
export const isGraded = (p: Pick<PageResult, 'kind' | 'status_code' | 'is_html'>): boolean =>
  p.kind === 'content' && p.status_code === 200 && p.is_html;

/** The crawlability measures that apply, by name, each as a share 0..1. */
export function crawlabilityMeasures(input: TechnicalSeoInput): Record<string, number> {
  const tallies: Record<string, Tally | null> = {
    answers_200: {
      passing: input.pages.filter((p) => p.status_code === 200).length,
      decided: input.pages.length,
    },
    ...Object.fromEntries(
      CRAWLABILITY_DETECTORS.map((type) => {
        const decided = input.detections.filter(
          (d) => d.type === type && d.state !== 'indeterminate',
        );
        return [
          type,
          {
            passing: decided.filter((d) => d.state === 'not_detected').length,
            decided: decided.length,
          },
        ];
      }),
    ),
    title_and_meta: input.title_and_meta,
  };
  return Object.fromEntries(
    Object.entries(tallies).flatMap(([k, t]) =>
      t && t.decided > 0 ? [[k, t.passing / t.decided]] : [],
    ),
  );
}

/** 0.6 × structure + 40 × crawlability. */
export const combine = (structure: number, crawlability: number): number =>
  round((SEO_WEIGHTS.structure / 100) * structure + SEO_WEIGHTS.crawlability * crawlability);

export function technicalSeo(input: TechnicalSeoInput): TechnicalSeo {
  const graph = buildGraph(
    input.pages.map((p) => ({ url: p.url, urlHash: p.url, statusCode: p.status_code })),
    input.edges.map((e) => ({
      fromUrl: e.from_url,
      toUrl: e.to_url,
      anchorText: e.anchor_text,
      isGenericAnchor: e.is_generic_anchor,
    })),
  );
  const graded = new Set(input.pages.filter(isGraded).map((p) => p.url));
  const ga = deriveGradeInputs(graph, {
    homepageUrl: input.homepage_url,
    isGradeable: (u) => graded.has(u),
    jsRendered: input.homepage_client_rendered,
  });
  const fetched = input.pages.filter((p) => p.status_code >= 200 && p.status_code < 400).length;
  const structure = computeGrade(gradeInputsFrom(ga, fetched));
  const refusal = decideRefusal({
    gradeablePageCount: ga.gradeableCount,
    observedEdgeCount: ga.observedEdgeCount,
    fetchedOkCount: input.pages.filter((p) => p.status_code === 200).length,
    ...input.refusal,
  });
  const measures = Object.values(crawlabilityMeasures(input));
  const score = refusal.refused ? null : combine(structure.score, mean(measures));
  return {
    score,
    grade: score === null ? null : (scoreToLetter(score) as TechnicalSeo['grade']),
    breakdown: structure.breakdown,
    refusal,
    site_structure_score: refusal.refused ? null : structure.score,
  };
}
