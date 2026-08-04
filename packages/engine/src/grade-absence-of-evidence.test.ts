import { describe, it, expect } from 'vitest';
import { computeGrade, type GradeInputs } from './grade.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a Stage 4 — THE CLASS-LEVEL RULE.
//
//     ABSENCE OF EVIDENCE MUST NEVER READ AS EVIDENCE OF QUALITY.
//
// 34 of 212 production audits (16%) were graded with ZERO observed internal links. Thirty carried
// `confidence: high` and ten received A/A−/B+/B. Eight sat at exactly 88.00, and that number is not a
// coincidence — it is what the weights produce when three of four components score full marks
// *precisely because there is nothing to measure*:
//
//   orphan ratio     40 x 1.00   A4's JS-suppression forces orphanRatio to 0
//   depth            20 x 1.00   every node is a raw orphan, so none is counted "unreachable"
//   anchor diversity 20 x 1.00   no edges => empty HHI map => mean 0 => full marks
//   structure        20 x 0.40   0.6*0 + 0.4*1 — the lone hub is the homepage, at depth 0
//                    ---------
//                    = 88.00
//
// It reached our own positioning: alynthe.com — 9 pages, 0 links, A−/88.00 at high confidence — was
// the flagship marketing example of the dual verdict. The linking half of that example is this defect.
//
// WHY THIS IS A PROPERTY TEST AND NOT A FIXTURE. Fixing the 88.00 case alone fixes an instance. The
// defect is a CLASS: every ratio-based component defaults to perfect on an empty input set, so the next
// one added inherits it silently. The rule is therefore asserted over a SWEEP of otherwise-arbitrary
// component inputs — whatever the ratios happen to say, an empty evidence set must not score near
// maximum.
//
// THE API THIS DRIVES. `computeGrade` today receives ratios that have already been computed, so it
// cannot distinguish "measured zero" from "nothing to measure" — 0/0 and 0/500 arrive identically. The
// inputs must therefore carry the DENOMINATORS, which is what these tests are written against.
// ─────────────────────────────────────────────────────────────────────────────

/** Every component at its most flattering — the values an empty graph actually produces. */
const EMPTY_GRAPH_FLATTERING: GradeInputs = {
  orphanRatio: 0,                   // suppressed, not measured
  pagesBeyondDepth3Fraction: 0,     // nothing is beyond depth 3 when nothing is reachable
  unreachableFraction: 0,
  meanAnchorHHI: 0,                 // empty map
  genericAnchorFraction: 0,
  hubConcentration: 0,
  hubReachability: 1,
  pageCount: 80,                    // well past the thin-crawl cap, so that is not what saves us
  // THE NEW SIGNAL: the evidence behind those ratios. Zero edges observed among 80 gradeable pages.
  observedEdgeCount: 0,
  gradeablePageCount: 80,
};

/** A component scoring at or above this on empty evidence is asserting quality it never measured. */
const NEAR_MAXIMUM = 0.9;

const componentsOf = (inputs: GradeInputs) => {
  const { breakdown } = computeGrade(inputs);
  return Object.entries(breakdown) as [string, number][];
};

describe('Stage 4 — absence of evidence must never read as evidence of quality', () => {
  it('scores no component near maximum when ZERO edges were observed', () => {
    // The headline case, stated as the rule rather than as the number: it is not that 88.00 is wrong,
    // it is that every one of these components is reporting a measurement it did not take.
    for (const [name, value] of componentsOf(EMPTY_GRAPH_FLATTERING)) {
      expect(value, `component ${name} on zero observed edges`).toBeLessThan(NEAR_MAXIMUM);
    }
  });

  it('holds for EVERY combination of component inputs, not just the flattering one', () => {
    // The property. The rule cannot depend on which ratios an empty graph happens to produce — a future
    // A4-style suppression, or a new component, must not be able to reintroduce this by arriving at the
    // same place from different numbers.
    const axis = [0, 0.25, 0.5, 0.75, 1];
    for (const orphanRatio of axis) {
      for (const meanAnchorHHI of axis) {
        for (const hubConcentration of axis) {
          const inputs: GradeInputs = {
            ...EMPTY_GRAPH_FLATTERING,
            orphanRatio,
            meanAnchorHHI,
            hubConcentration,
          };
          for (const [name, value] of componentsOf(inputs)) {
            expect(
              value,
              `component ${name} at orphanRatio=${orphanRatio} hhi=${meanAnchorHHI} hub=${hubConcentration}`,
            ).toBeLessThan(NEAR_MAXIMUM);
          }
        }
      }
    }
  });

  it('still scores a REAL well-linked site near maximum — the rule must not flatten everything', () => {
    // The negative control, and it is load-bearing. "No component scores high" is trivially satisfiable
    // by scoring everything zero, which would destroy the product while turning both assertions above
    // green. Identical ratios, with evidence behind them, must still earn full marks.
    const measured: GradeInputs = {
      ...EMPTY_GRAPH_FLATTERING,
      observedEdgeCount: 4200,
      gradeablePageCount: 80,
    };
    const { breakdown } = computeGrade(measured);
    expect(breakdown.orphanRatioScore).toBeGreaterThanOrEqual(NEAR_MAXIMUM);
    expect(breakdown.anchorDiversityScore).toBeGreaterThanOrEqual(NEAR_MAXIMUM);
  });

  it('does not treat a genuine zero as an absence — 0 orphans of 500 pages is a measurement', () => {
    // The distinction the denominators exist to make. A site with real edges and no orphans has EARNED
    // a perfect orphan component; a site with no edges has not. Both arrive as `orphanRatio: 0`, and
    // conflating them is the whole defect.
    const realSiteWithNoOrphans: GradeInputs = {
      ...EMPTY_GRAPH_FLATTERING,
      orphanRatio: 0,
      observedEdgeCount: 9000,
      gradeablePageCount: 500,
    };
    expect(computeGrade(realSiteWithNoOrphans).breakdown.orphanRatioScore).toBe(1);
  });
});
