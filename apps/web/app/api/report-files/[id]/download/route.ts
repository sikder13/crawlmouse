import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { isId, notFound, refuse } from '@/lib/v2/account/route';
import { agencyCaptureFor } from '@/lib/v2/agency/events';
import { supabaseReportBucket } from '@/lib/v2/reports/generate-run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How long the address a download is sent to works, in seconds (CC-31 D7: ten minutes). */
const SIGNED_SECONDS = 600;

/** Neither the answer nor the address it carries is kept, and the address goes to no other site. */
const PRIVATE = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } as const;

type Context = { params: Promise<{ id: string }> };

/**
 * Sends a member to a report's file (CC-31 D7): a 302 to an address in the private bucket that
 * works for ten minutes.
 *
 * In order: 404 with V2_CHECKS_PUBLIC unset; 401 signed out; 404 for an id that is not a report the
 * caller's own session reads (row security shows a report to a seat that covers its site, so
 * another account's report, an out-of-scope site's and no report at all are the same answer);
 * `is_member_for_site` asked for the report's site, 404 unless true; 409 `not_ready` unless the
 * report's file is stored. Only then does the service role read the file's path, which no client
 * may select, and sign it.
 */
export async function GET(req: Request, { params }: Context) {
  if (!checksPublicEnabled()) return notFound();
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required', {}, PRIVATE);

  const { id } = await params;
  if (!isId(id)) return notFound();
  const { data: report, error } = await sb
    .from('reports')
    .select('id, account_id, site_id, kind, format, file_state')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`reports read failed: ${error.message}`);
  if (report === null) return notFound();
  const { data: member, error: memberError } = await sb.rpc('is_member_for_site', {
    p_site: report.site_id,
  });
  if (memberError) throw new Error(`is_member_for_site failed: ${memberError.message}`);
  if (member !== true) return notFound();
  if (report.file_state !== 'stored') return refuse(409, 'not_ready', {}, PRIVATE);

  const admin = supabaseAdmin();
  const { data: file, error: fileError } = await admin
    .from('reports')
    .select('storage_path')
    .eq('id', report.id)
    .eq('file_state', 'stored')
    .maybeSingle();
  if (fileError) throw new Error(`reports path read failed: ${fileError.message}`);
  if (file === null) return refuse(409, 'not_ready', {}, PRIVATE);
  const url = await supabaseReportBucket(admin).signedUrl(
    file.storage_path as string,
    SIGNED_SECONDS,
  );
  await agencyCaptureFor(req)('report_downloaded', report.account_id, {
    kind: report.kind,
    format: report.format,
  });
  return new Response(null, { status: 302, headers: { ...PRIVATE, location: url } });
}
