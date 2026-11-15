import { NextResponse } from 'next/server';
import { captureServerEvent, visitorDistinctId } from '@/lib/analytics-server';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { getClientIp } from '@/lib/client-ip';
import { REPORT_VIEWS_PER_IP_PER_HOUR } from '@/lib/limits';
import { checkRateLimit } from '@/lib/rate-limit';
import { isReportGoneEitherKind } from '@/lib/report-visibility';
import { getPublicReport } from '@/lib/reports';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isV2Snapshot } from '@/lib/v2/reports/snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
/** A report slug's characters (`newReportSlug`, and the rewrite's `:slug`). */
const SLUG = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * One view of a shared report (CC-29 Q14), posted by the report page's beacon, because the page is
 * cached and cannot count a view as it renders. A 404 with V2_CHECKS_PUBLIC off. Each call costs the
 * caller's per-IP bucket; a live report answers 204 and sends one `report_viewed {kind}` through
 * `captureServerEvent`, which sends it only when the request's cookies allow it. A gone, missing or
 * malformed report is a 404, with no event.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!checksPublicEnabled()) return new Response(null, { status: 404 });
  const { slug } = await params;
  if (!SLUG.test(slug)) return new Response(null, { status: 404 });

  const rl = await checkRateLimit(
    `report-view:ip:${getClientIp(req)}`,
    REPORT_VIEWS_PER_IP_PER_HOUR,
    HOUR_MS,
  );
  if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const report = await getPublicReport(slug);
  if (report === null || isReportGoneEitherKind(report)) return new Response(null, { status: 404 });

  // The report's account, so the event of an internal account's report is marked (CC-38 D3); the
  // cached row above does not carry it. A failed read sends the event unmarked rather than none.
  const owner = await supabaseAdmin()
    .from('public_reports')
    .select('account_id')
    .eq('slug', slug)
    .maybeSingle();
  const accountId = (owner.data as { account_id: string | null } | null)?.account_id ?? null;

  const cookie = req.headers.get('cookie');
  await captureServerEvent(cookie, {
    event: 'report_viewed',
    // The viewer, when their browser's consented cookie names them (CC-41 D1); else the report.
    distinctId: visitorDistinctId(cookie, null, `report:${slug}`),
    accountId,
    properties: { kind: isV2Snapshot(report.report_snapshot) ? 'v2' : 'v1' },
  });
  return new Response(null, { status: 204 });
}
