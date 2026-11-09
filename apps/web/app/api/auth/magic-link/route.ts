import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { z } from 'zod';
import { TimeZoneSchema } from '@crawlmouse/types/v2';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { turnstileGate } from '@/lib/turnstile-gate';
import { turnstileEnforced } from '@/lib/turnstile-policy';
import { MAGIC_LINK_PER_IP_PER_HOUR, MAGIC_LINK_PER_EMAIL_PER_HOUR } from '@/lib/limits';
import { safeNextPath } from '@/lib/safe-next-path';
import { accountDoorEnabled } from '@/lib/auth/flags';
import {
  AUTH_LINK_SECONDS,
  COOKIES,
  DEVICE_COOKIE_SECONDS,
  V1_NEXT_COOKIE_SECONDS,
} from '@/lib/auth/constants';
import {
  claimNext,
  DASHBOARD,
  emailBinding,
  encodeSignup,
  isUuid,
  type SignupCarry,
} from '@/lib/auth/continue-intent';
import { hostFromSiteInput } from '@/lib/auth/site-host';
import { requestCookie } from '@/lib/auth/request-cookie';

const schema = z.object({
  email: z.string().email(),
  turnstileToken: z.string().optional(),
  // R1 fold-in — a return target (e.g. the report being claimed). Validated to a same-origin relative
  // path by safeNextPath before it is ever stored/used (no open redirect).
  next: z.string().max(2048).optional(),
  // CC-25: the v2 door's fields. Read only with V2_ACCOUNT_DOOR=1, and checked then, so with the flag
  // off a request carrying them is treated exactly as before.
  site: z.unknown().optional(),
  tz: z.unknown().optional(),
  claimCheckId: z.unknown().optional(),
});
const HOUR_MS = 60 * 60 * 1000;

const secure = () => process.env.NODE_ENV === 'production';

/** A browser always sends Origin on a cross-site POST; a request without one is not a browser's. */
function crossSite(req: Request, origin: string): boolean {
  const o = req.headers.get('origin');
  if (req.headers.get('sec-fetch-site') === 'cross-site') return true;
  return o !== null && o !== origin;
}

export async function POST(req: Request) {
  const door = accountDoorEnabled();
  if (door && crossSite(req, new URL(req.url).origin)) {
    return NextResponse.json(
      { error: 'Cross-site request refused', code: 'cross_site' },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email', code: 'invalid_email' }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  // The door's fields, checked before any budget is spent. A zone is never a reason to refuse a
  // sign-in: an unknown one is dropped, and the account keeps UTC.
  const { claimCheckId, site, tz } = parsed.data;
  const v2 = door && (claimCheckId !== undefined || site !== undefined || tz !== undefined);
  if (v2 && claimCheckId !== undefined && !isUuid(claimCheckId)) {
    return NextResponse.json(
      { error: 'Invalid request', code: 'invalid_request' },
      { status: 400 },
    );
  }
  const zone =
    v2 && typeof tz === 'string' && TimeZoneSchema.safeParse(tz).success ? tz : undefined;

  // Rate-limit by IP and by email so the endpoint can't be used to email-bomb an inbox,
  // exhaust the Supabase auth-email quota, or mass-provision accounts (shouldCreateUser).
  const ip = getClientIp(req);
  const byEmail = await checkRateLimit(
    `magic:email:${email}`,
    MAGIC_LINK_PER_EMAIL_PER_HOUR,
    HOUR_MS,
  );
  // Per-email is the primary protection; only add a per-IP bucket when the platform gave us
  // a real IP (skip "unknown" so off-platform callers don't share one global bucket).
  const byIp =
    ip === 'unknown'
      ? { allowed: true }
      : await checkRateLimit(`magic:ip:${ip}`, MAGIC_LINK_PER_IP_PER_HOUR, HOUR_MS);
  if (!byIp.allowed || !byEmail.allowed) {
    return NextResponse.json(
      { error: 'Too many sign-in requests. Try again later.', code: 'rate_limited' },
      { status: 429 },
    );
  }

  // Always-on captcha for sign-in (when configured, and always in production) — a bot-driven flood
  // would otherwise exhaust the Supabase auth-email quota before the per-email/per-IP buckets fill.
  // In production a missing secret keeps the gate ON and verification fails closed.
  const outcome = await turnstileGate(
    turnstileEnforced(process.env),
    parsed.data.turnstileToken,
    (t) => verifyTurnstileToken(t, ip),
  );
  if (outcome === 'block') {
    return NextResponse.json(
      { error: 'Verification failed. Please try again.', code: 'verification' },
      { status: 400 },
    );
  }

  // A named first site: its shape only, here, so a resolver blip cannot block a sign-up over an
  // optional field. The SSRF guard runs when the site is attached at first login.
  let host: string | undefined;
  if (v2 && site !== undefined && site !== '') {
    host = (typeof site === 'string' && hostFromSiteInput(site)) || undefined;
    if (host === undefined) {
      return NextResponse.json({ error: 'Invalid site', code: 'invalid_site' }, { status: 400 });
    }
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
    // Supabase limits sends per address itself; with the door on that reads as our 429.
    if (door && error.status === 429) {
      return NextResponse.json(
        { error: 'Too many sign-in requests. Try again later.', code: 'rate_limited' },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: 'Could not send magic link', code: 'send_failed' },
      { status: 500 },
    );
  }

  const res = NextResponse.json({ ok: true });
  // Remember a validated same-origin return target so /login/verify can send the user back there (e.g.
  // the report they were claiming) instead of /dashboard. One-shot, short-lived, httpOnly, SameSite=Lax
  // (sent on the top-level navigation from the email link on the SAME device; cross-device safely falls
  // back to /dashboard). Off-origin values are dropped by safeNextPath. For the v2 door the route
  // computes the target itself and keeps it as long as the link works.
  const safeNext = v2
    ? typeof claimCheckId === 'string'
      ? claimNext(claimCheckId)
      : DASHBOARD
    : safeNextPath(parsed.data.next);
  if (safeNext) {
    res.cookies.set(COOKIES.next, safeNext, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secure(),
      maxAge: v2 ? AUTH_LINK_SECONDS : V1_NEXT_COOKIE_SECONDS,
      path: '/',
    });
  } else {
    // The binding below makes this address the one the browser asked for; an earlier request's
    // return target must not ride along into its account.
    res.cookies.set(COOKIES.next, '', { path: '/', maxAge: 0 });
  }

  // Every request binds this browser to the address it asked for, door or not (A-8): /login/verify
  // claims this browser's anonymous audits only for a link to that address, so someone else's link
  // opened here signs in without taking them. A hash, never the address.
  res.cookies.set(COOKIES.binding, emailBinding(email), {
    httpOnly: true,
    sameSite: 'lax',
    secure: secure(),
    maxAge: AUTH_LINK_SECONDS,
    path: '/',
  });

  if (!v2) {
    // Likewise an earlier door request's named site (the door path below replaces or clears it).
    res.cookies.set(COOKIES.signup, '', { path: '/', maxAge: 0 });
  } else {
    const carry: SignupCarry = {};
    if (host) carry.site = host;
    if (zone) carry.tz = zone;
    if (carry.site || carry.tz) {
      res.cookies.set(COOKIES.signup, encodeSignup(carry), {
        httpOnly: true,
        sameSite: 'lax',
        secure: secure(),
        maxAge: AUTH_LINK_SECONDS,
        path: '/',
      });
    } else {
      // A request that names nothing replaces an earlier one's ask, which the binding now disowns.
      res.cookies.set(COOKIES.signup, '', { path: '/', maxAge: 0 });
    }
  }
  // The ledger's device signal, for every sign-in while the door is on: a sign-up through v1's
  // /login, or a resend without the door's fields, reaches first login too.
  if (door && !requestCookie(req, COOKIES.device)) {
    res.cookies.set(COOKIES.device, randomBytes(32).toString('base64url'), {
      httpOnly: true,
      sameSite: 'lax',
      secure: secure(),
      maxAge: DEVICE_COOKIE_SECONDS,
      path: '/',
    });
  }
  return res;
}
