import { createHmac } from 'node:crypto';

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
