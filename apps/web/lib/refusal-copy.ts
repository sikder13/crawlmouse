/**
 * SPEC 5.1a Stage 4 — the approved refusal copy, in ONE place.
 *
 * Two rules govern everything here, and both come straight from the approved copy:
 *
 *   1. A refusal is **never styled as an F** and never rendered with a failure colour. It is the
 *      ABSENCE of a verdict, not a bad one.
 *   2. **No next step is ever a Pro upsell.** None of the refusal triggers is solved by a bigger crawl
 *      budget, so an upsell here would be a lie.
 *
 * WHAT IS NOT HERE YET, AND WHY. The approved copy has five trigger-specific bodies —
 * `site_too_small_to_measure`, `too_few_gradeable_pages`, `no_observed_links`, the sitemap-delta
 * shape, and `nothing_read`. Selecting between them requires the trigger list, and the triggers are
 * NOT PERSISTED: `inngest/persist-results.ts` writes `score` and `grade` as NULL together, and no
 * migration adds a `refusal` column (the migration is owner-applied and deliberately sequenced LAST,
 * after the surfaces).
 *
 * The triggers are therefore not derived here from `confidence` / `fetched_ok_count` / `partial`,
 * even though those columns are available. Re-deriving the gate's decision on the read side would be
 * a second, hand-synchronised copy of `decideRefusal` — the exact defect class that made the
 * projection disagree with the grade it projects from, found only by accident. One source of truth or
 * none.
 *
 * So until the column lands, every surface says only what it can support: that no grade was given.
 * `refusalHeadline` is the single seam where the trigger-specific bodies attach — one call site to
 * change, not thirteen.
 */

/** The grade-slot label. Approved copy (f): the slot reads NO GRADE, never a dash where a letter goes. */
export const NO_GRADE_LABEL = 'No grade';

/** The uppercase form used where the surrounding type is already uppercase (the OG card, badges). */
export const NO_GRADE_LABEL_UPPER = 'NO GRADE';

/**
 * The one-line explanation shown beside a withheld verdict.
 *
 * States only what we actually established. It deliberately does NOT guess at a cause: "usually a
 * site that blocks crawlers" is a claim about the world, and on a refusal we may simply have found a
 * four-page site — asserting a reason we did not measure is the failure this stage exists to remove.
 */
export const NO_GRADE_EXPLANATION = 'We didn’t have enough evidence to publish a grade for this site.';

/**
 * Share text for a site with no verdict. Approved copy (f), minus the reason clause, which needs the
 * trigger list.
 *
 * The hard rule it enforces: **never "I scored —"**. The graded share text is first-person and proud
 * ("I scored B+/81"); a refusal must not inherit that frame, because there is no score to be proud or
 * sheepish about. It is a statement about what Crawlmouse could measure, not about the site's quality.
 */
export function noGradeShareText(domain?: string | null): string {
  const subject = domain && domain.trim() ? domain.trim() : 'this site';
  // Deliberately states ONLY what happened. An earlier draft ended "— not enough to measure yet",
  // which smuggles back the invented cause this module exists to keep out: "not enough" is one
  // trigger of four, and false for a site we read completely. It also carried a dash, and the whole
  // point of the graded/refused split is that no glyph stands in for a verdict.
  return `Crawlmouse couldn’t grade ${subject}’s internal linking.`;
}
