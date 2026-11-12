/**
 * The v2 public report (CC-29 D6, Final-Public with FACTS Part 2): what `/r/<slug>` shows of a v2
 * snapshot, made from the snapshot alone. Nothing here reads a database row; the page passes in the
 * `public_reports` row it read, and only that row's snapshot and visibility columns are used.
 *
 * Every sentence that states a count is built from the snapshot's own figures, and every crawler,
 * grade and fix comes from its arrays. A value the screen could not draw (a verdict outside the
 * vocabulary, a letter outside the scale, a grade that is withheld and also carries a letter, more
 * top fixes than fixes) throws, so the slug sweep (scripts/db/report-slug-sweep.ts) reports it.
 */
import { VerdictSchema, type Verdict } from '@crawlmouse/types/v2';
import type { PublicReportRow } from '../../report-row';
import { checksPublicEnabled } from '../../auth/flags';
import { isReportGone, reportRobotsIndex } from '../../report-visibility';
import { dateTimeUtc } from '../format';
import { isLetter, toneOf } from '../letters';
import { isV2Snapshot, type PublicSnapshotV2 } from '../reports/snapshot';
import { count, numberWord } from '../words';

export interface PublicGradeView {
  label: string;
  /** Null when withheld. */
  letter: string | null;
  score: number | null;
  withheld: boolean;
  summary: string;
  tone: 'default' | 'bad';
}

export interface PublicCrawlerView {
  ua: string;
  verdict: Verdict;
  /** "by robots.txt" for a crawler read from robots.txt and never fetched (FACTS B2); else null. */
  qualifier: string | null;
  /** "31%", or "not measured". */
  text: string;
  cause: string;
}

export interface PublicFixView {
  rank: number;
  title: string;
  scope: string | null;
  points: string;
}

export interface PublicReportView {
  host: string;
  /** When the check finished: "25 Oct 2026, 02:34 UTC". */
  checkedAt: string;
  headline: string;
  grades: PublicGradeView[];
  pages: string;
  fixesFound: string;
  crawlers: PublicCrawlerView[];
  /** The fixes Free opens; null when the check found none to show. */
  fixes: {
    heading: string;
    /** "· 11 more in the full audit" (FACTS A5), or null when every fix is shown. */
    more: string | null;
    rows: PublicFixView[];
  } | null;
  /** The closing question, naming as many crawlers as the table lists. */
  ownQuestion: string;
}

/** A crawler row whose status is robots.txt was decided from that file and never fetched. */
const NOT_FETCHED = 'robots.txt';
/** FACTS B2: the public report's cause cell for Googlebot and Bingbot allowed by robots.txt. */
const SEARCH_ENGINE_CAUSE = 'verified bot, not fetched';

function gradeView(g: PublicSnapshotV2['grades'][number]): PublicGradeView {
  if (g.withheld) {
    if (g.letter !== null || g.score !== null)
      throw new Error(`grade "${g.label}" is withheld and carries a letter or a score`);
    return { ...g, tone: 'default' };
  }
  if (g.letter === null || !isLetter(g.letter) || g.score === null)
    throw new Error(`grade "${g.label}" has no letter of the scale and a score`);
  return { ...g, tone: toneOf(g.letter) };
}

function crawlerView(c: PublicSnapshotV2['crawlers'][number]): PublicCrawlerView {
  const verdict = VerdictSchema.parse(c.verdict);
  const byRobots = c.status === NOT_FETCHED && verdict === 'allowed';
  return {
    ua: c.ua,
    verdict,
    qualifier: byRobots ? 'by robots.txt' : null,
    text: c.text,
    cause: byRobots ? SEARCH_ENGINE_CAUSE : (c.cause ?? '—'),
  };
}

function fixesView(s: PublicSnapshotV2): PublicReportView['fixes'] {
  const shown = s.topFixes.length;
  if (s.fixCount < shown)
    throw new Error(`the snapshot shows ${shown} fixes of ${s.fixCount} found`);
  if (shown === 0) return null;
  const rest = s.fixCount - shown;
  return {
    heading:
      shown === 1
        ? 'The fix with the largest estimated effect'
        : `The ${numberWord(shown)} fixes with the largest estimated effect`,
    more: rest > 0 ? `· ${count(rest)} more in the full audit` : null,
    rows: s.topFixes.map((f, i) => ({ rank: i + 1, ...f })),
  };
}

export function publicReportView(s: PublicSnapshotV2): PublicReportView {
  return {
    host: s.host,
    checkedAt: dateTimeUtc(s.checkedAt),
    headline: s.headline,
    grades: s.grades.map(gradeView),
    pages: count(s.pagesCrawled),
    fixesFound: count(s.fixCount),
    crawlers: s.crawlers.map(crawlerView),
    fixes: fixesView(s),
    ownQuestion: `Is your own site readable by these ${numberWord(s.crawlers.length)}? The fix packets come with your audit.`,
  };
}

/**
 * What the v2 report route does with a row: render the v2 report, answer 404, or hand the request to
 * v1's page, which serves every row that does not hold a v2 snapshot (a missing row included).
 */
export type ReportPage =
  | { kind: 'v1' }
  | { kind: 'gone' }
  | { kind: 'v2'; view: PublicReportView; index: boolean };

export function reportPageOf(row: PublicReportRow | null): ReportPage {
  if (row === null || !isV2Snapshot(row.report_snapshot)) return { kind: 'v1' };
  if (isReportGone(row)) return { kind: 'gone' };
  return { kind: 'v2', view: publicReportView(row.report_snapshot), index: reportRobotsIndex(row) };
}

/** The page title of a v2 report: the artboard's. */
export const publicReportTitle = (host: string) => `${host} audit — shared by Crawlmouse`;

/** The v2 OG card (`app/r/[slug]/opengraph-image.tsx`): host, the two grades, the headline. */
export interface PublicReportCard {
  host: string;
  headline: string;
  grades: { label: string; mark: string; score: string | null; tone: 'default' | 'bad' }[];
}

export function publicReportCard(s: PublicSnapshotV2): PublicReportCard {
  return {
    host: s.host,
    headline: s.headline,
    grades: s.grades
      .map(gradeView)
      .map((g) =>
        g.withheld
          ? { label: g.label, mark: 'withheld', score: null, tone: g.tone }
          : { label: g.label, mark: g.letter!, score: `${g.score} / 100`, tone: g.tone },
      ),
  };
}

/**
 * The card `/r/<slug>/opengraph-image` draws for a row: the v2 card for a live v2 report while
 * V2_CHECKS_PUBLIC is on; null for every other row, which keeps v1's card.
 */
export function reportCardOf(row: PublicReportRow | null): PublicReportCard | null {
  if (!checksPublicEnabled() || row === null || !isV2Snapshot(row.report_snapshot)) return null;
  return isReportGone(row) ? null : publicReportCard(row.report_snapshot);
}
