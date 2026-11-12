/**
 * Making a report's file (CC-31 D6): from a pending `reports` row to an object in the private
 * bucket and the row marked stored, or the row marked failed.
 *
 * `generateReport` reads the row and the records of the checks it covers with the service role, by
 * the ids on the row. A caller makes its store only for a report row it has just written for a
 * caller whose own session answered for the site (`app/api/reports/route.ts`).
 *
 * What is built, by the row's kind and format: `audit_pdf` is the audit document as a PDF; a
 * `compare` is its document as JSON (a baseline of one check, two checks before and after, or a
 * fix the later of two checks verified); a `raw_export` is the check's pages as CSV, its links as an
 * edge list, or its records as JSON. A comparison lists the changes of each check after the earlier
 * one up to the later one, read here for those checks.
 *
 * A failure is recorded as one of `FAIL_REASONS`, a word of this file's own: what was thrown is not
 * stored, logged or returned, since a view's or a parser's message can quote what was crawled.
 */
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { FixtureDatasetSchema, instant } from '@crawlmouse/types/v2';
import { z } from 'zod';
import { loadCheck } from '../pipeline/load';
import { changeFromRow, checkFromRow } from '../pipeline/rows';
import type { CheckReader } from '../pipeline/types';
import { checkJson, edgeListCsv, pagesCsv } from './csv';
import {
  REPORT_FILES,
  REPORTS_BUCKET,
  reportPath,
  type ReportDoc,
  type ReportFile,
  type ReportFormat,
} from './generate';
import {
  auditDoc,
  baselineDoc,
  compareDoc,
  fixProofDoc,
  type CheckRecords,
  type DocOptions,
} from './generate-doc';
import { renderPdf } from './pdf';

/** Why a report's file was not made: building it threw, or storing it did. */
export const FAIL_REASONS = ['build_failed', 'store_failed'] as const;
export type FailReason = (typeof FAIL_REASONS)[number];

const ReportRow = z.object({
  id: z.uuid(),
  account_id: z.uuid(),
  site_id: z.uuid(),
  kind: z.enum(['audit_pdf', 'compare', 'raw_export']),
  format: z.enum(['pdf', 'csv', 'json', 'edge_list', 'html']),
  covers_check_ids: z.array(z.uuid()).min(1).max(2),
  subject_fix_id: z.uuid().nullable(),
  file_state: z.enum(['pending', 'stored', 'failed']),
});
export type ReportRow = z.infer<typeof ReportRow>;

/** What a new report row holds beyond its file state. */
export type NewReport = Omit<ReportRow, 'id' | 'file_state' | 'subject_fix_id'> & {
  subject_fix_id?: string;
  owner_seat_id?: string;
};

export interface ReportStore {
  /**
   * Writes a pending row (`create_report`) and returns its id; null when the site, a check or the
   * fix is not the account's.
   */
  create(report: NewReport): Promise<string | null>;
  /** A report this file makes, or null: no such row, or one with no file to make. */
  report(reportId: string): Promise<ReportRow | null>;
  /** `finish_report`: false when the report was no longer pending. */
  finish(reportId: string, path: string, bytes: number): Promise<boolean>;
  fail(reportId: string, reason: FailReason): Promise<boolean>;
  /** Marks failed the account's reports pending since before `before`; how many. */
  failAbandoned(accountId: string, before: Date): Promise<number>;
}

export interface ReportBucket {
  put(path: string, file: ReportFile): Promise<void>;
  /** An address that serves the object as a download for `seconds`. */
  signedUrl(path: string, seconds: number): Promise<string>;
}

export interface GenerateDeps {
  store: Pick<ReportStore, 'report' | 'finish' | 'fail'>;
  bucket: Pick<ReportBucket, 'put'>;
  read: CheckReader;
  /** The home page's address, for a document's footer. */
  home: string;
}

export type Generated =
  | { outcome: 'stored'; bytes: number }
  | { outcome: 'failed'; reason: FailReason }
  /** The row was not pending, before or after the file was made: the row is left as it is. */
  | { outcome: 'not_pending' };

const CheckDatasetSchema = FixtureDatasetSchema.extend({ provenance: z.literal('measured') });

/**
 * A check as its audit pages read it: `loadCheck`'s records, with the site's checks queued at or
 * before it (the views look other checks up by id, and read `checks` as the site's history).
 */
async function recordsOf(read: CheckReader, checkId: string): Promise<CheckRecords> {
  const dataset = await loadCheck(read, checkId);
  const check = dataset.checks[0]!;
  const until = instant(check.queued_at);
  const checks = (await read.rows('checks', 'site_id', [check.site_id]))
    .map(checkFromRow)
    .filter((c) => instant(c.queued_at) <= until)
    .sort(
      (a, b) =>
        instant(a.queued_at) - instant(b.queued_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  return { dataset: CheckDatasetSchema.parse({ ...dataset, checks }), checkId };
}

/**
 * `after`, holding also the changes of each of its site's checks queued after `before`'s, which a
 * comparison lists; `loadCheck` reads the later check's own only.
 */
async function withChangesSince(
  read: CheckReader,
  before: CheckRecords,
  after: CheckRecords,
): Promise<CheckRecords> {
  const from = instant(before.dataset.checks.find((c) => c.id === before.checkId)!.queued_at);
  const between = after.dataset.checks
    .filter((c) => instant(c.queued_at) > from && c.id !== after.checkId)
    .map((c) => c.id);
  const earlier = (await read.rows('changes', 'check_id', between)).map(changeFromRow);
  return {
    dataset: { ...after.dataset, changes: [...earlier, ...after.dataset.changes] },
    checkId: after.checkId,
  };
}

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

async function compareDocOf(read: CheckReader, row: ReportRow, options: DocOptions) {
  const loaded = await Promise.all(row.covers_check_ids.map((id) => recordsOf(read, id)));
  if (loaded.length === 1) return baselineDoc(loaded[0]!, options);
  const queued = (r: CheckRecords) =>
    instant(r.dataset.checks.find((c) => c.id === r.checkId)!.queued_at);
  const [before, later] = loaded.sort((a, b) => queued(a) - queued(b)) as [
    CheckRecords,
    CheckRecords,
  ];
  if (row.subject_fix_id !== null) return fixProofDoc(before, later, row.subject_fix_id, options);
  return compareDoc(before, await withChangesSince(read, before, later), options);
}

/** The bytes of `row`'s file. */
async function build(read: CheckReader, row: ReportRow, options: DocOptions): Promise<Uint8Array> {
  const [checkId] = row.covers_check_ids as [string, ...string[]];
  const made = `${row.kind} ${row.format}`;
  switch (made) {
    case 'audit_pdf pdf':
      return renderPdf(auditDoc(await recordsOf(read, checkId), options));
    case 'compare html': {
      const doc: ReportDoc = await compareDocOf(read, row, options);
      return text(JSON.stringify(doc));
    }
    case 'raw_export csv':
      return text(pagesCsv(await loadCheck(read, checkId), checkId));
    case 'raw_export edge_list':
      return text(edgeListCsv(await loadCheck(read, checkId), checkId));
    case 'raw_export json':
      return text(checkJson(await loadCheck(read, checkId), checkId));
    default:
      throw new Error(`generate: no file is made for ${made}`);
  }
}

/**
 * Makes the file of the pending report `reportId`, stores it at the report's own path and marks the
 * row stored. A throw while building marks it `build_failed`; a throw while storing, `store_failed`.
 * For a row that is not pending nothing is built or stored, so a stored report's file is not
 * written again.
 */
export async function generateReport(deps: GenerateDeps, reportId: string): Promise<Generated> {
  const row = await deps.store.report(reportId);
  if (row === null || row.file_state !== 'pending') return { outcome: 'not_pending' };
  const fail = async (reason: FailReason): Promise<Generated> =>
    (await deps.store.fail(reportId, reason))
      ? { outcome: 'failed', reason }
      : { outcome: 'not_pending' };

  let bytes: Uint8Array;
  try {
    bytes = await build(deps.read, row, { home: deps.home });
  } catch {
    return fail('build_failed');
  }
  const format: ReportFormat = row.format;
  const path = reportPath(row.account_id, row.id, format);
  try {
    await deps.bucket.put(path, { bytes, contentType: REPORT_FILES[format].contentType });
    return (await deps.store.finish(reportId, path, bytes.length))
      ? { outcome: 'stored', bytes: bytes.length }
      : { outcome: 'not_pending' };
  } catch {
    return fail('store_failed');
  }
}

const REPORT_COLUMNS =
  'id, account_id, site_id, kind, format, covers_check_ids, subject_fix_id, file_state';

function failed(what: string, error: PostgrestError): never {
  throw new Error(`reports: ${what}: ${error.code} ${error.message}`);
}

/** The store over the service-role client. Its writes are the four functions of migration 031, section B. */
export function supabaseReportStore(admin: SupabaseClient): ReportStore {
  return {
    async create(report) {
      const { data, error } = await admin.rpc('create_report', { p: report });
      // P0002: the site, a check or the fix is not the account's.
      if (error?.code === 'P0002') return null;
      if (error) failed('create_report', error);
      return z.uuid().parse(data);
    },
    async report(reportId) {
      const { data, error } = await admin
        .from('reports')
        .select(REPORT_COLUMNS)
        .eq('id', reportId)
        .maybeSingle();
      if (error) failed('report read', error);
      const row = ReportRow.safeParse(data);
      return row.success ? row.data : null;
    },
    async finish(reportId, path, bytes) {
      const { data, error } = await admin.rpc('finish_report', {
        p_report: reportId,
        p_path: path,
        p_bytes: bytes,
      });
      if (error) failed('finish_report', error);
      return data === true;
    },
    async fail(reportId, reason) {
      const { data, error } = await admin.rpc('fail_report', {
        p_report: reportId,
        p_reason: reason,
      });
      if (error) failed('fail_report', error);
      return data === true;
    },
    async failAbandoned(accountId, before) {
      const { data, error } = await admin.rpc('fail_abandoned_reports', {
        p_account: accountId,
        p_before: before.toISOString(),
      });
      if (error) failed('fail_abandoned_reports', error);
      return z.number().int().parse(data);
    },
  };
}

/** The private `reports` bucket through the service-role client. A put replaces an object at the same path. */
export function supabaseReportBucket(admin: SupabaseClient): ReportBucket {
  const bucket = () => admin.storage.from(REPORTS_BUCKET);
  return {
    async put(path, file) {
      const { error } = await bucket().upload(path, file.bytes, {
        upsert: true,
        contentType: file.contentType,
      });
      if (error) throw new Error(`reports: put: ${error.message}`);
    },
    async signedUrl(path, seconds) {
      const { data, error } = await bucket().createSignedUrl(path, seconds, { download: true });
      if (error || !data) throw new Error(`reports: sign: ${error?.message ?? 'no address'}`);
      return data.signedUrl;
    },
  };
}
