import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Request signatures from the app. Every route but /healthz is signed with the shared secret:
 *
 *   POST /batch   hmac-sha256(secret, `${ts}.` followed by the body's raw bytes), hex
 *   GET  routes   hmac-sha256(secret, `${ts}.${purpose}`), hex; purpose `metrics` or `batch:{id}`
 *
 * The batch's check_id, batch number and nonce are fields of the body, so the signature covers them.
 * It is checked on the bytes as received, before the body is decoded or parsed: an unsigned request
 * costs one HMAC, whatever it holds.
 *
 * `ts` is milliseconds since the epoch, in the `x-crawlmouse-ts` header, and must be within
 * MAX_SKEW_MS of the worker's clock either way. The signature is in `x-crawlmouse-signature`.
 */

export const MAX_SKEW_MS = 5 * 60_000;
export const TS_HEADER = 'x-crawlmouse-ts';
export const SIGNATURE_HEADER = 'x-crawlmouse-signature';

export type SignatureFailure = 'bad_ts' | 'stale_ts' | 'bad_signature';

const hmacHex = (secret: string, message: string): string =>
  createHmac('sha256', secret).update(message).digest('hex');

function equalHex(given: string, expected: string): boolean {
  if (!/^[0-9a-f]+$/i.test(given) || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
}

/** Why a timestamp cannot pass, if it cannot. */
export function tsProblem(ts: string, now: number): SignatureFailure | null {
  if (!/^\d{1,15}$/.test(ts)) return 'bad_ts';
  return Math.abs(now - Number(ts)) > MAX_SKEW_MS ? 'stale_ts' : null;
}

/** A string body is signed as its UTF-8 bytes. */
export const signBatch = (secret: string, ts: string, body: Buffer | string): string =>
  createHmac('sha256', secret).update(`${ts}.`).update(body).digest('hex');

export const signRead = (secret: string, ts: string, purpose: string): string =>
  hmacHex(secret, `${ts}.${purpose}`);

export function verifyBatchSignature(
  secret: string,
  ts: string,
  body: Buffer | string,
  signature: string,
  now: number,
): SignatureFailure | null {
  return (
    tsProblem(ts, now) ??
    (equalHex(signature, signBatch(secret, ts, body)) ? null : 'bad_signature')
  );
}

export function verifyReadSignature(
  secret: string,
  ts: string,
  purpose: string,
  signature: string,
  now: number,
): SignatureFailure | null {
  return (
    tsProblem(ts, now) ??
    (equalHex(signature, signRead(secret, ts, purpose)) ? null : 'bad_signature')
  );
}

/** POST /render/measure's body digest (SHA-256, lowercase hex) and length in bytes, both signed. */
export const BODY_SHA256_HEADER = 'x-crawlmouse-body-sha256';
export const BODY_BYTES_HEADER = 'x-crawlmouse-body-bytes';

/**
 * POST /render/measure is signed under a key of its own derived from the shared secret, as the done
 * signal is, so a batch, read or signal signature is never accepted for it, nor the reverse. The label
 * does not start with digits and a dot, so no `${ts}.…` signature can equal the derived key. Same rule
 * as apps/web/lib/worker-client/sign.ts.
 *
 * It signs `${ts}.${sha256}.${bytes}`, the body's digest and length, not the body itself, so the route
 * can refuse a request that is not ours from its headers alone: before it reads a byte of a body of up
 * to 20 MiB, and before the request takes a measuring slot. The body is then held to that digest and
 * length.
 */
const MEASURE_KEY_LABEL = 'crawlmouse-worker-measure-v1';

export const signMeasure = (secret: string, ts: string, sha256: string, bytes: number): string => {
  const key = createHmac('sha256', secret).update(MEASURE_KEY_LABEL).digest();
  return createHmac('sha256', key).update(`${ts}.${sha256}.${bytes}`).digest('hex');
};

export const sha256Hex = (body: Uint8Array): string =>
  createHash('sha256').update(body).digest('hex');

export function verifyMeasureSignature(
  secret: string,
  ts: string,
  sha256: string,
  bytes: number,
  signature: string,
  now: number,
): SignatureFailure | null {
  return (
    tsProblem(ts, now) ??
    (equalHex(signature, signMeasure(secret, ts, sha256, bytes)) ? null : 'bad_signature')
  );
}
