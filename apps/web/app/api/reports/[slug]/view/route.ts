import { NextResponse } from 'next/server';
import { captureServerEvent } from '@/lib/analytics-server';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { getClientIp } from '@/lib/client-ip';
import { REPORT_VIEWS_PER_IP_PER_HOUR } from '@/lib/limits';
import { checkRateLimit } from '@/lib/rate-limit';
import { isReportGone } from '@/lib/report-visibility';
import { getPublicReport } from '@/lib/reports';
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
  if (report === null || isReportGone(report)) return new Response(null, { status: 404 });

  await captureServerEvent(req.headers.get('cookie'), {
    event: 'report_viewed',
    distinctId: `report:${slug}`,
    properties: { kind: isV2Snapshot(report.report_snapshot) ? 'v2' : 'v1' },
  });
  return new Response(null, { status: 204 });
}
