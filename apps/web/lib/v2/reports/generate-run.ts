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
 * edge list, or its records as JSON; a `client_report` is a comparison's document as JSON, of the
 * check it covers or of the two it covers (`write_client_report`). A comparison lists the changes of
 * each check after the earlier one up to the later one, read here for those checks.
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

/**
 * Why a report has no file: building it threw; storing it did; or storing it did and the object
 * could not then be removed, so one may remain at the report's own name with no row naming it.
 */
export const FAIL_REASONS = ['build_failed', 'store_failed', 'object_left'] as const;
export type FailReason = (typeof FAIL_REASONS)[number];

const ReportRow = z.object({
  id: z.uuid(),
  account_id: z.uuid(),
  site_id: z.uuid(),
  kind: z.enum(['audit_pdf', 'compare', 'raw_export', 'client_report']),
  format: z.enum(['pdf', 'csv', 'json', 'edge_list', 'html']),
  covers_check_ids: z.array(z.uuid()).min(1).max(2),
  subject_fix_id: z.uuid().nullable(),
  file_state: z.enum(['pending', 'stored', 'failed']),
});
export type ReportRow = z.infer<typeof ReportRow>;

/** What a new report row holds beyond its file state. */
export type NewReport = Omit<ReportRow, 'id' | 'file_state' | 'subject_fix_id' | 'kind'> & {
  /** A client report's row is the schedule's to write (`write_client_report`), not a request's. */
  kind: Exclude<ReportRow['kind'], 'client_report'>;
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
  /** Stores the object at `path`, over one already there. */
  put(path: string, file: ReportFile): Promise<void>;
  /** Removes the object at `path`; removing one that is not there is not an error. */
  remove(path: string): Promise<void>;
  /** An address that serves the object as a download for `seconds`. */
  signedUrl(path: string, seconds: number): Promise<string>;
}

export interface GenerateDeps {
  store: Pick<ReportStore, 'report' | 'finish' | 'fail'>;
  bucket: Pick<ReportBucket, 'put' | 'remove'>;
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
    case 'compare html':
    case 'client_report html': {
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
 * Makes the file of the pending report `reportId`, stores it and marks the row stored.
 *
 * A report has one object, at `reportPath` of its own account, id and format, put over whatever is
 * there, so a second attempt writes the same name; nothing is stored under another name. For a row
 * that is not pending nothing is built or stored.
 *
 * A report's row names its object from its first write (`reports.storage_path`, set by
 * `create_report`), whatever becomes of the file, and the erasure lists a report's object by that
 * column. A report that does not come to be stored is still left without an object where that can
 * be done: the object is removed after a throw while putting it or while marking the row stored,
 * and when the row stopped being pending while the file was made. Before removing, the row is read
 * again, and the object of a row that is stored is kept (a `finish_report` that took although its
 * answer was lost, or another run that stored the same report). The row is then marked
 * `store_failed`.
 *
 * When the removal itself throws, the row is marked `object_left`: an object may remain at the
 * row's path. If the row had stopped being pending there is no state left to mark. When the row
 * cannot be read again after a throw, the object is removed all the same: a stored row whose file
 * is gone is preferred to a file left beside a row that does not say it is stored.
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
  const stored: Generated = { outcome: 'stored', bytes: bytes.length };
  /** Whether the row is now stored: null when it could not be read. */
  const named = async (): Promise<boolean | null> => {
    try {
      return (await deps.store.report(reportId))?.file_state === 'stored';
    } catch {
      return null;
    }
  };
  /** Removes the object; false when the removal threw. */
  const removed = async (): Promise<boolean> => {
    try {
      await deps.bucket.remove(path);
      return true;
    } catch {
      return false;
    }
  };

  let finished: boolean;
  try {
    await deps.bucket.put(path, { bytes, contentType: REPORT_FILES[format].contentType });
    finished = await deps.store.finish(reportId, path, bytes.length);
  } catch {
    if ((await named()) === true) return stored;
    return fail((await removed()) ? 'store_failed' : 'object_left');
  }
  if (finished) return stored;
  if ((await named()) !== true) await removed();
  return { outcome: 'not_pending' };
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
    async remove(path) {
      const { error } = await bucket().remove([path]);
      if (error) throw new Error(`reports: remove: ${error.message}`);
    },
    async signedUrl(path, seconds) {
      const { data, error } = await bucket().createSignedUrl(path, seconds, { download: true });
      if (error || !data) throw new Error(`reports: sign: ${error?.message ?? 'no address'}`);
      return data.signedUrl;
    },
  };
}
