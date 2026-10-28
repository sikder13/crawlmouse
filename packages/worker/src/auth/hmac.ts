import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Request signatures from the app. Every route but /healthz is signed with the shared secret:
 *
 *   POST /batch   hmac-sha256(secret, `${ts}.${check_id}.${batch}.${nonce}.${body}`), hex
 *   GET  routes   hmac-sha256(secret, `${ts}.${purpose}`), hex; purpose `metrics` or `batch:{id}`
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

function tsProblem(ts: string, now: number): SignatureFailure | null {
  if (!/^\d{1,15}$/.test(ts)) return 'bad_ts';
  return Math.abs(now - Number(ts)) > MAX_SKEW_MS ? 'stale_ts' : null;
}

export interface BatchSigned {
  ts: string;
  checkId: string;
  batch: number;
  nonce: string;
  body: string;
}

export const signBatch = (secret: string, m: BatchSigned): string =>
  hmacHex(secret, `${m.ts}.${m.checkId}.${m.batch}.${m.nonce}.${m.body}`);

export const signRead = (secret: string, ts: string, purpose: string): string =>
  hmacHex(secret, `${ts}.${purpose}`);

export function verifyBatchSignature(
  secret: string,
  m: BatchSigned,
  signature: string,
  now: number,
): SignatureFailure | null {
  return (
    tsProblem(m.ts, now) ?? (equalHex(signature, signBatch(secret, m)) ? null : 'bad_signature')
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
