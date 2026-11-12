import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { buildOgReportModel } from '../../apps/web/lib/og-report-model';
import { EXTENDED_REPORT_COLS, type PublicReportRow } from '../../apps/web/lib/report-row';
import { isReportGone } from '../../apps/web/lib/report-visibility';
import { reportCardOf, reportPageOf } from '../../apps/web/lib/v2/view/public-report';
import type { Db, Row } from './db';
import { openTarget, PRODUCTION_REF, refOfUrl } from './target';

/**
 * The every-slug sweep (CC-29 D6, Q20): reads every `public_reports` row, read-only, and passes each
 * through the code `/r/<slug>` runs with V2_CHECKS_PUBLIC on, reporting pass or fail per slug.
 *
 *   V2_CHECKS_PUBLIC=1 is set by the sweep itself, so it judges the page the flag serves.
 *   tsx scripts/db/report-slug-sweep.ts --db-url-env DB_URL
 *
 * What it reads: `slug` and the columns the report page reads (`EXTENDED_REPORT_COLS`), in one
 * `select` inside a read-only transaction. It writes nothing.
 *
 * What it runs per row: `reportPageOf`, the v2 route's own decision, which for a v2 snapshot builds
 * the view the page renders from (a value the screen cannot draw throws), and the OG card's decision
 * (`reportCardOf`, else v1's `buildOgReportModel`). A row with no v2 snapshot is handed to v1's page
 * module, which CC-29 does not change; the sweep checks that such a row reaches it, and does not
 * render v1's React tree. A hidden or taken-down report is `gone`: a 404 by design, and a pass.
 *
 * It exits non-zero when any row fails, when it reads no row at all, and on any error. It refuses
 * a database URL whose project ref is production's (`openTarget`, with no override offered).
 */

export type Outcome = 'v2' | 'v1' | 'gone' | 'error';

export interface SweepResult {
  slug: string;
  outcome: Outcome;
  /** Why a row failed. */
  error?: string;
}

/** One row, as the page would take it. */
export function sweepRow(slug: string, row: PublicReportRow): SweepResult {
  try {
    const page = reportPageOf(row);
    if (page.kind === 'v2') {
      if (reportCardOf(row) === null) throw new Error('a live v2 report drew no v2 card');
      return { slug, outcome: 'v2' };
    }
    if (page.kind === 'gone' || isReportGone(row)) return { slug, outcome: 'gone' };
    buildOgReportModel(row);
    return { slug, outcome: 'v1' };
  } catch (e) {
    return { slug, outcome: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

/** Every row of `public_reports`, by slug, read in a read-only transaction, each swept. */
export async function sweep(db: Db): Promise<SweepResult[]> {
  const rows = await db.transaction(async (tx) => {
    await tx.exec('set transaction read only');
    return tx.query<Row>(
      `select slug, ${EXTENDED_REPORT_COLS} from public.public_reports order by slug`,
    );
  });
  return rows.map(({ slug, ...row }) => sweepRow(String(slug), row as unknown as PublicReportRow));
}

/** The report, one line per slug and a count of each outcome; `failed` on any error or no row. */
export function summarise(results: SweepResult[]): { text: string; failed: boolean } {
  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  const lines = results.map(
    (r) =>
      `${r.outcome === 'error' ? 'FAIL' : 'pass'}  ${r.slug}  ${r.outcome}${r.error ? `: ${r.error}` : ''}`,
  );
  const tally = `${results.length} slugs: ${count('v2')} v2, ${count('v1')} v1 (to v1's page, not rendered here), ${count('gone')} gone (404 by design), ${count('error')} failed`;
  const failed = results.length === 0 || count('error') > 0;
  return {
    text: [...lines, tally, ...(results.length === 0 ? ['FAIL  no slug was read'] : [])].join('\n'),
    failed,
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'db-url-env': { type: 'string' } } });
  if (!values['db-url-env']) throw new Error('name the target: --db-url-env <VAR>');
  const url = process.env[values['db-url-env']];
  if (url && refOfUrl(url) === PRODUCTION_REF)
    throw new Error(`refusing to sweep production (${PRODUCTION_REF}): sweep a branch`);
  // The flag the swept page is served under; isReportGone reads it.
  process.env.V2_CHECKS_PUBLIC = '1';
  const target = openTarget({ dbUrlEnv: values['db-url-env'], yesProduction: false });
  try {
    const { text, failed } = summarise(await sweep(target.db));
    console.log(`report slug sweep on ${target.label}\n${text}`);
    if (failed) process.exitCode = 1;
  } finally {
    await target.db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
