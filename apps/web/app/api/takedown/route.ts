import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { normalizeDomain } from '@/lib/domain';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { TAKEDOWN_PER_IP_PER_DAY, TAKEDOWN_PER_DOMAIN_PER_DAY } from '@/lib/limits';

const schema = z.object({
  publicReportSlug: z.string().max(64).optional(),
  domain: z.string().min(3).max(253),
  requesterEmail: z.string().email().max(320),
  reason: z.string().min(10).max(2000),
  turnstileToken: z.string().optional(),
});

const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });

  let domain: string;
  try {
    domain = normalizeDomain(parsed.data.domain);
  } catch {
    return NextResponse.json({ error: 'invalid input' }, { status: 400 });
  }

  // Throttle the unauthenticated form: per IP and per domain. (RLS no longer lets the
  // anon key insert directly — this route, on the service role, is the only path in.)
  const ip = getClientIp(req);
  if (ip !== 'unknown') {
    const ipCheck = await checkRateLimit(`takedown:ip:${ip}`, TAKEDOWN_PER_IP_PER_DAY, DAY_MS);
    if (!ipCheck.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const domainCheck = await checkRateLimit(`takedown:domain:${domain}`, TAKEDOWN_PER_DOMAIN_PER_DAY, DAY_MS);
  if (!domainCheck.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  // Turnstile is verified when a token is supplied (forward-compatible); the form
  // widget itself is wired in launch readiness. In dev (no secret) this is a no-op.
  if (parsed.data.turnstileToken) {
    const ok = await verifyTurnstileToken(parsed.data.turnstileToken, ip);
    if (!ok) return NextResponse.json({ error: 'captcha_failed' }, { status: 400 });
  }

  const sb = supabaseAdmin();
  // Only accept takedowns against a report that actually exists (and isn't already
  // taken down) — this rejects spam for domains we've never published and gives the
  // ops queue a real slug to act on.
  const { data: report } = await sb
    .from('public_reports')
    .select('slug')
    .eq('domain', domain)
    .is('takedown_requested_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!report) return NextResponse.json({ error: 'no_report_for_domain' }, { status: 404 });

  const { error } = await sb.from('takedown_requests').insert({
    public_report_slug: report.slug,
    domain,
    requester_email: parsed.data.requesterEmail,
    reason: parsed.data.reason,
    status: 'pending',
  });
  if (error) return NextResponse.json({ error: 'could not submit' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
