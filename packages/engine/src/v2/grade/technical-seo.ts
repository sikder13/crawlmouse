/**
 * Technical SEO (v2): site structure 60 / crawlability 40.
 *
 *   structure    = v1's grade (packages/engine/src/grade.ts, its four components and weights unchanged)
 *                  of the link graph of the crawled pages answering 200 (structureOf), 0..100;
 *                  also `site_structure_score`
 *   crawlability = crawled URLs that answer 200 and carry no crawlability defect / crawled URLs, 0..1
 *   score        = 0.6 × structure + 40 × crawlability
 *
 * A crawlability defect is counted on the URL that carries it (owner rulings, 2026-11-05):
 *   - a detected CC-16 record marks the URLs it is about (`defectUrls`): a redirect chain the
 *     redirecting URL, a canonical mismatch the page, duplicate pagination the repeated later pages,
 *     an hreflang gap the cluster members whose annotations are incomplete. The pages linking to a
 *     redirect stay in the record's `affected_urls` for the fix, but carry no defect, so one
 *     site-wide link to a redirect costs at most one URL;
 *   - a page answering 200 that was read and declares no title, or no meta description (CC-12d's
 *     page facts), carries a defect;
 *   - a URL that does not answer 200 is outside the numerator: the denominator is every crawled URL.
 * A URL counts once however many defects it carries, so one defective URL on a 45-page site moves the
 * score by 40/45. A record that could not decide marks no URL, so its URLs count clean (this module's
 * reading; the old mean dropped such a measure).
 *
 * The 5.1a refusal is v1's `decideRefusal`, on the same evidence: a refused grade has no score.
 */
import type { LinkEdge, PageResult, TechnicalSeo } from '@crawlmouse/types/v2';
import { computeGrade, scoreToLetter } from '../../grade.js';
import { deriveGradeInputs, gradeInputsFrom } from '../../grade-inputs.js';
import { buildGraph } from '../../graph.js';
import { decideRefusal, type RefusalEvidence } from '../../refusal.js';
import { subjectOfKey } from '../detectors/fingerprint.js';
import type { Detection } from '../detectors/types.js';
import { round } from './numbers.js';
import { SEO_WEIGHTS } from './weights.js';

/** The CC-16 detectors whose records are crawlability measures. */
export const CRAWLABILITY_DETECTORS = [
  'redirect_chain',
  'canonical_mismatch',
  'duplicate_pagination',
  'hreflang_gap',
] as const;

export interface TechnicalSeoInput {
  pages: readonly PageResult[];
  edges: readonly LinkEdge[];
  homepage_url: string;
  /** The homepage is served for JavaScript to fill in: v1's orphan suppression applies. */
  homepage_client_rendered: boolean;
  /** CC-16's records for this check. */
  detections: readonly Pick<
    Detection,
    'type' | 'state' | 'fingerprint' | 'key' | 'affected_urls'
  >[];
  /** What `decideRefusal` reads that the records do not carry. */
  refusal: Pick<RefusalEvidence, 'excludedPageCount' | 'estimateSource' | 'crawlTruncated'>;
  /**
   * Links a fix's counterfactual added (effects.ts), as `from\u0000to`. They count toward orphans,
   * depth and hubs but not toward anchor diversity: the fix prescribes a link, not its text.
   */
  added_links: readonly string[];
}

/** A page is graded when it is a 200 HTML content page (v1's population). */
export const isGraded = (p: Pick<PageResult, 'kind' | 'status_code' | 'is_html'>): boolean =>
  p.kind === 'content' && p.status_code === 200 && p.is_html;

/**
 * The URLs a detected crawlability record is about: the redirecting URL and the page with the wrong
 * canonical are the record's subject (its key); a pagination or hreflang record's subject is a
 * template or a cluster, so the URLs are its affected pages, which are the repeated pages and the
 * members with an incomplete annotation.
 */
export function defectUrls(d: Pick<Detection, 'type' | 'key' | 'affected_urls'>): string[] {
  switch (d.type) {
    case 'redirect_chain':
    case 'canonical_mismatch':
      return [subjectOfKey(d.key)];
    case 'duplicate_pagination':
    case 'hreflang_gap':
      return [...d.affected_urls];
    default:
      return [];
  }
}

/** A page answering 200 that was read and declares no title or no meta description (CC-12d). */
export const lacksTitleOrDescription = (
  p: Pick<PageResult, 'status_code' | 'is_html' | 'title' | 'meta_description'>,
): boolean =>
  p.status_code === 200 &&
  p.is_html &&
  ((p.title !== null && p.title.text === null) ||
    (p.meta_description !== null && p.meta_description.text === null));

/** The crawled URLs that carry a crawlability defect, each once, sorted. */
export function defectivePages(input: TechnicalSeoInput): string[] {
  const types: readonly string[] = CRAWLABILITY_DETECTORS;
  const marked = new Set(input.pages.filter(lacksTitleOrDescription).map((p) => p.url));
  for (const d of input.detections) {
    if (d.state === 'detected' && types.includes(d.type))
      for (const u of defectUrls(d)) marked.add(u);
  }
  return input.pages.flatMap((p) => (marked.has(p.url) ? [p.url] : [])).sort();
}

/** Crawled URLs that answer 200 and carry no crawlability defect, of the crawled URLs; 1 with none. */
export function crawlability(input: TechnicalSeoInput): number {
  if (input.pages.length === 0) return 1;
  const defective = new Set(defectivePages(input));
  const clean = input.pages.filter((p) => p.status_code === 200 && !defective.has(p.url));
  return clean.length / input.pages.length;
}

/** 0.6 × structure + 40 × crawlability. */
export const combine = (structure: number, crawlability: number): number =>
  round((SEO_WEIGHTS.structure / 100) * structure + SEO_WEIGHTS.crawlability * crawlability);

/**
 * The structure grade (v1's) and the evidence the refusal reads, from the link graph. The graph's
 * nodes are the pages answering 200, as on v1's SPEC 01 path (audit.ts analyzeCrawl with v2 set):
 * a 404 or a redirect is a crawl outcome, not a node, so it neither holds PageRank nor counts as a
 * page; links to or from it drop out of the graph. The graded population within it is `isGraded`.
 */
function structureOf(input: TechnicalSeoInput) {
  const graded = new Set(input.pages.filter(isGraded).map((p) => p.url));
  const nodes = input.pages.filter((p) => p.status_code === 200);
  const analyse = (edges: readonly LinkEdge[]) =>
    deriveGradeInputs(
      buildGraph(
        nodes.map((p) => ({ url: p.url, urlHash: p.url, statusCode: p.status_code })),
        edges.map((e) => ({
          fromUrl: e.from_url,
          toUrl: e.to_url,
          anchorText: e.anchor_text,
          isGenericAnchor: e.is_generic_anchor,
        })),
      ),
      {
        homepageUrl: input.homepage_url,
        isGradeable: (u) => graded.has(u),
        jsRendered: input.homepage_client_rendered,
      },
    );
  const ga = analyse(input.edges);
  const added = new Set(input.added_links);
  const anchors =
    added.size === 0
      ? ga
      : analyse(input.edges.filter((e) => !added.has(`${e.from_url}\u0000${e.to_url}`)));
  const fetched = input.pages.filter((p) => p.status_code >= 200 && p.status_code < 400).length;
  const inputs = {
    ...gradeInputsFrom(ga, fetched),
    meanAnchorHHI: anchors.meanAnchorHHI,
    genericAnchorFraction: anchors.genericAnchorFraction,
  };
  return { ga, grade: computeGrade(inputs) };
}

/** The grade's formula value and refusal, from one link graph: what technicalSeo and effects.ts read. */
export function seoParts(input: TechnicalSeoInput) {
  const { ga, grade: structure } = structureOf(input);
  const refusal = decideRefusal({
    gradeablePageCount: ga.gradeableCount,
    observedEdgeCount: ga.observedEdgeCount,
    fetchedOkCount: input.pages.filter((p) => p.status_code === 200).length,
    ...input.refusal,
  });
  const formula = combine(structure.score, crawlability(input));
  return { structure, refusal, formula };
}

export function technicalSeo(input: TechnicalSeoInput): TechnicalSeo {
  const { structure, refusal, formula } = seoParts(input);
  const score = refusal.refused ? null : formula;
  return {
    score,
    grade: score === null ? null : (scoreToLetter(score) as TechnicalSeo['grade']),
    breakdown: structure.breakdown,
    refusal,
    site_structure_score: refusal.refused ? null : structure.score,
  };
}
