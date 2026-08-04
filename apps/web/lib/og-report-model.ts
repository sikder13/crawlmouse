import type { PublicReportRow } from './reports';
import { isReportGone } from './report-visibility';
import { asNumber } from './numeric';
import { isPassingScore } from './limits';
import { whiteLabelBrandName } from './report-brand';

/**
 * SPEC 5.1a Stage 4 — SURFACE 2 of 13: the `/r/<slug>` OG card, as a PURE, TESTABLE value.
 *
 * The card is a PNG, so there is no JSON to inspect at the boundary and no way to assert on the
 * rendered image. Extracting the decision into a plain object makes the payload the image is drawn
 * from something a test can hold: this model IS the serialization boundary for an image route, and
 * asserting on it is the closest available equivalent of reading the bytes.
 *
 * WHY THIS EXISTS AT ALL. The route previously computed
 *
 *     const grade = report.grade ?? '?';
 *     const score = scoreNum != null ? scoreNum.toFixed(0) : '—';
 *
 * so a report without a verdict would have drawn a **?** at 280px in the grade slot and **— / 100**
 * beside it, in `BRAND.peach` — the failure colour, because `isPassingScore(null)` is false. Every one
 * of those is forbidden by the approved refusal copy: never a dash where a letter goes, and a refusal
 * is never styled as an F.
 *
 * That path was not reachable — `isReportGone` already returns true when the grade is null, and a
 * refused audit cannot be minted at all — but it was LOADED: the fallbacks would have started printing
 * a fabricated verdict the moment anyone loosened the gone check, onto a card that is public,
 * permanent, and cached for an hour at a URL other people paste. So the invariant is made structural
 * here rather than left resting on a gate two modules away.
 */
export type OgReportModel =
  | { kind: 'placeholder' }
  | {
      kind: 'grade';
      domain: string;
      grade: string;
      /** Already formatted for the card; a string, so no formatting decision survives into the JSX. */
      score: string;
      passing: boolean;
      /** SPEC 04 §5 — the owner's brand as the eyebrow on a white-labeled report; null → Crawlmouse. */
      brand: string | null;
    };

export function buildOgReportModel(report: PublicReportRow | null): OgReportModel {
  // Missing, taken down, hidden (§9), or ungradeable — the bare placeholder, never the grade+domain.
  // Mirrors the page's gate exactly, so the card and the page can never disagree.
  if (!report || isReportGone(report)) return { kind: 'placeholder' };

  const scoreNum = asNumber(report.score);
  // BOTH halves required. There is no honest way to draw a grade slot without a grade: any glyph in a
  // 280px letter position reads as a verdict, so the absence of one is the placeholder, not a symbol
  // standing in for one.
  if (!report.grade || scoreNum === null) return { kind: 'placeholder' };

  return {
    kind: 'grade',
    domain: report.domain,
    grade: report.grade,
    score: scoreNum.toFixed(0),
    passing: isPassingScore(scoreNum),
    brand: whiteLabelBrandName(report.white_label),
  };
}
