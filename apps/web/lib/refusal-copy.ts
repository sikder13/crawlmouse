import type { CoverageAccounting, RefusalTrigger } from '@crawlmouse/types';

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
 * THE FIVE TRIGGER-SPECIFIC BODIES LIVE HERE, AT ONE SEAM. `audits.refusal` persists the trigger list
 * (migration 20260804000001, applied 2026-08-04), so `refusalCopy` can finally select between them.
 *
 * The triggers are NOT re-derived from `confidence` / `fetched_ok_count` / `partial`, even though
 * those columns sit right beside them. Re-deriving `decideRefusal` on the read side would be a second,
 * hand-synchronised copy of the gate — the third instance of the defect class that made the projection
 * disagree with the grade it projects from. One source of truth or none.
 *
 * ONE CALL SITE, NOT THIRTEEN. Every surface that must explain a withheld verdict routes through
 * `refusalCopy`. A surface that hand-assembles its own sentence is a surface that will drift.
 *
 * EVERY NUMBER IS OMITTED RATHER THAN GUESSED. Pre-migration rows were not backfilled — `grade` is
 * null and `refusal` is null — so the no-trigger fallback stays, and any body missing its count drops
 * the clause instead of printing a zero. "We crawled all 0 pages" is worse than saying nothing.
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

// ─────────────────────────────────────────────────────────────────────────────
// The five approved bodies (SPEC 5.1a §5 (a)–(e)), verbatim, with the owner's three revisions folded
// in: "links between the pages we graded" + the conditional archive/tag clause; the floor stated as a
// NUMBER and as OUR rule; and the 403/429 → AI-crawlers-likely-blocked connection.
// ─────────────────────────────────────────────────────────────────────────────

export interface RefusalCopyInput {
  /** Every trigger that fired, from the persisted `audits.refusal`. Empty on a pre-migration row. */
  triggers: RefusalTrigger[];
  /** §7 accounting. Null on a pre-migration row, or on the v1 engine. */
  coverage?: CoverageAccounting | null;
  /** Crawl-health counts. `fetchedOk: null` means NOT INSTRUMENTED, which is not zero. */
  crawl?: { fetchedOk: number | null; blocked: number | null; discovered: number | null } | null;
  /** The audited site URL, for the reproducing curl in (e). */
  siteUrl?: string | null;
}

export interface RefusalCopy {
  headline: string;
  /** Body paragraphs, in order. Never empty. */
  body: string[];
  /** The next step, or null when there is no honest one. NEVER an upsell. */
  next: string | null;
}

/** Origin only — the curl line must not carry a path, query or credentials from the audited URL. */
function originOf(siteUrl?: string | null): string | null {
  if (!siteUrl) return null;
  try {
    return new URL(siteUrl).origin;
  } catch {
    return null;
  }
}

/**
 * True when the sitemap delta is the freepltn SHAPE — most of the declared site unreachable.
 *
 * The SAME categorical comparison D4 uses for finding severity (`unreached > reachable`), reproduced
 * here as a boolean rather than re-derived with a different rule: two thresholds for one concept is
 * how the copy and the finding would come to disagree about which is the headline.
 */
function sitemapDeltaLeads(coverage?: CoverageAccounting | null): boolean {
  if (!coverage || coverage.sitemapDeclared === null || !coverage.sitemapUnreached) return false;
  const considered = coverage.sitemapDeclared - (coverage.sitemapRobotsExcluded ?? 0);
  return coverage.sitemapUnreached > considered - coverage.sitemapUnreached;
}

/**
 * Select and fill the approved body for a withheld verdict.
 *
 * PRECEDENCE, and the reasoning for each step — several triggers routinely fire together:
 *   1. `nothing_read` — if the server returned nothing, every other trigger is a consequence.
 *   2. the sitemap-delta shape — approved copy (d) is explicit that the number outranks the refusal
 *      reason ("the number above is the more useful answer").
 *   3. below-floor (a/b) — at fewer than 5 gradeable pages, absent edges are a property of the sample.
 *   4. `no_observed_links` — pages, but nothing connecting them.
 */
export function refusalCopy(input: RefusalCopyInput): RefusalCopy {
  const { triggers, coverage, crawl } = input;
  const has = (t: RefusalTrigger) => triggers.includes(t);

  // (e) nothing_read — the server returned nothing.
  if (has('nothing_read')) {
    // NO COPY MAY DERIVE A NUMBER FROM AN INPUT THAT IS NOT THAT NUMBER.
    //
    // This line previously read `crawl?.blocked ?? coverage?.fetched` and printed the ONE value as
    // BOTH figures — "N requests, N refused" — so it asserted that every request was refused, and on
    // a fallback to `coverage.fetched` (pages SUCCESSFULLY fetched, which is 0 for this trigger) it
    // rendered "0 requests, 0 refused" on the very screen whose headline says the server refused us.
    // "0 requests" is false and contradicts its own headline: we made requests; they were refused.
    //
    // Attempted and refused are TWO DIFFERENT MEASUREMENTS. Both must be present, or the sentence is
    // omitted — omitting is honest, inventing is not.
    const attempted = crawl?.discovered ?? null;
    const refused = crawl?.blocked ?? null;
    const origin = originOf(input.siteUrl);
    const body = [
      attempted !== null && refused !== null
        ? `${attempted} ${attempted === 1 ? 'request' : 'requests'}, ${refused} refused. Nothing was read, so there is nothing to grade.`
        : 'Nothing was read, so there is nothing to grade.',
      origin
        ? `How to check: a blocking host usually returns 403 or 429 to non-browser traffic. \`curl -A "CrawlmouseBot/1.0" ${origin}\` reproduces what we saw. If that’s a WAF or bot rule, allow our user-agent and re-run.`
        : 'How to check: a blocking host usually returns 403 or 429 to non-browser traffic. If that’s a WAF or bot rule, allow our user-agent and re-run.',
      // The owner's third revision: this turns a blocked crawl from our problem into the owner's
      // information, and it is true for the same mechanical reason — declared user-agents.
      'A 403/429 to us likely means AI crawlers are blocked too — GPTBot, ClaudeBot and the rest identify themselves the same way, so the same rule usually catches them.',
    ];
    return { headline: 'Your server didn’t return a single page to us', body, next: null };
  }

  // (d) the sitemap-delta shape — the finding outranks the refusal reason.
  if (sitemapDeltaLeads(coverage)) {
    const declared = coverage!.sitemapDeclared!;
    const unreached = coverage!.sitemapUnreached!;
    const reachable = declared - (coverage!.sitemapRobotsExcluded ?? 0) - unreached;
    return {
      headline: `${unreached} of the ${declared} pages in your sitemap can’t be reached by following links`,
      body: [
        reachable === 1
          ? `Only your homepage is reachable by clicking. The other ${unreached} exist in your sitemap but nothing links to them.`
          : `Only ${reachable} pages are reachable by clicking. The other ${unreached} exist in your sitemap but nothing links to them.`,
        reachable === 1
          ? 'This is the finding, not a caveat. We’re not giving a letter because we could only reach one page — but the number above is the more useful answer.'
          : 'This is the finding, not a caveat. We’re not giving a letter because we reached too little of the site — but the number above is the more useful answer.',
      ],
      next: null,
    };
  }

  // (a) the whole site, read completely, and too small to measure.
  if (has('site_too_small_to_measure')) {
    // THE SAME CLASS RULE AS (b) AND (e), APPLIED TO THE INSTANCE IT MISSED.
    //
    // This read `coverage?.gradeable` and printed it as "We crawled all N pages". Measured on a real
    // 11-page fixture through the shipped engine: fetched 11, gradeable 3. It rendered "We crawled all
    // 3 pages — that's the whole site, not a partial read." We crawled 11. The site has 11. BOTH
    // clauses were false, inside the honesty gate, on the primary screen — an ordinary small blog with
    // archive and pagination pages is all it takes.
    //
    // THE COMPLETENESS CLAIM ITSELF IS SOUND: this trigger fires only when the crawl COMPLETED
    // (a truncated crawl takes `too_few_gradeable_pages` instead), so "that's the whole site" is
    // established by the trigger, not by an estimate. What was wrong was the NUMBER attached to it.
    // Fetched and gradeable are different measurements and are now named as themselves.
    const fetched = coverage?.fetched ?? crawl?.fetchedOk ?? null;
    const gradeable = coverage?.gradeable ?? null;
    const pagesWord = (n: number) => (n === 1 ? 'page' : 'pages');
    const opening =
      fetched !== null && gradeable !== null && gradeable !== fetched
        ? `We crawled all ${fetched} ${pagesWord(fetched)} of your site — that’s the whole site, not a partial read. ${gradeable} of them ${gradeable === 1 ? 'is a content page' : 'are content pages'} we can grade.`
        : fetched !== null
          ? `We crawled all ${fetched} ${pagesWord(fetched)} — that’s the whole site, not a partial read.`
          : 'We crawled the whole site, not a partial read.';
    return {
      headline: 'Your site is too small for an internal-linking grade',
      body: [
        opening,
        // The floor as a NUMBER and as OUR rule. "About five" inside the honesty gate reads as
        // uncertainty about our own threshold — the one thing we are entitled to be certain about.
        'Internal-link structure is a measurement across many pages: hubs, depth, orphans. Below 5 pages we don’t publish a letter — any letter would describe a handful of pages rather than a site.',
      ],
      next: 'As you add pages the structure becomes measurable — re-run then.',
    };
  }

  // (b) a larger site we barely reached. WE fell short; the site is not small.
  if (has('too_few_gradeable_pages')) {
    // THREE DISTINCT NUMBERS, NAMED SEPARATELY — which is what §7's coverage accounting exists for.
    //
    // This previously read "We reached 2 of an estimated 900 pages", where 2 was the GRADEABLE count.
    // A reader concludes the crawl fetched two pages. It fetched forty and excluded thirty-eight
    // archive/tag pages. Not false, but it invites a false count, which is the thing this spec exists
    // to prevent — so `fetched`, `gradeable` and `estimatedTotal` are each said as themselves.
    const fetched = coverage?.fetched ?? crawl?.fetchedOk ?? null;
    const gradeable = coverage?.gradeable ?? null;
    const total = coverage?.estimatedTotal ?? null;
    const pagesWord = (n: number) => (n === 1 ? 'page' : 'pages');
    const sentence =
      fetched !== null && gradeable !== null && total !== null
        ? `We fetched ${fetched} ${pagesWord(fetched)} of an estimated ${total}; only ${gradeable} ${gradeable === 1 ? 'was a content page' : 'were content pages'} we can grade.`
        : fetched !== null && gradeable !== null
          ? `We fetched ${fetched} ${pagesWord(fetched)}; only ${gradeable} ${gradeable === 1 ? 'was a content page' : 'were content pages'} we can grade.`
          : gradeable !== null
            ? `Only ${gradeable} ${pagesWord(gradeable)} we could grade — too few to measure internal-link structure.`
            : 'We reached too few pages to measure internal-link structure.';
    return {
      headline: 'We didn’t read enough of your site to grade it',
      body: [sentence],
      next: 'Re-run the audit — if it happens again, the crawl is being cut short rather than the site being small.',
    };
  }

  // (c) pages, but nothing connecting them. The finding leads.
  if (has('no_observed_links')) {
    const pages = coverage?.gradeable ?? null;
    // The archive/tag clause is TRUE ONLY when such pages were actually excluded. Asserting it on a
    // site with no archive exclusions would invent a reason — the failure this module exists to stop.
    const excludedArchiveish = (coverage?.excluded ?? []).some((e) => e.kind === 'archive' || e.kind === 'pagination');
    const body = [
      pages !== null
        ? `Across ${pages} ${pages === 1 ? 'page' : 'pages'}, we saw no internal links connecting the pages in the graded set.`
        : 'We saw no internal links connecting the pages in the graded set.',
      ...(excludedArchiveish
        ? ['Links pointing at archive or tag pages don’t count — those aren’t the pages we grade.']
        : []),
      'Usually one of two things: your navigation renders in JavaScript (we read HTML as a non-rendering crawler does), or those pages genuinely aren’t linked.',
      'This matters beyond us: AI crawlers and assistants read the same static HTML. What we couldn’t see, they can’t either.',
      'No grade follows, because every internal-linking measurement needs at least one internal link.',
    ];
    return { headline: 'We didn’t find any links between the pages we graded', body, next: null };
  }

  // No triggers: a pre-migration row, or the v1 engine. Say only what is supportable.
  return { headline: 'We couldn’t grade this site', body: [NO_GRADE_EXPLANATION], next: null };
}
