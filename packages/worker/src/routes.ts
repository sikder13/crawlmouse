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
    path: '/batch/{batch_id}/progress?after={n}',
    auth: 'HMAC over `ts.progress:{batch_id}`',
    answers:
      '200 `running` with progress and up to 25 finished pages from `after`, `done` or `failed`, never the result; 404 unknown or expired',
  },
  {
    method: 'POST',
    path: '/render/measure',
    auth: "HMAC over `ts.{sha256}.{bytes}`, the body's SHA-256 and length sent in `x-crawlmouse-body-sha256` and `x-crawlmouse-body-bytes`, under a key derived for this route from the shared secret; checked before the body is read, and the body is then held to both",
    answers:
      '200 `{"reading"}` (each render\'s words, whether either is a challenge, the links only the rendered side has) or `{"failed"}` when the measure thread passed its deadline, died, or threw; nothing is stored',
  },
  {
    method: 'GET',
    path: '/metrics',
    auth: 'HMAC over `ts.metrics`',
    answers: '200 memory, event-loop lag p99, batches running, requests per site, reader restarts',
  },
];

export const REFUSALS = {
  not_found: {
    status: 404,
    when: 'no such route, or no such batch (unknown, or forgotten after its TTL)',
  },
  too_large: { status: 413, when: 'the request body is over the size limit (see Limits)' },
  body_timeout: {
    status: 408,
    when: 'the request body did not arrive within the body deadline (see Limits)',
  },
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
  measure_busy: {
    status: 429,
    when: 'the worker is already measuring its maximum number of rendered pages',
  },
  reader_unavailable: {
    status: 503,
    when: 'the worker has no measure thread to read a rendered page on',
  },
  batch_exists: { status: 409, when: 'this check_id and batch were accepted already' },
  nonce_replayed: { status: 409, when: 'this nonce was used already' },
} as const satisfies Record<string, { status: number; when: string }>;

export type Refusal = keyof typeof REFUSALS;
