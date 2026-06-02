import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readAnonSessionId, clearAnonSession } from '@/lib/anon-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Only honor OTP types we actually issue — reject an attacker-supplied `type` (e.g. recovery /
// email_change) before it reaches the auth client. (token_hash is a Supabase-issued secret, so
// this is defense-in-depth, not the primary guard.)
const ALLOWED_OTP_TYPES = new Set<EmailOtpType>(['magiclink', 'signup', 'email']);

/**
 * Magic-link callback — runs server-side so the session cookies are set correctly.
 *
 * The robust path is `token_hash` + verifyOtp: it carries no PKCE code-verifier, so it works
 * even when the link is opened on a different device than the one that requested it. For email
 * sign-in to use this, the Supabase "Magic Link" email template must point here with
 * `?token_hash={{ .TokenHash }}&type=magiclink` (tracked as a deploy-gate in the verification
 * plan). The `?code=` / exchangeCodeForSession branch is a SAME-DEVICE-ONLY fallback for the
 * default PKCE link (the verifier cookie only exists in the requesting browser).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get('token_hash');
  const code = url.searchParams.get('code');
  const rawType = url.searchParams.get('type');
  const type: EmailOtpType = rawType && ALLOWED_OTP_TYPES.has(rawType as EmailOtpType) ? (rawType as EmailOtpType) : 'magiclink';

  const sb = await supabaseServer();
  let error: { status?: number; code?: string } | null = null;
  if (tokenHash) {
    ({ error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type }));
  } else if (code) {
    ({ error } = await sb.auth.exchangeCodeForSession(code));
  } else {
    return NextResponse.redirect(new URL('/login?error=missing_token', url.origin));
  }
  if (error) {
    console.error('[verify] sign-in failed:', { status: error.status, code: error.code });
    return NextResponse.redirect(new URL('/login?error=verify_failed', url.origin));
  }

  // Claim any audits this browser ran anonymously before signing in (same as /api/auth/claim).
  // The anon-session id is an httpOnly capability cookie, so a browser only claims its own
  // still-unclaimed (user_id null) audits.
  const { data: { user } } = await sb.auth.getUser();
  const anonId = await readAnonSessionId();
  if (user && anonId) {
    const admin = supabaseAdmin();
    await admin.from('audits').update({ user_id: user.id }).eq('anonymous_session_id', anonId).is('user_id', null);
    await clearAnonSession();
  }

  return NextResponse.redirect(new URL('/dashboard', url.origin));
}
