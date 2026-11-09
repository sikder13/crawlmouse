import { NextRequest, NextResponse } from 'next/server';
import type { EmailOtpType, User } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readAnonSessionId, clearAnonSession } from '@/lib/anon-session';
import { applyNoStore } from '@/lib/supabase/no-store';
import { safeNextPath } from '@/lib/safe-next-path';
import { getClientIp } from '@/lib/client-ip';
import { isSameOrigin } from '@/lib/security/same-origin';
import { accountDoorEnabled } from '@/lib/auth/flags';
import { AUTH_LINK_SECONDS, COOKIES } from '@/lib/auth/constants';
import {
  bindingMismatch,
  claimFromNext,
  decodeOtp,
  decodeSignup,
  DASHBOARD,
  encodeOtp,
  type OtpCarry,
} from '@/lib/auth/continue-intent';
import { afterSignIn } from '@/lib/auth/landing';
import { doorDeps } from '@/lib/auth/door-deps';
import { sentryReport } from '@/lib/auth/stores';
import type { DoorEvent } from '@/lib/auth/first-login';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The magic-link landing (CC-25 D3, SECURITY-DESIGN J7).
 *
 * GET never verifies. A mail scanner that fetches the link must not spend the token, so GET moves
 * the token into a one-shot httpOnly cookie scoped to this path and sends the browser to the
 * Continue page, whose URL carries no token: nothing the page loads (PostHog's pageview, a link's
 * Referer) can see it. POST, from that page's button, verifies and signs in.
 *
 * The `token_hash` + verifyOtp path carries no PKCE verifier, so it works when the link is opened on
 * another device; the Supabase "Magic Link" template must point here with
 * `?token_hash={{ .TokenHash }}&type=magiclink` (`scripts/supabase/auth-config.ts --read` checks it).
 * The `?code=` branch is the same-device PKCE fallback.
 */

const CONTINUE = '/login/verify/continue';
const EXPIRED = `${CONTINUE}?state=expired`;

// Only OTP types we issue; an attacker-supplied `type` (recovery, email_change) never reaches Supabase.
const ALLOWED_OTP_TYPES = new Set<EmailOtpType>(['magiclink', 'signup', 'email']);

const secure = () => process.env.NODE_ENV === 'production';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get('token_hash');
  const code = url.searchParams.get('code');
  const rawType = url.searchParams.get('type');
  const type =
    rawType && ALLOWED_OTP_TYPES.has(rawType as EmailOtpType)
      ? (rawType as 'magiclink' | 'signup' | 'email')
      : 'magiclink';

  let carry: OtpCarry;
  if (tokenHash) carry = { kind: 'token_hash', value: tokenHash, type };
  else if (code) carry = { kind: 'code', value: code };
  else return NextResponse.redirect(new URL('/login?error=missing_token', url.origin));

  const res = applyNoStore(NextResponse.redirect(new URL(CONTINUE, url.origin), 303));
  res.headers.set('Referrer-Policy', 'same-origin');
  res.cookies.set(COOKIES.otp, encodeOtp(carry), {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: '/login/verify',
    maxAge: AUTH_LINK_SECONDS,
  });
  return res;
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  // A form post from our own page; a browser may send `Origin: null` on a no-JS post.
  if (!isSameOrigin(request, url.origin)) {
    return applyNoStore(NextResponse.json({ error: 'cross_site' }, { status: 403 }));
  }
  const req = new NextRequest(request);
  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
  const carry = decodeOtp(req.cookies.get(COOKIES.otp)?.value);

  const respond = (dest: string, events: DoorEvent[] = []) => {
    const res = applyNoStore(
      wantsJson
        ? NextResponse.json({ next: dest, events })
        : NextResponse.redirect(new URL(dest, url.origin), 303),
    );
    // The token is spent or refused either way; nothing reads it twice.
    res.cookies.set(COOKIES.otp, '', { path: '/login/verify', maxAge: 0 });
    return res;
  };

  if (carry === null) return respond(EXPIRED);

  // A throw anywhere below still answers through `respond`, so the token cookie is cleared on that
  // exit too. Sentry gets the step that threw, not the error, which may hold request data.
  let stage: 'verify' | 'anon-claim' | 'landing-redirect' = 'verify';
  try {
    const sb = await supabaseServer();
    const { data, error } =
      carry.kind === 'token_hash'
        ? await sb.auth.verifyOtp({ token_hash: carry.value, type: carry.type })
        : await sb.auth.exchangeCodeForSession(carry.value);
    if (error) {
      console.error('[verify] sign-in failed:', { status: error.status, code: error.code });
      return respond(EXPIRED);
    }
    const user: User | null = data.user ?? (await sb.auth.getUser()).data.user;

    // Claim the audits this browser ran anonymously before signing in (v1). The
    // anon-session id is an httpOnly capability cookie, so a browser only claims its own unclaimed
    // audits. Not when the link signed in an address other than the one this browser's door request
    // was for: that is someone else's link opened here, and the audits are not theirs (CC-06c D9).
    stage = 'anon-claim';
    const anonId = await readAnonSessionId();
    const foreign = bindingMismatch(req.cookies.get(COOKIES.binding)?.value, user?.email);
    if (user && anonId && !foreign) {
      const admin = supabaseAdmin();
      await admin
        .from('audits')
        .update({ user_id: user.id })
        .eq('anonymous_session_id', anonId)
        .is('user_id', null);
      await clearAnonSession();
    }

    // Return the user to a validated same-origin target (R1 fold-in), re-validated here against a
    // tampered cookie; absent or invalid falls back to /dashboard. A Keep's claim target is never
    // followed as a URL: the door runs the claim itself, and with the door off it lands on /dashboard.
    stage = 'landing-redirect';
    const next = req.cookies.get(COOKIES.next)?.value;
    let dest = claimFromNext(next) !== null ? DASHBOARD : (safeNextPath(next) ?? DASHBOARD);
    let events: DoorEvent[] = [];

    if (user && accountDoorEnabled()) {
      try {
        const landing = await afterSignIn(
          { ...doorDeps(), report: sentryReport((m, ctx) => Sentry.captureMessage(m, ctx)) },
          {
            user,
            next,
            boundTo: req.cookies.get(COOKIES.binding)?.value,
            signup: decodeSignup(req.cookies.get(COOKIES.signup)?.value),
            device: req.cookies.get(COOKIES.device)?.value ?? null,
            ip: getClientIp(request),
          },
        );
        if (landing.dest !== null) dest = landing.dest;
        events = landing.events;
      } catch {
        Sentry.captureMessage('auth.landing-failed', {
          level: 'warning',
          tags: { signal: 'landing-failed' },
          extra: { userId: user.id },
        });
      }
    }

    const res = respond(dest, events);
    // Someone else's link leaves this browser's own door request in place until it expires, so the
    // owner's link still finds it and a second foreign link is still recognised as one.
    if (!foreign) {
      res.cookies.set(COOKIES.next, '', { path: '/', maxAge: 0 });
      res.cookies.set(COOKIES.signup, '', { path: '/', maxAge: 0 });
      res.cookies.set(COOKIES.binding, '', { path: '/', maxAge: 0 });
    }
    return res;
  } catch {
    Sentry.captureMessage('auth.verify-threw', {
      level: 'warning',
      tags: { signal: 'verify-threw' },
      extra: { stage },
    });
    return respond(EXPIRED);
  }
}
