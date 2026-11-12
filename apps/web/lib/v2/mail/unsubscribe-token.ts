/**
 * The unsubscribe link's token (D7, owner ruling Q11): it names one seat and one kind, expires, and is
 * signed with HMAC-SHA256 under `EMAIL_LINK_SECRET` (Q6), so the endpoint needs no sign-in and a token
 * cannot be made for another seat or kind. Form: `<payload>.<signature>`, both base64url; the payload is
 * `{"s": seat id, "k": kind, "x": expiry in epoch seconds}`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { UnsubscribeKind } from './types';

type Env = Readonly<Record<string, string | undefined>>;

/** How long a link works: long enough for an old message, as RFC 8058 one-click expects. */
export const UNSUBSCRIBE_TTL_DAYS = 90;
/** A secret shorter than this is treated as unset. */
export const MIN_SECRET_LENGTH = 32;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KINDS: ReadonlySet<string> = new Set<UnsubscribeKind>(['alerts', 'summary']);

export function linkSecret(env: Env = process.env): string | null {
  const s = env.EMAIL_LINK_SECRET?.trim() ?? '';
  return s.length >= MIN_SECRET_LENGTH ? s : null;
}

const sign = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(`unsubscribe:${payload}`).digest('base64url');

export function signUnsubscribe(
  secret: string,
  seatId: string,
  kind: UnsubscribeKind,
  now: Date,
  ttlDays = UNSUBSCRIBE_TTL_DAYS,
): string {
  if (!UUID.test(seatId)) throw new RangeError('not a seat id');
  const x = Math.floor(now.getTime() / 1000) + ttlDays * 86_400;
  const payload = Buffer.from(JSON.stringify({ s: seatId, k: kind, x })).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

export type Verified =
  | { ok: true; seatId: string; kind: UnsubscribeKind }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyUnsubscribe(secret: string, token: string, now: Date): Verified {
  if (token.length > 512) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (
    parts.length !== 2 ||
    !/^[A-Za-z0-9_-]+$/.test(parts[0]!) ||
    !/^[A-Za-z0-9_-]+$/.test(parts[1]!)
  ) {
    return { ok: false, reason: 'malformed' };
  }
  const [payload, mac] = parts as [string, string];
  const want = Buffer.from(sign(secret, payload));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got))
    return { ok: false, reason: 'bad_signature' };
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const b = body as { s?: unknown; k?: unknown; x?: unknown };
  if (
    typeof b.s !== 'string' ||
    !UUID.test(b.s) ||
    typeof b.k !== 'string' ||
    !KINDS.has(b.k) ||
    typeof b.x !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (b.x * 1000 <= now.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true, seatId: b.s, kind: b.k as UnsubscribeKind };
}
