/**
 * The v2 public report's snapshot (CC-29 D6): what `/r/<slug>` shows of a finished check, built once
 * at mint and stored in `public_reports.report_snapshot`. The page renders from it alone, so a report
 * says what the check said on the day it was shared, whatever happens to the account afterwards
 * (OPERATING-RULES §5, minted public-report immutability).
 *
 * This module is the stored shape and its guard, light enough for v1's report code to import; the
 * builder is `build-snapshot.ts`.
 */
import { z } from 'zod';

const Text = z.string().min(1);
const Timestamp = z.iso.datetime();

const GradeSnapshotSchema = z.strictObject({
  label: Text,
  letter: Text.nullable(),
  score: z.number().min(0).max(100).nullable(),
  withheld: z.boolean(),
  summary: Text,
});

const CrawlerSnapshotSchema = z.strictObject({
  ua: Text,
  group: Text,
  scored: z.boolean(),
  verdict: Text,
  /** The status that decided the verdict, or "robots.txt". */
  status: Text,
  /** "31%", or "not measured". */
  text: Text,
  /** What the engine found in the way, in words; null when nothing was. */
  cause: Text.nullable(),
});

const FixSnapshotSchema = z.strictObject({
  title: Text,
  /** "158 pages" for a fix to a whole template whose title does not count them; else null. */
  scope: Text.nullable(),
  /** The estimated effect, as the overview prints it ("+4 SEO"). */
  points: Text,
});

export const PublicSnapshotV2Schema = z.strictObject({
  version: z.literal(2),
  host: Text,
  checkedAt: Timestamp,
  mintedAt: Timestamp,
  /** One sentence per way crawlers were kept out, then the template sentence; built from the data. */
  headline: Text,
  /** Technical SEO, then AI readability, as the overview shows them. */
  grades: z.tuple([GradeSnapshotSchema, GradeSnapshotSchema]),
  pagesCrawled: z.number().int().min(0),
  /** Every live fix the check found. */
  fixCount: z.number().int().min(0),
  crawlers: z.array(CrawlerSnapshotSchema),
  /** The fixes Free opens, largest effect first: titles and effects only. */
  topFixes: z.array(FixSnapshotSchema).max(3),
});

export type PublicSnapshotV2 = z.infer<typeof PublicSnapshotV2Schema>;

/** Whether a stored snapshot is a v2 one; v1's snapshots carry no `version` of 2. */
export function isV2Snapshot(stored: unknown): stored is PublicSnapshotV2 {
  return PublicSnapshotV2Schema.safeParse(stored).success;
}
