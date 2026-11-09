/**
 * A persisted check read back as the screens read it (CC-20b D12): FixtureDataset's collections, with
 * provenance "measured" (Q2), parsed whole with FixtureDatasetSchema's fields and that provenance.
 *
 * What it holds: the check; its site, with the client report from report_schedules; its page results,
 * link edges, access tests and changes; the site's fixes first seen by this check or a check queued
 * before it, to the millisecond, with every event of those fixes; the lineages its rows name; its
 * usage event. A fix row holds the fix's current state, so a check older than the site's latest reads
 * back its fixes as they stand now. accounts and seats are empty by design: a contract Account is
 * built from tables this reader does not read (CC-01's), and the screens take the viewer's account
 * from the viewer. alert_rules, reports, withheld and engine_derived are empty: none is a check's.
 *
 * Rows come back from the database in no order, so each collection is put in a stated one: pages by
 * URL and edges by from and to URL (the builder's orders), fixes by number (the diff's), events by
 * their fix's number then time, access tests and usage events by id, changes naming no fix first and
 * then by their fix's number, lineages with the check's own (grading) first. No column records the
 * builder's order of access tests or the diff's order of changes. A check with no earlier graded check
 * has only rows of fixes (changeRows in packages/engine/src/v2/diff/diff.ts), which come back in the
 * diff's order; a later check's crawler, robots.txt, grade and deploy rows come back by subject, user
 * agent and place, which can differ from it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { FixtureDatasetSchema, instant, type Fix } from '@crawlmouse/types/v2';
import { z } from 'zod';
import {
  accessTestFromRow,
  changeFromRow,
  checkFromRow,
  fixEventFromRow,
  fixFromRow,
  lineageFromRow,
  linkEdgeFromRow,
  pageResultFromRow,
  siteFromRow,
  usageEventFromRow,
} from './rows';
import type { CheckDataset, CheckReader, ReadTable } from './types';

const CheckDatasetSchema = FixtureDatasetSchema.extend({ provenance: z.literal('measured') });

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export async function loadCheck(read: CheckReader, checkId: string): Promise<CheckDataset> {
  const [checkRow] = await read.rows('checks', 'id', [checkId]);
  if (!checkRow) throw new Error(`loadCheck: check ${checkId} not found`);
  // Refused on the stored status before the row is parsed: a check in flight is not read back.
  if (checkRow.status !== 'finished' && checkRow.status !== 'partial')
    throw new Error(
      `loadCheck: check ${checkId} is ${String(checkRow.status)}; only a finished or partial check is read back`,
    );
  const check = checkFromRow(checkRow);
  const siteId = check.site_id;
  const [siteRows, schedules, siteChecks, pages, edges, tests, fixRows, changeRows, usageRows] =
    await Promise.all([
      read.rows('sites', 'id', [siteId]),
      read.rows('report_schedules', 'site_id', [siteId]),
      read.rows('checks', 'site_id', [siteId]),
      read.rows('page_results', 'check_id', [checkId]),
      read.rows('link_edges', 'check_id', [checkId]),
      read.rows('access_tests', 'check_id', [checkId]),
      read.rows('site_fixes', 'site_id', [siteId]),
      read.rows('changes', 'check_id', [checkId]),
      read.rows('usage_events', 'check_id', [checkId]),
    ]);
  const [siteRow] = siteRows;
  if (!siteRow) throw new Error(`loadCheck: site ${siteId} of check ${checkId} not found`);

  const until = instant(check.queued_at);
  const asOfThisCheck = new Set(
    siteChecks
      .map(checkFromRow)
      .filter((c) => instant(c.queued_at) <= until)
      .map((c) => c.id),
  );
  const fixes = fixRows
    .map(fixFromRow)
    .filter((f) => asOfThisCheck.has(f.first_seen_check_id))
    .sort((a, b) => a.number - b.number);
  const numberOf = new Map(fixRows.map(fixFromRow).map((f: Fix) => [f.id, f.number]));
  const number = (fixId: string | null) =>
    fixId === null ? -Infinity : (numberOf.get(fixId) ?? Infinity);

  const lineageIds = [
    ...new Set(
      [checkRow, ...pages, ...edges, ...tests].map((r) => r.lineage_id).filter(Boolean) as string[],
    ),
  ];
  const [eventRows, lineageRows] = await Promise.all([
    read.rows(
      'fix_events',
      'fix_id',
      fixes.map((f) => f.id),
    ),
    read.rows('measurement_lineages', 'id', lineageIds),
  ]);
  const grading = checkRow.lineage_id;

  return CheckDatasetSchema.parse({
    provenance: 'measured',
    as_of: check.finished_at,
    description: `${siteRow.host}: check ${check.id}, ${check.status} at ${check.finished_at}.`,
    engine_derived: [],
    accounts: [],
    seats: [],
    sites: [siteFromRow({ ...siteRow, report_schedules: schedules })],
    checks: [check],
    page_results: pages.map(pageResultFromRow).sort((a, b) => byText(a.url, b.url)),
    link_edges: edges
      .map(linkEdgeFromRow)
      .sort((a, b) => byText(a.from_url, b.from_url) || byText(a.to_url, b.to_url)),
    access_tests: tests.map(accessTestFromRow).sort((a, b) => byText(a.id, b.id)),
    fixes,
    fix_events: eventRows
      .map(fixEventFromRow)
      .sort(
        (a, b) =>
          number(a.fix_id) - number(b.fix_id) ||
          instant(a.at) - instant(b.at) ||
          byText(a.id, b.id),
      ),
    changes: changeRows
      .map(changeFromRow)
      .sort(
        (a, b) =>
          number(a.fix_id) - number(b.fix_id) ||
          byText(a.subject, b.subject) ||
          byText(a.ua ?? '', b.ua ?? '') ||
          byText(a.where, b.where) ||
          byText(a.id, b.id),
      ),
    alert_rules: [],
    reports: [],
    lineages: lineageRows
      .map(lineageFromRow)
      .sort((a, b) => +(b.id === grading) - +(a.id === grading) || byText(a.id, b.id)),
    usage_events: usageRows.map(usageEventFromRow).sort((a, b) => byText(a.id, b.id)),
    withheld: [],
  });
}

/** Each table's primary key: the order every page is read in, so pages neither overlap nor skip. */
const KEY: Record<ReadTable, readonly string[]> = {
  checks: ['id'],
  sites: ['id'],
  report_schedules: ['site_id'],
  accounts: ['id'],
  seats: ['id'],
  page_results: ['check_id', 'url_hash', 'check_month'],
  link_edges: ['check_id', 'from_hash', 'to_hash', 'check_month'],
  access_tests: ['id', 'check_month'],
  site_fixes: ['id'],
  fix_events: ['id'],
  changes: ['id'],
  measurement_lineages: ['id'],
  usage_events: ['id'],
};
/** Rows asked for per request. PostgREST answers at most its max-rows setting (1,000 on Supabase). */
const PAGE = 1000;
/** Values per `in` filter, which travels in the URL. */
const VALUES_PER_REQUEST = 100;

/**
 * A CheckReader over supabase-js. Each list is read page after page, in primary-key order, until a
 * page comes back empty, so a server row cap below PAGE still returns every row; the values are
 * sent VALUES_PER_REQUEST at a time. An error throws, naming the table.
 */
export function supabaseCheckReader(sb: SupabaseClient): CheckReader {
  return {
    async rows(table, column, values) {
      const out: Record<string, unknown>[] = [];
      for (let i = 0; i < values.length; i += VALUES_PER_REQUEST) {
        const chunk = values.slice(i, i + VALUES_PER_REQUEST);
        for (let from = 0; ; ) {
          let query = sb.from(table).select('*').in(column, chunk);
          for (const key of KEY[table]) query = query.order(key);
          const { data, error } = await query.range(from, from + PAGE - 1);
          if (error) throw new Error(`loadCheck: reading ${table}: ${error.code} ${error.message}`);
          if (data.length === 0) break;
          out.push(...(data as Record<string, unknown>[]));
          from += data.length;
        }
      }
      return out;
    },
  };
}
