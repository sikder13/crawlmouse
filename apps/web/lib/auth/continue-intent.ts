/**
 * What rides the one-shot cookies between the magic-link request and the sign-in POST. Every value
 * is re-validated when it is read: a cookie is the caller's to set.
 */
import { createHash } from 'node:crypto';
import { safeNextPath } from '../safe-next-path';

/** Where a sign-in from the v2 door lands. */
export const DASHBOARD = '/dashboard';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLAIM_NEXT = /^\/api\/checks\/([0-9a-f-]{36})\/claim\?then=\/dashboard$/;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

/** The address a magic-link request was made for, as `cm_auth_for` holds it: a hash, never the address. */
export function emailBinding(email: string): string {
  return createHash('sha256').update(`cm-auth-for:${email.trim().toLowerCase()}`).digest('hex');
}

/**
 * The link signed in an address other than the one this browser's magic-link request was for:
 * someone else's link opened here (login CSRF). CC-06c D9: such a sign-in records no device for the
 * trial ledger. With no `cm_auth_for` this is false (nothing is known either way, as for a link opened
 * on another device), so the device rule still records it; the anonymous-audit claim asks the
 * stricter `bindingMatches` instead (A-8).
 */
export function bindingMismatch(boundTo: string | undefined, email: string | undefined): boolean {
  return boundTo !== undefined && (email === undefined || boundTo !== emailBinding(email));
}

/**
 * The link signed in the address this browser asked for: `cm_auth_for` is present and is that
 * address's binding. Only then are this browser's anonymous v1 audits claimed (A-8). With no binding
 * the browser asked for no link (or asked on another device), so the audits stay where they are.
 */
export function bindingMatches(boundTo: string | undefined, email: string | undefined): boolean {
  return boundTo !== undefined && email !== undefined && boundTo === emailBinding(email);
}

/** A Keep's return target (D8): the claim, then the dashboard. */
export function claimNext(checkId: string): string {
  if (!isUuid(checkId)) throw new RangeError('a check id is a uuid');
  return `/api/checks/${checkId}/claim?then=${DASHBOARD}`;
}

/** The check a `post_login_next` value asks to claim, or null when it is any other target. */
export function claimFromNext(next: string | null | undefined): string | null {
  const safe = safeNextPath(next);
  const m = safe === null ? null : CLAIM_NEXT.exec(safe);
  return m && isUuid(m[1]) ? m[1] : null;
}

/** Where a sign-in lands after a claim the landing could not make. CC-26 renders the code. */
export function claimRefusedDest(code: string): string {
  return `${DASHBOARD}?claim=${encodeURIComponent(code)}`;
}

/** The sign-in link's token, between GET and POST. */
export type OtpCarry =
  | { kind: 'token_hash'; value: string; type: 'magiclink' | 'signup' | 'email' }
  | { kind: 'code'; value: string };

const OTP_TYPES = new Set(['magiclink', 'signup', 'email']);
const MAX_TOKEN = 2048;

export function encodeOtp(carry: OtpCarry): string {
  return JSON.stringify(carry);
}

export function decodeOtp(raw: string | undefined): OtpCarry | null {
  const v = parseJson(raw);
  if (
    v === null ||
    typeof v.value !== 'string' ||
    v.value.length === 0 ||
    v.value.length > MAX_TOKEN
  ) {
    return null;
  }
  if (v.kind === 'code') return { kind: 'code', value: v.value };
  if (v.kind === 'token_hash') {
    const type = typeof v.type === 'string' && OTP_TYPES.has(v.type) ? v.type : 'magiclink';
    return { kind: 'token_hash', value: v.value, type: type as 'magiclink' | 'signup' | 'email' };
  }
  return null;
}

/** The Sign-up form's ask: strings only, shape-checked by the first-login hook when it is used. */
export interface SignupCarry {
  site?: string;
  tz?: string;
}

const MAX_SIGNUP_FIELD = 256;

export function encodeSignup(carry: SignupCarry): string {
  return JSON.stringify(carry);
}

export function decodeSignup(raw: string | undefined): SignupCarry | null {
  const v = parseJson(raw);
  if (v === null) return null;
  const out: SignupCarry = {};
  for (const key of ['site', 'tz'] as const) {
    const field = v[key];
    if (typeof field === 'string' && field.length > 0 && field.length <= MAX_SIGNUP_FIELD)
      out[key] = field;
  }
  return out;
}

function parseJson(raw: string | undefined): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v !== null && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
