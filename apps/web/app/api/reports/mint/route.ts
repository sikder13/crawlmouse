import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { PublicReportSnapshot } from '@crawlmouse/types';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { newReportSlug } from '@/lib/slug';
import { normalizeDomain } from '@/lib/domain';
import { checkRateLimit } from '@/lib/rate-limit';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { getClientIp } from '@/lib/client-ip';
import { isUndefinedColumnError } from '@/lib/pg-errors';
import { buildMintSnapshot } from '@/lib/mint-snapshot';
import { MINT_REPORTS_PER_DAY, MINT_REPORTS_PER_IP_PER_DAY_ANON } from '@/lib/limits';

const schema = z.object({ auditId: z.string().uuid(), turnstileToken: z.string().optional() });
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SLUG_ATTEMPTS = 3;

type SupabaseAdmin = ReturnType<typeof supabaseAdmin>;
type InsertResult = { slug: string } | { error: string; status: number };

/**
 * Insert a public_reports row with its frozen snapshot + minter, tolerating the (astronomically rare)
 * slug PK collision and the double-submit race on the audit_id UNIQUE constraint (idempotent — return
 * the existing slug). Deploy-order-safe: if the new columns don't exist yet (pre-Runbook-B) the whole
 * mint returns 503 rather than falling back to an UNGUARDED (indexable-by-default) legacy insert — so
 * open minting can never ship without the noindex-by-default guardrail those columns provide.
 */
async function insertReportWithRetry(
  sb: SupabaseAdmin,
  auditId: string,
  domain: string,
  snapshot: PublicReportSnapshot | null,
  mintedBy: string | null,
): Promise<InsertResult> {
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = newReportSlug();
    const { error } = await sb
      .from('public_reports')
      .insert({ slug, audit_id: auditId, domain, report_snapshot: snapshot, minted_by: mintedBy });
    if (!error) return { slug };
    if (isUndefinedColumnError(error)) return { error: 'minting_unavailable', status: 503 };
    if (error.code !== '23505') return { error: 'could not mint', status: 500 };
    // Unique violation: if it's the audit_id constraint, a report already exists — return it.
    const { data: existing } = await sb.from('public_reports').select('slug').eq('audit_id', auditId).maybeSingle();
    if (existing) return { slug: existing.slug };
    // Otherwise it was a slug PK collision: loop and try a fresh slug.
  }
  return { error: 'could not mint', status: 500 };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });

  const ip = getClientIp(req);
  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();

  // Abuse gate (mirrors audits/start): a coarse per-user (authed) / per-IP (anon) daily cap, with
  // Turnstile as the on-demand escalation once the cap is exhausted. Auth is NOT required — possession
  // of the completed-audit capability UUID is the permission (§3).
  const capKey = user ? `mint:${user.id}` : ip !== 'unknown' ? `mint:ip:${ip}` : null;
  const cap = user ? MINT_REPORTS_PER_DAY : MINT_REPORTS_PER_IP_PER_DAY_ANON;
  let capExhausted = false;
  if (capKey) {
    const rl = await checkRateLimit(capKey, cap, DAY_MS);
    capExhausted = !rl.allowed;
  } else {
    capExhausted = true; // anon with no client IP → require Turnstile (can't cap otherwise)
  }
  if (capExhausted) {
    if (!parsed.data.turnstileToken) return NextResponse.json({ error: 'captcha_required' }, { status: 429 });
    const ok = await verifyTurnstileToken(parsed.data.turnstileToken, ip === 'unknown' ? undefined : ip);
    if (!ok) return NextResponse.json({ error: 'captcha_failed' }, { status: 429 });
  }

  const sb = supabaseAdmin();
  // Capability read: possession of the audit UUID authorizes minting (no ownership/verification check).
  const { data: audit } = await sb
    .from('audits')
    .select('id, url, status, grade, score, cms_detected, page_count, confidence, coverage_pct, confidence_band, projected_score, projected_grade')
    .eq('id', parsed.data.auditId)
    .maybeSingle();
  if (!audit) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (audit.status !== 'completed') return NextResponse.json({ error: 'audit not complete' }, { status: 400 });
  // An ungradeable completed audit (e.g. a JS-rendered / blocked crawl) has no client-ready report;
  // minting it would produce a null-grade row that immediately 404s. Reject up front with a clear message.
  if (!audit.grade) return NextResponse.json({ error: 'audit not gradeable' }, { status: 400 });

  const domain = normalizeDomain(audit.url);

  // Already public? (fast path; the retry below also covers the double-submit race.)
  const { data: existing } = await sb.from('public_reports').select('slug').eq('audit_id', audit.id).maybeSingle();
  if (existing) return NextResponse.json({ slug: existing.slug });

  // Build the FROZEN, FREE snapshot from the audit's persisted data (the gated cure columns are never
  // read — see buildMintSnapshot). Stamped once here; immutable thereafter.
  const snapshot = await buildMintSnapshot(sb, audit.id, audit, domain, new Date().toISOString());

  const result = await insertReportWithRetry(sb, audit.id, domain, snapshot, user?.id ?? null);
  if ('error' in result) {
    const msg = result.status === 503 ? 'Minting is being set up — please try again shortly.' : result.error;
    return NextResponse.json({ error: msg }, { status: result.status });
  }
  return NextResponse.json({ slug: result.slug });
}
