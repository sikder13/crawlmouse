import type { FixDiagnosis, FixPrescription, FreeFix, ProjectedGrade } from '@crawlmouse/types';
import type { SiteGraph } from '../graph.js';
import { computeGrade, scoreToLetter } from '../grade.js';
import { deriveGradeInputs, type DeriveGradeInputsOpts } from '../grade-inputs.js';
import { buildActionPacket } from './action-packet.js';
import type { Corpus } from './relevance.js';
import type { PrescribableFix } from './ledger.js';

/** The Lighthouse #14107 lesson, encoded: per-fix impacts overlap and must never be summed.
 *  Exported so the web layer can reconstruct ProjectedGrade.disclaimer from persisted fixes (single source). */
export const DISCLAIMER = 'Estimated, not guaranteed. Per-fix impacts are relative and do not sum.';

/** Cheap, deterministic pre-rank for the LEDGER_MAX_FIXES simulation cap (orphans usually win biggest). */
const CATEGORY_PRIORITY: Record<string, number> = {
  orphan: 0,
  under_linked_important: 1,
  deep_page: 2,
  over_optimized_anchor: 3,
  generic_anchor_overuse: 4,
};

export interface BuildConversionCoreArgs {
  baseGraph: SiteGraph;
  /** The audit's ACTUAL grade — passed in, never recomputed, so `current` always matches the display. */
  current: { score: number; grade: string };
  analysisOpts: DeriveGradeInputsOpts;
  pageCount: number;
  corpus: Corpus;
  fixes: PrescribableFix[];
  freeFixCount: number;
  maxFixes: number;
}

export interface ConversionCore {
  projectedGrade: ProjectedGrade;
  prescriptions: FixPrescription[];
  freeFix: FreeFix | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const byIdAsc = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Clone the base graph and add each suggested edge. `.copy()` shares existing attribute objects by
 * reference, which is SAFE here: we only READ existing attrs and ADD new edges (never mutate an
 * existing attr object). Adding an inbound edge auto-clears the orphan + reduces depth on recompute.
 */
function withFixes(base: SiteGraph, fixes: PrescribableFix[]): SiteGraph {
  const g = base.copy() as SiteGraph;
  for (const fix of fixes) {
    for (const s of fix.suggestedLinks) {
      if (g.hasNode(s.fromUrl) && g.hasNode(fix.targetUrl) && !g.hasEdge(s.fromUrl, fix.targetUrl)) {
        g.addDirectedEdge(s.fromUrl, fix.targetUrl, { anchorText: s.anchorText, isGenericAnchor: false });
      }
    }
  }
  return g;
}

/** Re-grade a (simulated) graph through the SAME derivation + computeGrade as the base grade. */
function gradeScore(graph: SiteGraph, opts: DeriveGradeInputsOpts, pageCount: number): number {
  const ga = deriveGradeInputs(graph, opts);
  return computeGrade({
    orphanRatio: ga.orphanRatio,
    pagesBeyondDepth3Fraction: ga.pagesBeyondDepth3Fraction,
    unreachableFraction: ga.unreachableFraction,
    meanAnchorHHI: ga.meanAnchorHHI,
    genericAnchorFraction: ga.genericAnchorFraction,
    hubConcentration: ga.hubConcentration,
    hubReachability: ga.hubReachability,
    pageCount,
  }).score;
}

/**
 * §3 projection + §4 free-fix. Caps the simulated set; computes `projected` by ONE re-grade of the
 * all-fixes graph (order-independent); computes each per-fix `marginalDelta` as the grade delta of
 * applying THAT fix alone to the base — explicitly NOT summed; sorts the ledger by (marginalDelta
 * desc, id asc); builds a deterministic action-packet per prescription; and selects the rank-1
 * prescribable fix as the free cure. Deterministic + pure (no network, no LLM).
 */
export function buildConversionCore(args: BuildConversionCoreArgs): ConversionCore {
  const { baseGraph, current, analysisOpts, pageCount, corpus, fixes, freeFixCount, maxFixes } = args;

  // Cap which fixes are SIMULATED (each marginal delta is a clone + re-grade) via a cheap pre-rank by
  // CATEGORY_PRIORITY (orphans usually carry the biggest gains). BOUNDED-HEURISTIC TRADE-OFF: on a site
  // with > maxFixes (default 50) fixes, a high-delta fix in a lower-priority category can be excluded
  // from BOTH the simulation and the ledger — accepted because orphans dominate real sites and almost
  // every site has < 50 fixes; the projected grade is therefore over the top-N highest-leverage fixes.
  const capped = [...fixes]
    .sort((a, b) => (CATEGORY_PRIORITY[a.category] ?? 99) - (CATEGORY_PRIORITY[b.category] ?? 99) || byIdAsc(a.id, b.id))
    .slice(0, maxFixes);

  // Projected: a SINGLE re-grade of the graph with ALL capped fixes applied.
  const projectedScore = gradeScore(withFixes(baseGraph, capped), analysisOpts, pageCount);

  // Per-fix marginal delta: apply ONLY that fix to the base, re-grade, diff. (Advisory w/ no links → 0.)
  const withDelta = capped.map((fix) => ({
    fix,
    marginalDelta: round2((fix.suggestedLinks.length === 0 ? current.score : gradeScore(withFixes(baseGraph, [fix]), analysisOpts, pageCount)) - current.score),
  }));
  withDelta.sort((a, b) => b.marginalDelta - a.marginalDelta || byIdAsc(a.fix.id, b.fix.id));

  const ledger: FixDiagnosis[] = withDelta.map(({ fix, marginalDelta }) => ({
    id: fix.id,
    category: fix.category,
    targetUrl: fix.targetUrl,
    targetTitle: fix.targetTitle,
    marginalDelta,
    effort: fix.effort,
    rationale: fix.rationale,
  }));

  const prescriptions: FixPrescription[] = withDelta
    .filter(({ fix }) => fix.suggestedLinks.length > 0)
    .map(({ fix }) => ({
      fixId: fix.id,
      suggestedLinks: fix.suggestedLinks,
      actionPacket: buildActionPacket({
        fixId: fix.id,
        targetUrl: fix.targetUrl,
        targetTitle: fix.targetTitle,
        suggestedLinks: fix.suggestedLinks,
        sharedTopicsPerLink: fix.suggestedLinks.map((s) => corpus.sharedTopics(s.fromUrl, fix.targetUrl, 3)),
      }),
    }));

  // Free fix: the highest-marginal-delta prescribable fix (FREE_FIX_COUNT default 1). On a very large
  // graph the top delta can be <= 0 (the orphan inbound-link gain outweighed by pagerank/structure
  // shifts from the added edges) — accepted: the fix still improves discoverability beyond the composite
  // score, and the ledger disclaimer states impacts are relative + non-additive. Normal sites top out positive.
  let freeFix: FreeFix | null = null;
  const topPrescribable = withDelta.find(({ fix }) => fix.suggestedLinks.length > 0);
  if (freeFixCount > 0 && topPrescribable) {
    const diagnosis = ledger.find((f) => f.id === topPrescribable.fix.id)!;
    const prescription = prescriptions.find((p) => p.fixId === topPrescribable.fix.id)!;
    freeFix = { diagnosis, prescription, rank: ledger.findIndex((f) => f.id === topPrescribable.fix.id) + 1 };
  }

  return {
    projectedGrade: {
      current: { score: current.score, grade: current.grade },
      projected: { score: projectedScore, grade: scoreToLetter(projectedScore) },
      ledger,
      disclaimer: DISCLAIMER,
    },
    prescriptions,
    freeFix,
  };
}
