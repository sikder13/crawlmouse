import { verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { IdSchema } from '@crawlmouse/types/v2';

/**
 * The per-batch JWT. The app signs it with its Ed25519 private key; the worker holds only the public
 * key, so nothing on the worker can mint one. Its claims name exactly one check and one site, and the
 * batch they are for; server.ts refuses a batch whose body or URLs fall outside them.
 */

export const JWT_AUDIENCE = 'crawlmouse-worker';
export const MAX_JWT_LIFETIME_S = 60 * 60;
/** A token issued this far in the worker's future is still accepted, for clock skew. */
export const IAT_SKEW_S = 60;
/** The header fields a batch JWT may carry. */
const HEADER_FIELDS = new Set(['alg', 'typ', 'kid']);

export const BatchClaimsSchema = z.strictObject({
  aud: z.literal(JWT_AUDIENCE),
  role: z.literal('crawl_worker'),
  check_id: IdSchema,
  site_id: IdSchema,
  /** The site's host, lower case, no port. */
  site_host: z
    .string()
    .max(253)
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/),
  batch: z.int().min(0),
  nonce: z.string().min(1).max(128),
  iat: z.int(),
  exp: z.int(),
});

export type BatchClaims = z.infer<typeof BatchClaimsSchema>;

export type JwtFailure =
  | 'malformed'
  | 'bad_alg'
  | 'bad_signature'
  | 'bad_claims'
  | 'expired'
  | 'not_yet_valid'
  | 'too_long_lived';

/** JSON.parse that refuses an own `__proto__` key, which zod would silently drop. */
export function parseJsonStrict(text: string): unknown {
  return JSON.parse(text, (key, value: unknown) => {
    if (key === '__proto__') throw new Error('__proto__ key');
    return value;
  });
}

function decodePart(part: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('not base64url');
  return parseJsonStrict(Buffer.from(part, 'base64url').toString('utf8'));
}

export function verifyBatchJwt(
  token: string,
  publicKey: KeyObject,
  nowMs: number,
): { ok: true; claims: BatchClaims } | { ok: false; reason: JwtFailure } {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [h, p, s] = parts as [string, string, string];
  let header: unknown;
  let payload: unknown;
  try {
    header = decodePart(h);
    payload = decodePart(p);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const fields = header as Record<string, unknown> | null;
  if (typeof fields !== 'object' || fields === null || fields.alg !== 'EdDSA') {
    return { ok: false, reason: 'bad_alg' };
  }
  // A header field the worker does not understand (`crit` among them, RFC 7515) is refused, not ignored.
  if (Object.keys(fields).some((k) => !HEADER_FIELDS.has(k)))
    return { ok: false, reason: 'malformed' };
  const signature = Buffer.from(s, 'base64url');
  if (signature.length !== 64 || !verify(null, Buffer.from(`${h}.${p}`), publicKey, signature)) {
    return { ok: false, reason: 'bad_signature' };
  }
  const claims = BatchClaimsSchema.safeParse(payload);
  if (!claims.success) return { ok: false, reason: 'bad_claims' };
  const now = Math.floor(nowMs / 1000);
  const c = claims.data;
  if (c.exp <= now) return { ok: false, reason: 'expired' };
  if (c.iat > now + IAT_SKEW_S) return { ok: false, reason: 'not_yet_valid' };
  if (c.exp - c.iat > MAX_JWT_LIFETIME_S) return { ok: false, reason: 'too_long_lived' };
  return { ok: true, claims: c };
}
