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

export interface MemberProofDeps {
  /** The caller's own client: its read of `reports` is decided by row security. */
  session: SupabaseClient;
  /** Reads the one column the caller's client is not granted, `storage_path`, by the id found. */
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

  const stored = await deps.admin
    .from('reports')
    .select('storage_path')
    .eq('id', report.id)
    .maybeSingle();
  if (stored.error) throw new Error(`reports read failed: ${stored.error.message}`);
  const path = (stored.data as { storage_path: string | null } | null)?.storage_path ?? null;
  if (path === null) return null;
  const doc = parseStoredDoc(await deps.files.read(path));
  return doc === null ? null : { accountId: report.account_id, doc };
}
