import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateUrlOrThrow } from '@crawlmouse/engine';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { inngest } from '@/lib/inngest';
import { checkRateLimit } from '@/lib/rate-limit';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { userIsPro } from '@/lib/pro';
import { tierLimits } from '@/lib/tier';
import { normalizeDomain } from '@/lib/domain';
import { getClientIp } from '@/lib/client-ip';
import { getOrCreateAnonSessionId } from '@/lib/anon-session';
import {
  AUDIT_TTL_DAYS,
  DOMAIN_AUDITS_PER_HOUR,
  GLOBAL_AUDITS_PER_DAY,
  IP_AUDITS_PER_DAY_ANON,
  IP_AUDITS_PER_DAY_USER,
} from '@/lib/limits';

const schema = z.object({
  url: z.string().url(),
  turnstileToken: z.string().optional(),
});

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  try {
    await validateUrlOrThrow(parsed.data.url);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid URL' }, { status: 400 });
  }

  // Global backstop (18%-MRR guard): a hard ceiling on total audits started per day across ALL
  // callers, so platform-wide volume can't blow past the cost envelope even if per-IP/domain
  // limits are individually evaded. Unlike the per-IP/domain buckets (which fail OPEN so a
  // transient Supabase blip doesn't block legitimate traffic), this one fails CLOSED: a fail-open
  // here would silently uncap platform-wide spend during an outage, which is exactly the cost
  // runaway this ceiling exists to prevent. The 503 below therefore now also covers the RPC-error
  // case — better to briefly shed load than to lift the cost cap.
  const globalCheck = await checkRateLimit('global:audits:day', GLOBAL_AUDITS_PER_DAY, TWENTY_FOUR_HOURS_MS, { failClosed: true });
  if (!globalCheck.allowed) {
    return NextResponse.json({ error: 'We’re at capacity right now — please try again tomorrow.' }, { status: 503 });
  }

  const ip = getClientIp(req);
  const sbUser = await supabaseServer();
  const { data: { user } } = await sbUser.auth.getUser();
  const sb = supabaseAdmin();

  const proUser = user ? await userIsPro(sbUser, user.id) : false;

  // Pro has no per-domain rate limit (an advertised entitlement); free/anon get 1 per domain per hour.
  // Normalize so www.example.com and example.com share one bucket (no `www.` bypass).
  const domain = normalizeDomain(parsed.data.url);
  if (!proUser) {
    const domainCheck = await checkRateLimit(`domain:${domain}`, DOMAIN_AUDITS_PER_HOUR, HOUR_MS);
    if (!domainCheck.allowed) {
      return NextResponse.json({ error: 'Another audit for this domain ran in the last hour. Try again soon.' }, { status: 429 });
    }
  }

  // Skip the per-IP bucket when the platform gave us no client IP (non-Vercel / local), so
  // every such caller doesn't collapse into one shared "unknown" bucket and lock each other
  // out. On Vercel the IP is always present (it rewrites x-forwarded-for at the edge).
  const ipLimit = user ? IP_AUDITS_PER_DAY_USER : IP_AUDITS_PER_DAY_ANON;
  let ipAllowed = true;
  let ipResetAt: Date | undefined;
  if (ip !== 'unknown') {
    const ipCheck = await checkRateLimit(`ip:${ip}`, ipLimit, TWENTY_FOUR_HOURS_MS);
    ipAllowed = ipCheck.allowed;
    ipResetAt = ipCheck.resetAt;
  }
  if (!ipAllowed) {
    if (!parsed.data.turnstileToken) {
      return NextResponse.json({ error: 'captcha_required', resetAt: ipResetAt }, { status: 429 });
    }
    const ok = await verifyTurnstileToken(parsed.data.turnstileToken, ip);
    if (!ok) return NextResponse.json({ error: 'Captcha failed' }, { status: 429 });
  }

  const { pageCap, perHostConcurrency } = tierLimits(proUser);
  const expiresAt = proUser ? null : new Date(Date.now() + AUDIT_TTL_DAYS * TWENTY_FOUR_HOURS_MS).toISOString();
  // Stable per-browser id (httpOnly cookie) so the visitor can claim these audits on sign-up.
  const anonSessionId = user ? null : await getOrCreateAnonSessionId();

  const { data: audit, error: insertError } = await sb
    .from('audits')
    .insert({
      user_id: user?.id ?? null,
      anonymous_session_id: anonSessionId,
      url: parsed.data.url,
      status: 'pending',
      settings: { pageCap },
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (insertError || !audit) {
    return NextResponse.json({ error: 'Could not create audit' }, { status: 500 });
  }

  await inngest.send({
    name: 'audit.requested',
    data: { auditId: audit.id, url: parsed.data.url, pageCap, perHostConcurrency },
  });

  return NextResponse.json({ auditId: audit.id });
}
