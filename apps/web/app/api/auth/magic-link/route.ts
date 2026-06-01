import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { MAGIC_LINK_PER_IP_PER_HOUR, MAGIC_LINK_PER_EMAIL_PER_HOUR } from '@/lib/limits';

const schema = z.object({ email: z.string().email() });
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
  return NextResponse.json({ ok: true });
}
