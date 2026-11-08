/**
 * What the sign-in POST does after Supabase has verified the link and set the session, when the v2
 * door is on: the first-login hook, then the claim a Keep asked for, then where to land.
 *
 * A failure here never fails the sign-in: the session is already set, so the person lands on the
 * dashboard and the failure goes to Sentry (account id only).
 */
import { claimCheck, type ClaimDeps } from './claim';
import {
  claimFromNext,
  claimRefusedDest,
  DASHBOARD,
  emailBinding,
  type SignupCarry,
} from './continue-intent';
import type { Report } from './door-store';
import { runFirstLogin, type DoorEvent, type FirstLoginDeps } from './first-login';

export interface SignedInUser {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
}

export interface LandingInput {
  user: SignedInUser;
  /** The `post_login_next` cookie, unvalidated. */
  next: string | undefined;
  /** The `cm_auth_for` cookie: whom the door request that set `next` and `signup` was for. */
  boundTo: string | undefined;
  signup: SignupCarry | null;
  device: string | null;
  ip: string;
}

export interface Landing {
  /** A same-origin path, or null for "the v1 rule decides" (the validated `next`, else /dashboard). */
  dest: string | null;
  events: DoorEvent[];
}

export async function afterSignIn(
  deps: { firstLogin: FirstLoginDeps; claim: ClaimDeps; report: Report },
  input: LandingInput,
): Promise<Landing> {
  const events: DoorEvent[] = [];
  const { user } = input;
  // The named site and a Keep's claim were asked for by one address; they count only when the link
  // signed that address in (not someone else's link opened in the same browser).
  const bound =
    input.boundTo !== undefined &&
    user.email !== undefined &&
    input.boundTo === emailBinding(user.email);
  if (user.email) {
    try {
      const r = await runFirstLogin(deps.firstLogin, {
        userId: user.id,
        email: user.email,
        emailConfirmedAt: user.email_confirmed_at ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
        device: input.device,
        ip: input.ip,
        signup: bound ? input.signup : null,
      });
      events.push(...r.events);
    } catch {
      deps.report('first-login-failed', { userId: user.id });
    }
  }

  const checkId = bound ? claimFromNext(input.next) : null;
  if (checkId === null) return { dest: null, events };
  try {
    const claimed = await claimCheck(deps.claim, { checkId, userId: user.id });
    return { dest: claimed.ok ? DASHBOARD : claimRefusedDest(claimed.code), events };
  } catch {
    deps.report('claim-failed', { userId: user.id });
    return { dest: claimRefusedDest('failed'), events };
  }
}
