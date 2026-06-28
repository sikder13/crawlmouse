import { describe, it, expect } from 'vitest';
import { buildGraph, type SiteGraph } from '../graph.js';
import { hashUrl } from '../url-canonical.js';
import { deriveGradeInputs } from '../grade-inputs.js';
import { computeGrade } from '../grade.js';
import { buildCorpus } from './relevance.js';
import { enumerateFixes } from './ledger.js';
import { buildConversionCore } from './projection.js';
import type { CrawledPage, CrawledLink } from '../crawler.js';

const HOME = 'https://ex.com';
const opts = { homepageUrl: HOME, isExcluded: () => false, jsRendered: false };

function page(url: string, title?: string): CrawledPage {
  return { url, urlHash: hashUrl(url), title, statusCode: 200 };
}
function link(fromUrl: string, toUrl: string, anchorText = 'a descriptive internal anchor'): CrawledLink {
  return { fromUrl, toUrl, anchorText, isGenericAnchor: false };
}
function gradeOf(graph: SiteGraph, pageCount: number) {
  const ga = deriveGradeInputs(graph, opts);
  const g = computeGrade({
    orphanRatio: ga.orphanRatio,
    pagesBeyondDepth3Fraction: ga.pagesBeyondDepth3Fraction,
    unreachableFraction: ga.unreachableFraction,
    meanAnchorHHI: ga.meanAnchorHHI,
    genericAnchorFraction: ga.genericAnchorFraction,
    hubConcentration: ga.hubConcentration,
    hubReachability: ga.hubReachability,
    pageCount,
  });
  return { score: g.score, grade: g.grade };
}

// A reachable SEO hub + several on-topic ORPHANS (no inbound) → multiple prescribable orphan fixes.
const pages = [
  page(HOME, 'SEO Hub Home'),
  page(`${HOME}/p1`, 'SEO Internal Linking'),
  page(`${HOME}/p2`, 'SEO Site Audit'),
  page(`${HOME}/p3`, 'SEO Keyword Research'),
  page(`${HOME}/orphan-1`, 'SEO Anchor Text Guide'),
  page(`${HOME}/orphan-2`, 'SEO Crawl Budget Guide'),
  page(`${HOME}/orphan-3`, 'SEO Redirect Guide'),
];
const links = [
  link(HOME, `${HOME}/p1`, 'seo internal linking'),
  link(HOME, `${HOME}/p2`, 'seo site audit'),
  link(HOME, `${HOME}/p3`, 'seo keyword research'),
  link(`${HOME}/p1`, `${HOME}/p2`, 'site audit'),
  link(`${HOME}/p2`, `${HOME}/p3`, 'keyword research'),
];
const PAGE_COUNT = pages.length;

function build() {
  const graph = buildGraph(pages, links);
  const ga = deriveGradeInputs(graph, opts);
  const corpus = buildCorpus(graph);
  const fixes = enumerateFixes(graph, ga, { homepageUrl: HOME, isExcluded: opts.isExcluded, corpus, linksPerFix: 3 });
  return buildConversionCore({
    baseGraph: graph,
    current: gradeOf(graph, PAGE_COUNT),
    analysisOpts: opts,
    pageCount: PAGE_COUNT,
    corpus,
    fixes,
    freeFixCount: 1,
    maxFixes: 50,
  });
}

/** Re-apply a result's prescriptions to a fresh base graph (target resolved via the ledger). */
function applyAll(result: ReturnType<typeof build>): SiteGraph {
  const g = buildGraph(pages, links);
  const targetById = new Map(result.projectedGrade.ledger.map((f) => [f.id, f.targetUrl]));
  for (const presc of result.prescriptions) {
    const target = targetById.get(presc.fixId)!;
    for (const s of presc.suggestedLinks)
      if (!g.hasEdge(s.fromUrl, target)) g.addDirectedEdge(s.fromUrl, target, { anchorText: s.anchorText, isGenericAnchor: false });
  }
  return g;
}

describe('buildConversionCore (§3 projection + §4 free-fix)', () => {
  it('computes projected by a SINGLE re-grade of the all-fixes graph, NOT by summing marginal deltas', () => {
    const result = build();
    expect(result.projectedGrade.ledger.length).toBeGreaterThanOrEqual(2);

    // Independent re-grade of the fully-fixed graph matches projected exactly (single recompute).
    expect(result.projectedGrade.projected.score).toBe(gradeOf(applyAll(result), PAGE_COUNT).score);

    // Non-additivity: the projected gain is NOT the arithmetic sum of per-fix marginal deltas.
    const sumDeltas = result.projectedGrade.ledger.reduce((a, f) => a + f.marginalDelta, 0);
    const projectedGain = result.projectedGrade.projected.score - result.projectedGrade.current.score;
    expect(Number(sumDeltas.toFixed(2))).not.toBe(Number(projectedGain.toFixed(2)));
  });

  it('carries the exact non-additivity disclaimer', () => {
    expect(build().projectedGrade.disclaimer).toBe(
      'Estimated, not guaranteed. Per-fix impacts are relative and do not sum.',
    );
  });

  it('each marginalDelta is the grade delta of applying THAT fix alone to the base graph', () => {
    const result = build();
    const top = result.projectedGrade.ledger[0]!;
    const presc = result.prescriptions.find((p) => p.fixId === top.id)!;
    const solo = buildGraph(pages, links);
    for (const s of presc.suggestedLinks)
      if (!solo.hasEdge(s.fromUrl, top.targetUrl)) solo.addDirectedEdge(s.fromUrl, top.targetUrl, { anchorText: s.anchorText, isGenericAnchor: false });
    const expected = Number((gradeOf(solo, PAGE_COUNT).score - result.projectedGrade.current.score).toFixed(2));
    expect(top.marginalDelta).toBe(expected);
  });

  it('sorts the ledger by marginalDelta desc and selects a deterministic, complete rank-1 free fix', () => {
    const result = build();
    const deltas = result.projectedGrade.ledger.map((f) => f.marginalDelta);
    expect([...deltas].sort((a, b) => b - a)).toEqual(deltas);

    expect(result.freeFix).not.toBeNull();
    expect(result.freeFix!.rank).toBe(1);
    expect(result.freeFix!.prescription.suggestedLinks.length).toBeGreaterThan(0);
    expect(result.freeFix!.prescription.actionPacket.body.length).toBeGreaterThan(0);
    expect(result.freeFix!.diagnosis.id).toBe(result.projectedGrade.ledger[0]!.id);
  });

  it('is deterministic: identical input → identical projection', () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it('returns a null free fix + empty ledger + projected==current when there are no prescribable fixes', () => {
    const g = buildGraph([page(HOME, 'Only')], []);
    const current = gradeOf(g, 1);
    const r = buildConversionCore({
      baseGraph: g, current, analysisOpts: opts, pageCount: 1, corpus: buildCorpus(g), fixes: [], freeFixCount: 1, maxFixes: 50,
    });
    expect(r.freeFix).toBeNull();
    expect(r.projectedGrade.ledger).toEqual([]);
    expect(r.projectedGrade.projected.score).toBe(current.score);
  });
});
