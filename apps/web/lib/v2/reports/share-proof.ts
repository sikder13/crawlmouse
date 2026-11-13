/**
 * What the two proof pages read (CC-31 D6b): the stored document of a proof page, for a signed-in
 * member whose seat covers its site (`/reports/[id]`), and the request's own event capture. The
 * shared page's read is `sharedProof` (share.ts).
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import { siteUrl } from '../../site-url';
import { agencyCaptureFor, type AgencyCapture } from '../agency/events';
import type { ReportDoc } from './generate';
import type { ShareFiles } from './share';
import { parseStoredDoc } from './share-doc';

/** The capture for a page's request: its cookie header carries the visitor's consent. */
export async function pageCapture(): Promise<AgencyCapture> {
  const cookie = (await headers()).get('cookie');
  return agencyCaptureFor(new Request(siteUrl('/'), { headers: cookie ? { cookie } : {} }));
}

/** A report's file, as the generator left it: the object's name and where the file stands. */
interface FileRow {
  id: string;
  storage_path: string | null;
  file_state: 'pending' | 'stored' | 'failed' | null;
}

/**
 * The file columns of each of `reportIds`. A report names its object from its first write, so the
 * name alone does not say the file is there: `file_state` does. The name is not granted to a
 * client, so the read is the service role's, by ids the caller's own session returned.
 */
async function fileRows(admin: SupabaseClient, reportIds: readonly string[]): Promise<FileRow[]> {
  if (reportIds.length === 0) return [];
  const { data, error } = await admin
    .from('reports')
    .select('id, storage_path, file_state')
    .in('id', [...reportIds]);
  if (error) throw new Error(`reports read failed: ${error.message}`);
  return (data ?? []) as FileRow[];
}

/**
 * The stored object's name of each of `rows` whose file is stored, by report id. This is the one
 * place this code asks whether a report's file is stored: `memberProof` and `reportFileStates` both
 * read it here.
 */
function storedIn(rows: readonly FileRow[]): Map<string, string> {
  const stored = new Map<string, string>();
  for (const r of rows) {
    if (r.file_state === 'stored' && r.storage_path !== null) stored.set(r.id, r.storage_path);
  }
  return stored;
}

export interface MemberProofDeps {
  /** The caller's own client: its read of `reports` is decided by row security. */
  session: SupabaseClient;
  /** Reads the stored object's name, which the caller's client is not granted, by the id found. */
  admin: SupabaseClient;
  files: ShareFiles;
}

/**
 * A proof page's document for the caller, or null. The report is found through the caller's own
 * session, so another account's report and one of a client the seat does not cover are null, as is
 * a report that is not a proof page. Only then is the stored object's name read with the service
 * role, by that report's id; a report whose document is not stored, or is not one, is null too.
 */
export async function memberProof(
  deps: MemberProofDeps,
  reportId: string,
): Promise<{ accountId: string; doc: ReportDoc } | null> {
  const found = await deps.session
    .from('reports')
    .select('id, account_id, format')
    .eq('id', reportId)
    .maybeSingle();
  if (found.error) throw new Error(`reports read failed: ${found.error.message}`);
  const report = found.data as { id: string; account_id: string; format: string } | null;
  if (report === null || report.format !== 'html') return null;

  const path = storedIn(await fileRows(deps.admin, [report.id])).get(report.id);
  if (path === undefined) return null;
  const doc = parseStoredDoc(await deps.files.read(path));
  return doc === null ? null : { accountId: report.account_id, doc };
}

/** Where a report's file stands, as the Reports screen is told it. */
type FileState = 'pending' | 'stored' | 'failed';

/**
 * The file state of each of `reports`, which the caller's own session read (so the ids are ones
 * their seat covers): the generator's `file_state`, and no entry for a report that has no file (a
 * client report that was sent). Only the state leaves this function; the object's name does not.
 */
export async function reportFileStates(
  admin: SupabaseClient,
  reports: readonly { id: string }[],
): Promise<Map<string, FileState>> {
  const rows = await fileRows(
    admin,
    reports.map((r) => r.id),
  );
  const stored = storedIn(rows);
  const states = new Map<string, FileState>();
  for (const r of rows) {
    if (stored.has(r.id)) states.set(r.id, 'stored');
    else if (r.file_state === 'pending' || r.file_state === 'failed')
      states.set(r.id, r.file_state);
  }
  return states;
}
