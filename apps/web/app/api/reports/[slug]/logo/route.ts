import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readReportRow } from '@/lib/reports';
import { isReportGone } from '@/lib/report-visibility';
import { isDomainVerifiedForUser } from '@/lib/report-ownership';
import { deriveTier, entitlementFor } from '@/lib/entitlement';
import { checkRateLimit } from '@/lib/rate-limit';
import { LOGO_UPLOADS_PER_HOUR } from '@/lib/limits';
import { validateLogo, MAX_LOGO_BYTES } from '@/lib/logo-validation';
import { LOGO_BUCKET } from '@/lib/report-brand';

// node:crypto (content-addressing) + the storage upload need the Node runtime.
export const runtime = 'nodejs';

const HOUR_MS = 60 * 60 * 1000;

// The bucket is owner-provisioned (Runbook C) and may not exist yet. A missing bucket is a
// deploy-order state → fail soft (503, "unavailable"), NOT a 500. Distinguish it from a genuine storage
// error by the not-found signal so a real outage still surfaces as 500.
function isBucketMissing(error: { message?: unknown; statusCode?: unknown; status?: unknown } | null): boolean {
  if (!error) return false;
  const msg = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  // Match the specific "bucket not found" signal (+ a 404 status, string or numeric) — NOT a bare
  // "not found", so a genuine non-bucket storage error still surfaces as 500 rather than being masked.
  return msg.includes('bucket not found') || error.statusCode === '404' || error.status === 404;
}

// SPEC 04 §5/§11 (V10) — white-label logo upload. Claim + Pro gated exactly like the toggle (the abuse
// surface is a paying, identified, domain-verified owner), then the BYTE-AUTHORITATIVE validator
// (magic + header decode; PNG/JPEG/WebP only; NO SVG; ≤ 200 KB; bomb-guarded). Stored via the
// service-role client at a CONTENT-ADDRESSED path inside the report's namespace (`${slug}/<hash>.<ext>`)
// so every distinct logo has a stable, immutable URL (§10) and the white-label toggle's slug-scope
// check accepts it. No new outbound fetch path (§11) — the upload is inbound only.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const rl = await checkRateLimit(`report-logo:${user.id}`, LOGO_UPLOADS_PER_HOUR, HOUR_MS);
  if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const sb = supabaseAdmin();

  // Paid entitlement, server-side (pro_until only — the `tier` seam column isn't in this DB yet).
  const { data: me } = await sb.from('users').select('pro_until').eq('id', user.id).maybeSingle<{ pro_until: string | null }>();
  const proUntil = me?.pro_until ?? null;
  if (!entitlementFor(deriveTier({ pro_until: proUntil }), proUntil).canWhiteLabel) {
    return NextResponse.json({ error: 'pro_required' }, { status: 402 });
  }

  const report = await readReportRow(sb, slug);
  if (!report || isReportGone(report)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const owns = await isDomainVerifiedForUser(sb, user.id, report.domain);
  if (!owns) return NextResponse.json({ error: 'verification_required' }, { status: 403 });

  // Read the multipart file. Reject on the declared size BEFORE buffering (the validator re-checks the
  // real byte length authoritatively).
  const form = await req.formData().catch(() => null);
  const file = form?.get('logo');
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'no_file' }, { status: 400 });
  if (file.size > MAX_LOGO_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const v = validateLogo(bytes);
  if (!v.ok) return NextResponse.json({ error: 'invalid_image', reason: v.reason }, { status: 400 });

  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const logoPath = `${slug}/${hash}.${v.ext}`;

  const up = await sb.storage.from(LOGO_BUCKET).upload(logoPath, bytes, {
    contentType: v.contentType, // OUR detected type, never the client's declared one
    cacheControl: '31536000, immutable',
    upsert: true,
  });
  if (up.error) {
    const err = up.error as { message?: unknown; statusCode?: unknown; status?: unknown };
    if (isBucketMissing(err)) {
      console.error(`logo upload: bucket "${LOGO_BUCKET}" missing (Runbook C not applied) — failing soft 503`);
      return NextResponse.json({ error: 'unavailable' }, { status: 503 });
    }
    console.error(`logo upload failed for ${logoPath}: ${String(err.message ?? 'unknown')}`);
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 });
  }

  // The caller passes logoPath to the white-label toggle to attach it (that route re-verifies the
  // slug scope). We do not write white_label here — single responsibility.
  return NextResponse.json({ ok: true, logoPath, width: v.width, height: v.height });
}
