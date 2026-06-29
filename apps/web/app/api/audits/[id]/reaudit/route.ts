import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { inngest } from '@/lib/inngest';
import { checkRateLimit } from '@/lib/rate-limit';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { userIsPro } from '@/lib/pro';
import { tierLimits } from '@/lib/tier';
import { getClientIp } from '@/lib/client-ip';
import { authorizeReaudit } from '@/lib/reaudit';
import { GLOBAL_AUDITS_PER_DAY, IP_AUDITS_PER_DAY_USER } from '@/lib/limits';
import type { ReauditResponse } from '@crawlmouse/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SPEC 02 §8 manual monitoring. Re-audit the SAME url as `id`, linking the new audit to its
// predecessor for the monitoring delta. Pro + OWNER only (authorizeReaudit), then the SAME
// rate-limit/Turnstile/abuse path as a normal audit — deliberately NOT an unmetered backdoor.
const schema = z.object({ turnstileToken: z.string().optional() });
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();
  const sb = supabaseAdmin();

  // Capability-URL admin read; ownership is re-derived SERVER-SIDE (never trusted from the client).
  const { data: original } = await sb
    .from('audits')
    .select('id, url, user_id')
    .eq('id', id)
    .maybeSingle<{ id: string; url: string; user_id: string | null }>();

  const isPro = user ? await userIsPro(sbUser, user.id) : false;
  const authz = authorizeReaudit({
    userId: user?.id ?? null,
    auditExists: !!original,
    auditUserId: original?.user_id,
    isPro,
  });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  // authz.ok guarantees user + original are non-null.
  const ownerId = user!.id;
  const audit = original!;

  // SAME abuse path as /api/audits/start (NOT a backdoor): global ceiling fails CLOSED (cost guard);
  // Pro skips the per-domain limit (an entitlement); the per-IP daily bucket + Turnstile-on-exhaustion
  // still apply.
  const globalCheck = await checkRateLimit('global:audits:day', GLOBAL_AUDITS_PER_DAY, TWENTY_FOUR_HOURS_MS, { failClosed: true });
  if (!globalCheck.allowed) {
    return NextResponse.json({ error: 'We’re at capacity right now — please try again tomorrow.' }, { status: 503 });
  }

  const ip = getClientIp(req);
  if (ip !== 'unknown') {
    const ipCheck = await checkRateLimit(`ip:${ip}`, IP_AUDITS_PER_DAY_USER, TWENTY_FOUR_HOURS_MS);
    if (!ipCheck.allowed) {
      if (!parsed.data.turnstileToken) {
        return NextResponse.json({ error: 'captcha_required', resetAt: ipCheck.resetAt }, { status: 429 });
      }
      const ok = await verifyTurnstileToken(parsed.data.turnstileToken, ip);
      if (!ok) return NextResponse.json({ error: 'Captcha failed' }, { status: 429 });
    }
  }

  // Pro re-audit: Pro page cap, no TTL expiry. previous_audit_id links the predecessor (ON DELETE SET
  // NULL) so the monitoring delta degrades gracefully if the predecessor is later TTL-cleaned.
  const { pageCap, perHostConcurrency } = tierLimits(true);
  const { data: created, error: insertError } = await sb
    .from('audits')
    .insert({
      user_id: ownerId,
      url: audit.url,
      status: 'pending',
      settings: { pageCap },
      expires_at: null,
      previous_audit_id: audit.id,
    })
    .select('id')
    .single();

  if (insertError || !created) {
    return NextResponse.json({ error: 'Could not create re-audit' }, { status: 500 });
  }

  await inngest.send({
    name: 'audit.requested',
    data: { auditId: created.id, url: audit.url, pageCap, perHostConcurrency },
  });

  const response: ReauditResponse = { newAuditId: created.id, previousAuditId: audit.id, status: 'queued' };
  return NextResponse.json(response);
}
