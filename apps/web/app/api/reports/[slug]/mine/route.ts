import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readReportRow } from '@/lib/reports';
import { isReportGone, isReportClaimed } from '@/lib/report-visibility';
import { isDomainVerifiedForUser } from '@/lib/report-ownership';
import { deriveTier, entitlementFor } from '@/lib/entitlement';

// SPEC 04.1 §2 — READ-ONLY ownership probe for the /r/ owner client island. The /r/ page is ISR
// (revalidate=300) and session-unaware; after hydration the island asks this endpoint whether the
// current session owns the report and may white-label it, WITHOUT baking any session data into the
// cached HTML. It adds ZERO write surface — every mutation still goes through the already-gated
// claim / visibility / white-label routes; this only mirrors their gate chain so the UI's
// locked/enabled state matches what those routes will enforce.
//
// - `force-dynamic` + `no-store`: never cached; a refetch after a write (R2) always sees fresh state
//   (uncached `readReportRow`, not the cached `getPublicReport`).
// - DENY-BY-DEFAULT: anon and signed-in non-owners get exactly `{owned:false}` — no listed/indexable/
//   whiteLabel or any session-derived state leaks. Entitlement is the REAL `entitlementFor`, recomputed
//   from the owner's own `pro_until`, never client-asserted.
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();
  // Anon short-circuits before any report read — no ownership signal, no existence leak.
  if (!user) return NextResponse.json({ owned: false }, { headers: NO_STORE });

  const sb = supabaseAdmin();
  const report = await readReportRow(sb, slug);
  // A missing / hidden / taken-down / ungradeable report is not an ownable artifact.
  if (!report || isReportGone(report)) {
    return NextResponse.json({ error: 'not found' }, { status: 404, headers: NO_STORE });
  }

  // Ownership: a VERIFIED domain_verifications row for the report's domain (the same gate the write
  // routes enforce, re-derived on every read — there is no claimed_by column). Non-owner → deny-by-default.
  const owns = await isDomainVerifiedForUser(sb, user.id, report.domain);
  if (!owns) return NextResponse.json({ owned: false }, { headers: NO_STORE });

  // Entitlement recomputed SERVER-SIDE from the owner's own pro_until (mirrors the white-label route so
  // the island's locked/enabled state matches what the write route enforces).
  const { data: me } = await sb.from('users').select('pro_until').eq('id', user.id).maybeSingle<{ pro_until: string | null }>();
  const proUntil = me?.pro_until ?? null;
  const canWhiteLabel = entitlementFor(deriveTier({ pro_until: proUntil }), proUntil).canWhiteLabel;

  return NextResponse.json(
    {
      owned: true,
      claimed: isReportClaimed(report),
      canWhiteLabel,
      listed: report.listed === true,
      indexable: report.indexable === true,
      whiteLabel: report.white_label ?? null,
    },
    { headers: NO_STORE },
  );
}
