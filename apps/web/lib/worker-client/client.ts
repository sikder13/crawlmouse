/**
 * The app's client for the crawl worker (CC-20b D2; the routes are SPEC 12's). It signs every request
 * with the shared HMAC secret, mints each batch's JWT with the app's Ed25519 key, and turns every
 * answer that is not the one asked for into a WorkerError. The error is built from the kind, the HTTP
 * status and a code looked up in WORKER_REFUSALS, so no header, body, JWT or key goes into it.
 */
import type { KeyObject } from 'node:crypto';
import { loadPrivateKey, mintBatchJwt, PRIVATE_KEY_ENV } from './jwt';
import { SIGNATURE_HEADER, TS_HEADER, signBody, signRead } from './sign';
import {
  batchIdOf,
  WorkerError,
  type BatchPost,
  type PollResult,
  type WorkerClient,
  type WorkerErrorKind,
} from './types';

export const WORKER_URL_ENV = 'CRAWL_WORKER_URL';
export const SIGNING_SECRET_ENV = 'WORKER_SIGNING_SECRET';
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The worker's refusals (packages/worker/src/routes.ts REFUSALS, plus server.ts's 500 `internal`),
 * each with its status and what it means here. An answer's code is kept only when it is listed with
 * that answer's status. `not_found` on a poll is a PollResult; anywhere else it means the URL does not
 * reach the worker's routes, so it is `server`.
 */
export const WORKER_REFUSALS: ReadonlyMap<string, { status: number; kind: WorkerErrorKind }> =
  new Map([
    ['busy', { status: 429, kind: 'busy' }],
    ['batch_exists', { status: 409, kind: 'batch_exists' }],
    ['nonce_replayed', { status: 409, kind: 'nonce_replayed' }],
    ['paused', { status: 503, kind: 'paused' }],
    ['bad_ts', { status: 401, kind: 'unauthorized' }],
    ['stale_ts', { status: 401, kind: 'unauthorized' }],
    ['bad_signature', { status: 401, kind: 'unauthorized' }],
    ['jwt_invalid', { status: 401, kind: 'unauthorized' }],
    ['jwt_scope', { status: 403, kind: 'forbidden' }],
    ['invalid_json', { status: 400, kind: 'invalid' }],
    ['invalid_body', { status: 400, kind: 'invalid' }],
    ['body_timeout', { status: 408, kind: 'timeout' }],
    ['too_large', { status: 413, kind: 'too_large' }],
    ['not_found', { status: 404, kind: 'server' }],
    ['internal', { status: 500, kind: 'server' }],
  ]);

/**
 * The kind of an answer that carries no code of the worker's, from a proxy in front of it for
 * instance. A 503 or a 409 without the worker's code is `server`, not `paused` or a duplicate.
 */
function kindOfStatus(status: number): WorkerErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 400) return 'invalid';
  // The body did not arrive in time: refused before the nonce was spent, so sending it again is safe.
  if (status === 408) return 'timeout';
  if (status === 413) return 'too_large';
  if (status === 429) return 'busy';
  return 'server';
}

/** The ids the worker's GET route matches (packages/worker/src/server.ts BATCH_ID). */
const ROUTABLE_BATCH_ID = /^[0-9a-f-]{36}:\d{1,7}$/;

export interface WorkerClientOptions {
  /** The worker's base URL, no trailing slash. */
  url: string;
  signingSecret: string;
  /** The app's Ed25519 private key, which signs each batch's JWT. */
  privateKey: KeyObject;
  fetch?: typeof fetch;
  /** Milliseconds since the epoch. */
  now?: () => number;
  /** Per request, from sending it to reading the whole answer. */
  timeoutMs?: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isAbort = (e: unknown): boolean =>
  isRecord(e) && (e.name === 'TimeoutError' || e.name === 'AbortError');

function checkedBase(url: string): string {
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    // Refused below, without the value.
  }
  if (
    !parsed ||
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      `${WORKER_URL_ENV} must be an http(s) URL with no credentials, query or fragment`,
    );
  }
  // A signed request carries its JWT in the body: in clear it could be replayed within the signature
  // window. Plain http is for a worker on this machine (the tests, a local worker) only.
  if (parsed.protocol === 'http:' && !LOOPBACK.has(parsed.hostname)) {
    throw new Error(`${WORKER_URL_ENV} must be https unless the worker is on this machine`);
  }
  return url;
}

/** Hostnames that name this machine, as URL parses them (an IPv6 literal keeps its brackets). */
const LOOPBACK: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

export function createWorkerClient(opts: WorkerClientOptions): WorkerClient {
  const base = checkedBase(opts.url);
  if (!opts.signingSecret) throw new Error(`${SIGNING_SECRET_ENV} is empty`);
  if (opts.privateKey.type !== 'private' || opts.privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('the worker client needs an Ed25519 private key');
  }
  const fetchImpl = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** One request; its signal also bounds reading the answer's body. Redirects are not followed. */
  async function send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(`${base}${path}`, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new WorkerError(isAbort(e) ? 'timeout' : 'network', null, null);
    }
  }

  /** The answer's body as JSON; undefined when it is not JSON. */
  async function bodyOf(res: Response): Promise<unknown> {
    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      throw new WorkerError(isAbort(e) ? 'timeout' : 'network', res.status, null);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }

  async function refusalOf(res: Response): Promise<WorkerError> {
    const body = await bodyOf(res);
    const code = isRecord(body) && typeof body.error === 'string' ? body.error : null;
    const known = code === null ? undefined : WORKER_REFUSALS.get(code);
    return known && known.status === res.status
      ? new WorkerError(known.kind, res.status, code)
      : new WorkerError(kindOfStatus(res.status), res.status, null);
  }

  function signedGet(path: string, purpose: string): Promise<Response> {
    const ts = String(now());
    return send(path, {
      method: 'GET',
      headers: { [TS_HEADER]: ts, [SIGNATURE_HEADER]: signRead(opts.signingSecret, ts, purpose) },
    });
  }

  async function postBatch(batch: BatchPost): Promise<{ batch_id: string }> {
    const batchId = batchIdOf(batch.check_id, batch.batch);
    if (!ROUTABLE_BATCH_ID.test(batchId)) throw new WorkerError('invalid', null, null);
    const at = now();
    let jwt: string;
    try {
      jwt = mintBatchJwt(opts.privateKey, batch, at);
    } catch {
      throw new WorkerError('invalid', null, null);
    }
    // The worker's strict body, field by field: `site_host` is the JWT's alone, and nothing else the
    // caller's object holds is sent.
    const common = {
      kind: batch.kind,
      check_id: batch.check_id,
      site_id: batch.site_id,
      batch: batch.batch,
      nonce: batch.nonce,
      jwt,
      budget: {
        max_requests: batch.budget.max_requests,
        max_bytes: batch.budget.max_bytes,
        max_seconds: batch.budget.max_seconds,
      },
    };
    const body =
      batch.kind === 'crawl'
        ? { ...common, urls: [...batch.urls] }
        : {
            ...common,
            pages: batch.pages.map((p) => ({ url: p.url, template_key: p.template_key })),
          };
    // Serialised once: these bytes are the ones signed and the ones sent.
    const raw = new TextEncoder().encode(JSON.stringify(body));
    const ts = String(at);
    const res = await send('/batch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [TS_HEADER]: ts,
        [SIGNATURE_HEADER]: signBody(opts.signingSecret, ts, raw),
      },
      body: raw,
    });
    if (res.status !== 202) throw await refusalOf(res);
    const accepted = await bodyOf(res);
    if (!isRecord(accepted) || accepted.batch_id !== batchId) {
      throw new WorkerError('server', res.status, null);
    }
    return { batch_id: batchId };
  }

  async function pollBatch(batchId: string): Promise<PollResult> {
    if (!ROUTABLE_BATCH_ID.test(batchId)) throw new WorkerError('invalid', null, null);
    const res = await signedGet(`/batch/${batchId}`, `batch:${batchId}`);
    if (res.status !== 200) {
      const refusal = await refusalOf(res);
      if (refusal.code === 'not_found') return { status: 'not_found' };
      throw refusal;
    }
    const answer = await bodyOf(res);
    if (isRecord(answer) && answer.batch_id === batchId) {
      if (answer.status === 'running') return { status: 'running', progress: answer.progress };
      if (answer.status === 'done' && 'result' in answer) {
        return { status: 'done', result: answer.result };
      }
      if (answer.status === 'failed') return { status: 'failed' };
    }
    throw new WorkerError('server', res.status, null);
  }

  async function readMetrics(): Promise<unknown> {
    const res = await signedGet('/metrics', 'metrics');
    if (res.status !== 200) throw await refusalOf(res);
    const metrics = await bodyOf(res);
    if (metrics === undefined) throw new WorkerError('server', res.status, null);
    return metrics;
  }

  return { postBatch, pollBatch, readMetrics };
}

const present = (v: string | undefined): v is string => v !== undefined && v.trim() !== '';

/**
 * A client from CRAWL_WORKER_URL, WORKER_SIGNING_SECRET and WORKER_JWT_PRIVATE_KEY_PKCS8_B64; null
 * when any is missing or blank. The URL's trailing slashes are dropped; the values are otherwise used
 * as given.
 */
export function workerClientFromEnv(env: Record<string, string | undefined>): WorkerClient | null {
  const url = env[WORKER_URL_ENV];
  const signingSecret = env[SIGNING_SECRET_ENV];
  const key = env[PRIVATE_KEY_ENV];
  if (!present(url) || !present(signingSecret) || !present(key)) return null;
  return createWorkerClient({
    url: url.replace(/\/+$/, ''),
    signingSecret,
    privateKey: loadPrivateKey(key),
  });
}
