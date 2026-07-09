import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { turnstileGate } from '@/lib/turnstile-gate';
import { MAGIC_LINK_PER_IP_PER_HOUR, MAGIC_LINK_PER_EMAIL_PER_HOUR } from '@/lib/limits';
import { safeNextPath } from '@/lib/safe-next-path';

const schema = z.object({
  email: z.string().email(),
  turnstileToken: z.string().optional(),
  // R1 fold-in — a return target (e.g. the report being claimed). Validated to a same-origin relative
  // path by safeNextPath before it is ever stored/used (no open redirect).
  next: z.string().max(2048).optional(),
});
const HOUR_MS = 60 * 60 * 1000;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  // Rate-limit by IP and by email so the endpoint can't be used to email-bomb an inbox,
  // exhaust the Supabase auth-email quota, or mass-provision accounts (shouldCreateUser).
  const ip = getClientIp(req);
  const byEmail = await checkRateLimit(`magic:email:${email}`, MAGIC_LINK_PER_EMAIL_PER_HOUR, HOUR_MS);
  // Per-email is the primary protection; only add a per-IP bucket when the platform gave us
  // a real IP (skip "unknown" so off-platform callers don't share one global bucket).
  const byIp = ip === 'unknown'
    ? { allowed: true }
    : await checkRateLimit(`magic:ip:${ip}`, MAGIC_LINK_PER_IP_PER_HOUR, HOUR_MS);
  if (!byIp.allowed || !byEmail.allowed) {
    return NextResponse.json({ error: 'Too many sign-in requests. Try again later.' }, { status: 429 });
  }

  // Always-on captcha for sign-in (when configured) — a bot-driven flood would otherwise
  // exhaust the Supabase auth-email quota before the per-email/per-IP buckets fill.
  const outcome = await turnstileGate(
    !!process.env.TURNSTILE_SECRET_KEY,
    parsed.data.turnstileToken,
    (t) => verifyTurnstileToken(t, ip),
  );
  if (outcome === 'block') {
    return NextResponse.json({ error: 'Verification failed. Please try again.' }, { status: 400 });
  }

  const sb = await supabaseServer();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${baseUrl}/login/verify`,
    },
  });

  if (error) {
    return NextResponse.json({ error: 'Could not send magic link' }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true });
  // Remember a validated same-origin return target so /login/verify can send the user back there (e.g.
  // the report they were claiming) instead of /dashboard. One-shot, short-lived, httpOnly, SameSite=Lax
  // (sent on the top-level navigation from the email link on the SAME device; cross-device safely falls
  // back to /dashboard). Off-origin values are dropped by safeNextPath.
  const safeNext = safeNextPath(parsed.data.next);
  if (safeNext) {
    res.cookies.set('post_login_next', safeNext, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600,
      path: '/',
    });
  }
  return res;
}
