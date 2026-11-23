import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The HMAC the crawl worker checks on every signed route (packages/worker/src/auth/hmac.ts):
 *
 *   POST /batch   hex HMAC-SHA256(secret, `${ts}.` followed by the body's raw bytes)
 *   GET  routes   hex HMAC-SHA256(secret, `${ts}.${purpose}`); purpose `metrics` or `batch:{id}`
 *
 * `ts` is the `x-crawlmouse-ts` header as sent: milliseconds since the epoch, in decimal.
 */

export const TS_HEADER = 'x-crawlmouse-ts';
export const SIGNATURE_HEADER = 'x-crawlmouse-signature';

/** A string body is signed as its UTF-8 bytes; send those same bytes. */
export const signBody = (secret: string, ts: string, raw: string | Uint8Array): string =>
  createHmac('sha256', secret).update(`${ts}.`).update(raw).digest('hex');

export const signRead = (secret: string, ts: string, purpose: string): string =>
  createHmac('sha256', secret).update(`${ts}.${purpose}`).digest('hex');

/** How far a signal's timestamp may be from the app's clock, either way: the worker's own window. */
export const SIGNAL_MAX_SKEW_MS = 5 * 60_000;

/** The worker's "this batch ended" call: its own context, so no batch or read signature fits it. */
export const signSignal = (secret: string, ts: string, raw: string): string =>
  signRead(secret, ts, `signal:${raw}`);

/** Whether a signal is the worker's, and recent. Compared in constant time. */
export function verifySignal(
  secret: string,
  ts: string,
  raw: string,
  signature: string,
  now: number,
): boolean {
  if (!/^\d{1,15}$/.test(ts) || Math.abs(now - Number(ts)) > SIGNAL_MAX_SKEW_MS) return false;
  const expected = signSignal(secret, ts, raw);
  if (!/^[0-9a-f]+$/i.test(signature) || signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}
