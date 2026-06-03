import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { WAITLIST_PER_IP_PER_DAY } from '@/lib/limits';
import { classifyWaitlistInsert } from '@/lib/waitlist-insert';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().email().max(320),
  turnstileToken: z.string().optional(),
});

const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid input' }, { status: 400 });

  const ip = getClientIp(req);
  if (ip !== 'unknown') {
    const rl = await checkRateLimit(`waitlist:ip:${ip}`, WAITLIST_PER_IP_PER_DAY, DAY_MS);
    if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // Turnstile is ALWAYS-ON here (stricter than takedown): when a secret is configured, a missing
  // or failing token is rejected. In dev (no secret) this whole block is skipped.
  if (process.env.TURNSTILE_SECRET_KEY) {
    const ok = parsed.data.turnstileToken
      ? await verifyTurnstileToken(parsed.data.turnstileToken, ip)
      : false;
    if (!ok) return NextResponse.json({ error: 'captcha_failed' }, { status: 400 });
  }

  const sb = supabaseAdmin();
  // Plain insert (NOT upsert): PostgREST's onConflict can't target the functional unique index
  // (lower(email), source), so we let the 23505 unique-violation surface and treat it as
  // idempotent success — mirrors reports/mint. A duplicate returns the SAME { ok: true } as a
  // fresh signup, so the route never reveals whether an email already existed (no enumeration).
  const { error } = await sb
    .from('waitlist')
    .insert({ email: parsed.data.email.toLowerCase(), source: 'developers' });
  const outcome = classifyWaitlistInsert(error);
  if (!outcome.ok) {
    return NextResponse.json({ error: 'could not submit' }, { status: outcome.status });
  }
  return NextResponse.json({ ok: true });
}
