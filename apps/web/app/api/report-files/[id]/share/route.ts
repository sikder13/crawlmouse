import { checksPublicEnabled } from '@/lib/auth/flags';
import { resolveOrigin } from '@/lib/origin';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import {
  isId,
  meantMethod,
  notFound,
  noticeTo,
  paywall,
  readBody,
  refuse,
  refuseTo,
} from '@/lib/v2/account/route';
import { readEntitlement } from '@/lib/v2/account/viewer';
import { agencyCaptureFor } from '@/lib/v2/agency/events';
import { REPORTS_PAGE, revokeShare, shareReport, type ReportToShare } from '@/lib/v2/reports/share';
import { supabaseShareStore } from '@/lib/v2/reports/share-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Links an account may make in an hour. Each replaces the report's link before it. */
const PER_ACCOUNT_HOUR = 60;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Make a report's share link (CC-31 D7): it opens the report for 30 days for whoever holds it, and
 * is answered once. A form may post `_method=DELETE` to revoke instead (`meantMethod`).
 */
export async function POST(req: Request, ctx: Context) {
  if (!checksPublicEnabled()) return notFound();
  return act(req, ctx, null);
}

/** Revoke a report's share link: it stops opening. */
export async function DELETE(req: Request, ctx: Context) {
  if (!checksPublicEnabled()) return notFound();
  return act(req, ctx, 'DELETE');
}

/**
 * Both, for a seat that covers the report's site and whose role `seat_may` lets share (the owner or
 * an account manager: docs/specs/v2/31-agency.md §3). The report is read through the caller's own
 * session, whose row policy is `is_member_for_site`: another account's report, one of a client the
 * seat does not cover and a malformed id are the same 404, decided before the service-role client is
 * made. Sharing needs the plan's `exports` gate, read from the report's own account.
 */
async function act(req: Request, { params }: Context, method: 'DELETE' | null) {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  const { id } = await params;
  if (!isId(id)) return notFound();
  const found = await sb
    .from('reports')
    .select('id, account_id, kind, format')
    .eq('id', id)
    .maybeSingle();
  if (found.error) throw new Error(`reports read failed: ${found.error.message}`);
  if (found.data === null) return notFound();
  const report = found.data as ReportToShare;

  const { data: allowed, error } = await sb.rpc('seat_may', {
    p_account: report.account_id,
    p_action: 'share_report',
  });
  if (error) throw new Error(`seat_may failed: ${error.message}`);
  if (allowed !== true) return refuseTo(req, REPORTS_PAGE, 403, 'role_refused');

  const body = await readBody(req);
  const kind = body?.kind ?? 'json';
  const verb = method ?? (body === null ? 'POST' : meantMethod(req, body).method);
  const store = supabaseShareStore(supabaseAdmin());
  const now = () => new Date();
  if (verb === 'DELETE') return revokeShare({ store, now }, report, kind);
  if (verb !== 'POST') return refuse(405, 'method_not_allowed');

  const entitlement = await readEntitlement(sb, report.account_id, now());
  if (entitlement === null) return notFound();
  if (!entitlement.gates.exports) {
    return kind === 'form'
      ? refuseTo(kind, REPORTS_PAGE, 402, 'upgrade_required')
      : paywall('exports');
  }
  const limit = await checkRateLimit(
    `share-link:account:${report.account_id}`,
    PER_ACCOUNT_HOUR,
    HOUR_MS,
    { failClosed: true },
  );
  if (!limit.allowed) {
    // A form's line says links and when the bound ends; `rate_limited`'s line is the fix mail's.
    if (kind === 'form') return noticeTo(REPORTS_PAGE, 'links_capped', limit.resetAt.toISOString());
    const seconds = Math.max(1, Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000));
    return refuse(
      429,
      'rate_limited',
      { nextAllowedAt: limit.resetAt.toISOString() },
      { 'retry-after': String(seconds) },
    );
  }
  return shareReport(
    { store, capture: agencyCaptureFor(req), now },
    { userId: user.id, origin: resolveOrigin(req) },
    report,
    kind,
  );
}
