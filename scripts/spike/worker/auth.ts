import { createHmac, timingSafeEqual } from 'node:crypto';

/** The window on our own internal call (ARCH-2 4.4). Not applied to any third-party webhook. */
export const MAX_SKEW_MS = 5 * 60_000;

export type AuthFailure = 'bad_ts' | 'stale_ts' | 'bad_signature';

function hmacHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function checkTs(ts: string, now: number): AuthFailure | null {
  if (!/^\d{1,15}$/.test(ts)) return 'bad_ts';
  return Math.abs(now - Number(ts)) > MAX_SKEW_MS ? 'stale_ts' : null;
}

export interface BatchSignInput {
  ts: string;
  checkId: string;
  batch: number;
  nonce: string;
  body: string;
  secret: string;
}

/** hmac-sha256(ts + '.' + checkId + '.' + batch + '.' + nonce + '.' + body), hex. */
export function signBatch(i: BatchSignInput): string {
  return hmacHex(i.secret, `${i.ts}.${i.checkId}.${i.batch}.${i.nonce}.${i.body}`);
}

export function verifyBatch(
  i: BatchSignInput & { signature: string; now: number },
): { ok: true } | { ok: false; reason: AuthFailure } {
  const tsProblem = checkTs(i.ts, i.now);
  if (tsProblem) return { ok: false, reason: tsProblem };
  return safeEqualHex(i.signature, signBatch(i)) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

/** Same scheme for read-only endpoints: hmac-sha256(ts + '.' + purpose). */
export function signTs(i: { ts: string; purpose: string; secret: string }): string {
  return hmacHex(i.secret, `${i.ts}.${i.purpose}`);
}

export function verifyTs(
  i: { ts: string; purpose: string; signature: string; secret: string; now: number },
): { ok: true } | { ok: false; reason: AuthFailure } {
  const tsProblem = checkTs(i.ts, i.now);
  if (tsProblem) return { ok: false, reason: tsProblem };
  return safeEqualHex(i.signature, signTs(i)) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

export interface NonceStoreOptions {
  ttlMs: number;
  now: () => number;
  maxEntries?: number;
}

/**
 * Single-use nonces. The ttl must outlive the signature window, otherwise a captured request could be
 * replayed after its nonce was forgotten but while its timestamp still verifies.
 */
export class NonceStore {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(opts: NonceStoreOptions) {
    if (opts.ttlMs < MAX_SKEW_MS) throw new Error('NonceStore ttl must be at least the signature window');
    this.ttlMs = opts.ttlMs;
    this.now = opts.now;
    this.maxEntries = opts.maxEntries ?? 10_000;
  }

  /** True the first time a nonce is presented within the ttl; false on every repeat. */
  claim(nonce: string): boolean {
    const t = this.now();
    for (const [k, at] of this.seen) {
      if (t - at > this.ttlMs) this.seen.delete(k);
      else break; // insertion order is time order
    }
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, t);
    while (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
    return true;
  }

  size(): number {
    return this.seen.size;
  }
}

export interface BatchClaims {
  check_id: string;
  batch: number;
  nonce: string;
  role: 'crawl_worker';
  iat?: number;
  exp?: number;
}

const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url');

/** HS256 only. */
export function signJwt(claims: Record<string, unknown>, secret: string): string {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64(claims);
  const sig = createHmac('sha256', secret).update(`${head}.${payload}`).digest('base64url');
  return `${head}.${payload}.${sig}`;
}

export type JwtFailure = 'malformed' | 'bad_alg' | 'bad_signature' | 'expired' | 'wrong_role' | 'claim_mismatch';

export function verifyJwt(
  token: string,
  secret: string,
  opts: { now: number; expect: { check_id: string; batch: number; nonce: string } },
): { ok: true; claims: BatchClaims } | { ok: false; reason: JwtFailure } {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: unknown };
  let claims: Partial<BatchClaims>;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (header.alg !== 'HS256') return { ok: false, reason: 'bad_alg' };
  const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'bad_signature' };
  if (typeof claims.exp !== 'number' || opts.now >= claims.exp * 1000) return { ok: false, reason: 'expired' };
  if (claims.role !== 'crawl_worker') return { ok: false, reason: 'wrong_role' };
  const e = opts.expect;
  if (claims.check_id !== e.check_id || claims.batch !== e.batch || claims.nonce !== e.nonce) {
    return { ok: false, reason: 'claim_mismatch' };
  }
  return { ok: true, claims: claims as BatchClaims };
}

/** Claims-only decode for the stub path when the worker holds no JWT secret. Trusts nothing. */
export function decodeJwtClaimsUnverified(token: string): Partial<BatchClaims> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
