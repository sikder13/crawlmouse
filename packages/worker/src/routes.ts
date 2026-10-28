/**
 * The worker's routes and every refusal it can answer with, as data the spec renders. server.ts takes
 * each refusal's status from REFUSALS; ROUTES describes the routes server.ts dispatches, and
 * server.test.ts exercises each of them.
 */

export interface Route {
  method: 'GET' | 'POST';
  path: string;
  auth: string;
  answers: string;
}

export const ROUTES: readonly Route[] = [
  { method: 'GET', path: '/healthz', auth: 'none', answers: '200 `{"ok":true}`; reads no state' },
  {
    method: 'POST',
    path: '/batch',
    auth: 'HMAC over `ts.` and the raw body; single-use nonce; per-batch Ed25519 JWT',
    answers: '202 `{"batch_id"}`; the batch runs after the response',
  },
  {
    method: 'GET',
    path: '/batch/{batch_id}',
    auth: 'HMAC over `ts.batch:{batch_id}`',
    answers:
      '200 `running` with progress, `done` with the result, or `failed`; 404 unknown or expired',
  },
  {
    method: 'GET',
    path: '/metrics',
    auth: 'HMAC over `ts.metrics`',
    answers: '200 memory, event-loop lag p99, batches running, requests per site',
  },
];

export const REFUSALS = {
  not_found: {
    status: 404,
    when: 'no such route, or no such batch (unknown, or forgotten after its TTL)',
  },
  too_large: { status: 413, when: 'the request body is over the size limit (see Limits)' },
  invalid_json: { status: 400, when: 'the body is not JSON, or has a `__proto__` key' },
  invalid_body: {
    status: 400,
    when: 'the body does not match the batch schema; budgets missing included',
  },
  bad_ts: { status: 401, when: '`x-crawlmouse-ts` is not a millisecond timestamp' },
  stale_ts: { status: 401, when: 'the timestamp is outside the signature window (see Limits)' },
  bad_signature: { status: 401, when: 'the HMAC does not match' },
  paused: { status: 503, when: 'CRAWL_PAUSED=1 on the worker' },
  jwt_invalid: {
    status: 401,
    when: 'the JWT is malformed, not EdDSA, wrongly signed, expired, or has claims outside the schema',
  },
  jwt_scope: {
    status: 403,
    when: 'the JWT names another check, site, batch or nonce, or a URL is not on its site host and default port',
  },
  busy: { status: 429, when: 'the worker is already running its maximum number of batches' },
  batch_exists: { status: 409, when: 'this check_id and batch were accepted already' },
  nonce_replayed: { status: 409, when: 'this nonce was used already' },
} as const satisfies Record<string, { status: number; when: string }>;

export type Refusal = keyof typeof REFUSALS;
