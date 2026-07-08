import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { purgePublicReport } from '@/lib/reports';
import { isUndefinedColumnError } from '@/lib/pg-errors';
import { HIDE_REPORTS_PER_IP_PER_DAY } from '@/lib/limits';

// SPEC 04 §3/§9 — self-service hide for the minter. CAPABILITY-scoped: possession of the audit UUID is
// the permission (symmetric with mint), so no auth/ownership check. Sets hidden_at on the report
// minted from that audit → the report page/OG 404, and purges the cached render immediately. All
// writes are service-role. Deploy-order-safe: 42703 (hidden_at absent pre-Runbook-B) → 503.
const schema = z.object({ auditId: z.string().uuid() });
const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid request' }, { status: 400 });

  const ip = getClientIp(req);
  if (ip !== 'unknown') {
    const rl = await checkRateLimit(`hide:ip:${ip}`, HIDE_REPORTS_PER_IP_PER_DAY, DAY_MS);
    if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // Hide the (not-already-hidden) report for this audit. `.is('hidden_at', null)` makes a re-hide a
  // no-op 0-row update; `audit_id` is the capability key (NULL after TTL → no match → 404, by design).
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('public_reports')
    .update({ hidden_at: new Date().toISOString() })
    .eq('audit_id', parsed.data.auditId)
    .is('hidden_at', null)
    .select('slug')
    .maybeSingle();

  if (error) {
    if (isUndefinedColumnError(error)) return NextResponse.json({ error: 'unavailable' }, { status: 503 });
    return NextResponse.json({ error: 'could not hide' }, { status: 500 });
  }
  if (!data) {
    // 0 rows matched the `hidden_at is null` guard: either no report exists for this audit (404) or
    // it is ALREADY hidden — a re-hide is idempotent (200), not an error.
    const { data: existing } = await sb.from('public_reports').select('slug').eq('audit_id', parsed.data.auditId).maybeSingle();
    if (existing) {
      purgePublicReport(existing.slug); // defense-in-depth: ensure the cache reflects the hidden state
      return NextResponse.json({ ok: true, alreadyHidden: true });
    }
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  purgePublicReport(data.slug); // flip the report + OG card to 404 immediately (don't wait out the TTL)
  return NextResponse.json({ ok: true });
}
