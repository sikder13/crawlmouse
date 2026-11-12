/**
 * What `POST /api/reports` reads to turn a request into a report row (CC-31 D6): the request's
 * shape, and the checks it names, read with the caller's own client so row security decides them.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ReportRequestSchema, type ReportFormat, type ReportRequest } from './generate';

/** A request for a report made from a site's checks: every kind but the prospect's one-pager. */
export type CheckReportRequest = Exclude<ReportRequest, { kind: 'prospect_one_pager' }>;

/**
 * The request a body holds, or null: not one of the route's requests, or a compare that names both
 * an earlier check and a fix (one comparison is of two checks, the other of a fix across the two
 * checks the fix decides).
 */
export function parseReportRequest(fields: unknown): ReportRequest | null {
  const parsed = ReportRequestSchema.safeParse(fields);
  if (!parsed.success) return null;
  const request = parsed.data;
  if (request.kind === 'compare' && request.previousCheckId && request.fixId) return null;
  return request;
}

/** The format of the file each kind of request makes. */
export function formatOf(request: CheckReportRequest): ReportFormat {
  switch (request.kind) {
    case 'audit_pdf':
      return 'pdf';
    case 'compare':
      return 'html';
    case 'raw_export':
      return request.format;
  }
}

const CheckRow = z.object({
  id: z.string(),
  site_id: z.string(),
  status: z.string(),
  queued_at: z.string(),
  previous_check_id: z.string().nullable(),
});
export type CheckRow = z.infer<typeof CheckRow>;

const hasResult = (c: CheckRow) => c.status === 'finished' || c.status === 'partial';

/**
 * The checks `ids` as the caller's own session reads them, in `ids`' order; null unless each is a
 * check of `siteId` with a result (finished or partial).
 */
export async function readResultChecks(
  session: SupabaseClient,
  siteId: string,
  ids: readonly string[],
): Promise<CheckRow[] | null> {
  const { data, error } = await session
    .from('checks')
    .select('id, site_id, status, queued_at, previous_check_id')
    .in('id', [...ids]);
  if (error) throw new Error(`checks read failed: ${error.message}`);
  const rows = z.array(CheckRow).parse(data ?? []);
  const found = ids.map((id) => rows.find((r) => r.id === id));
  return found.every((c): c is CheckRow => c !== undefined && c.site_id === siteId && hasResult(c))
    ? found
    : null;
}

/** `checks` with the earlier queued first. */
export const earlierFirst = (checks: readonly CheckRow[]): CheckRow[] =>
  [...checks].sort((a, b) => Date.parse(a.queued_at) - Date.parse(b.queued_at));
