import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readReportRow, purgePublicReport } from '@/lib/reports';
import { isReportGone } from '@/lib/report-visibility';
import { isDomainVerifiedForUser } from '@/lib/report-ownership';
import { isUndefinedColumnError } from '@/lib/pg-errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { CLAIM_ATTEMPTS_PER_HOUR } from '@/lib/limits';

const HOUR_MS = 60 * 60 * 1000;

// SPEC 04 §9 (V14) — claim a public report. Authed; REUSES the existing domain-verification flow (a
// verified domain_verifications row for the report's domain — not rebuilt). Claiming sets claimed_at +
// listed + indexable (the owner may opt out later via the visibility route) and links the owner to the
// domain for the badge (embed_badges upsert). It writes ONLY public_reports/embed_badges — never the
// audits table — so it COMPOSES with the anon-audit claim-on-signup flow (auth/claim, which writes
// audits.user_id), rather than replacing it. Writes go through the service-role client (client UPDATE
// on public_reports is revoked, 20260707000003). Deploy-order-safe: pre-Runbook-B the claimed_at/
// listed/indexable columns are absent → PGRST204/42703 → 503 (fail-closed like mint/hide), never an
// ungated state.
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  // Per-user throttle (defense-in-depth; the real gate is domain verification below).
  const rl = await checkRateLimit(`claim:${user.id}`, CLAIM_ATTEMPTS_PER_HOUR, HOUR_MS);
  if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const sb = supabaseAdmin();
  const report = await readReportRow(sb, slug);
  if (!report) return NextResponse.json({ error: 'not found' }, { status: 404 });
  // A hidden / taken-down / ungradeable report is not a claimable artifact.
  if (isReportGone(report)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Ownership: the caller must hold a VERIFIED domain_verifications row for the report's domain — the
  // mandatory-verification wall relocated from mint to claim (§3/§9), re-checked server-side.
  const owns = await isDomainVerifiedForUser(sb, user.id, report.domain);
  if (!owns) return NextResponse.json({ error: 'verification_required' }, { status: 403 });

  // Guarded claim write: the `claimed_at is null` predicate makes a concurrent/duplicate claim an
  // idempotent 0-row no-op (a second verified owner simply re-links their badge below).
  const { data, error } = await sb
    .from('public_reports')
    .update({ claimed_at: new Date().toISOString(), listed: true, indexable: true })
    .eq('slug', slug)
    .is('claimed_at', null)
    .select('slug')
    .maybeSingle();

  if (error) {
    if (isUndefinedColumnError(error)) return NextResponse.json({ error: 'unavailable' }, { status: 503 });
    return NextResponse.json({ error: 'could not claim' }, { status: 500 });
  }

  // Link the verified owner to the domain (the badge's view-count / style row). First writer — nothing
  // inserted embed_badges before. Best-effort: the public_reports claim is the source of truth for
  // "claimed" and the badge RESOLVES off claimed public_reports, so a failed link degrades gracefully
  // (view counts just don't accrue until a row exists). Never fail the claim on it.
  try {
    await sb.from('embed_badges').upsert({ user_id: user.id, domain: report.domain }, { onConflict: 'user_id,domain' });
  } catch {
    // best-effort owner link — swallowed by design
  }

  // Flip the report page + OG robots/branding immediately, and revalidate the sitemap so a freshly
  // claimed+indexable report is discoverable promptly (symmetric with the visibility route). The
  // badge/leaderboard reflect the claim within their own ISR windows.
  purgePublicReport(slug);
  revalidatePath('/sitemap.xml');
  return NextResponse.json({ ok: true, slug, alreadyClaimed: !data });
}
