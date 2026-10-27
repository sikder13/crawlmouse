import http from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import {
  NonceStore,
  verifyBatch,
  verifyJwt,
  verifyTs,
  decodeJwtClaimsUnverified,
  MAX_SKEW_MS,
} from './auth.js';
import { runBatch, type BatchDeps, type BatchRequest, type BatchOutcome } from './batch.js';
import { createFetcher, type Fetcher } from './fetcher.js';
import type { BatchCounters } from './completion.js';

/**
 * POST /batch (ARCH-2 4.4 contract). Order of checks: size, JSON shape, HMAC and 5 minute window, single-use
 * nonce, open-batch lookup, per-batch JWT, concurrency. Answers 202 at once; the batch runs after the
 * response. The worker holds no Inngest key and no service-role key: completion goes to the app's route
 * with the per-batch JWT it was handed.
 */

export interface WorkerConfig {
  port: number;
  signingSecret: string;
  /** Optional. When absent the JWT check is claims-only (a stub); the completion route does the real verification. */
  jwtSecret?: string;
  completionUrl?: string;
  from?: string;
  maxConcurrentBatches: number;
}

export function loadConfig(env: Record<string, string | undefined>): WorkerConfig {
  const signingSecret = env.INTERNAL_SIGNING_SECRET;
  if (!signingSecret || signingSecret.length < 16) throw new Error('INTERNAL_SIGNING_SECRET is required (16+ characters)');
  return {
    port: Number(env.PORT ?? 8080),
    signingSecret,
    jwtSecret: env.CRAWL_WORKER_JWT_SECRET || undefined,
    completionUrl: env.COMPLETION_URL || undefined,
    from: env.WORKER_FROM || undefined,
    maxConcurrentBatches: Number(env.MAX_CONCURRENT_BATCHES ?? 5),
  };
}

export interface WorkerDeps {
  config: WorkerConfig;
  fetch?: Fetcher;
  now?: () => number;
  /** (checkId, batch, nonce) must match an open batch row. The spike worker has no database; default accepts. */
  isOpenBatch?: (checkId: string, batch: number, nonce: string) => boolean | Promise<boolean>;
  /** Completion transport, replaceable in tests. */
  httpPost?: (url: string, headers: Record<string, string>, body: string) => Promise<number>;
  retryDelaysMs?: number[];
  /** TEST ONLY: see BatchDeps.limiterFactory. */
  limiterFactory?: BatchDeps['limiterFactory'];
  log?: (event: Record<string, string | number | boolean>) => void;
}

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_URLS = 50;
const ID = /^[A-Za-z0-9_:-]{1,128}$/;
const NONCE = /^[A-Za-z0-9_-]{8,128}$/;

type Parsed = BatchRequest;

function validate(v: unknown): Parsed | string {
  if (typeof v !== 'object' || v === null) return 'body must be an object';
  const o = v as Record<string, unknown>;
  if (typeof o.checkId !== 'string' || !ID.test(o.checkId)) return 'checkId';
  if (!Number.isInteger(o.batch) || (o.batch as number) < 0) return 'batch';
  if (typeof o.batchId !== 'string' || !ID.test(o.batchId)) return 'batchId';
  if (typeof o.nonce !== 'string' || !NONCE.test(o.nonce)) return 'nonce';
  if (o.kind !== 'crawl' && o.kind !== 'access') return 'kind';
  if (typeof o.jwt !== 'string' || o.jwt.length > 4096) return 'jwt';
  if (!Array.isArray(o.urls) || o.urls.length === 0 || o.urls.length > MAX_URLS) return 'urls';
  for (const u of o.urls) {
    if (typeof u !== 'object' || u === null) return 'urls';
    const x = u as Record<string, unknown>;
    if (typeof x.url !== 'string' || x.url.length > 2048) return 'urls';
    if (typeof x.hash !== 'string' || x.hash.length > 128) return 'urls';
    if (!Number.isInteger(x.depth)) return 'urls';
  }
  const hp = o.hostPolicy as Record<string, unknown> | undefined;
  if (typeof hp !== 'object' || hp === null || typeof hp.rps !== 'number' || !(hp.rps > 0)) return 'hostPolicy';
  for (const k of ['gapMs', 'inFlight', 'requestCap', 'ceilingS', 'pauseUntil']) {
    if (hp[k] !== undefined && typeof hp[k] !== 'number') return 'hostPolicy';
  }
  if (o.stage !== undefined && o.stage !== 1 && o.stage !== 2) return 'stage';
  return o as unknown as Parsed;
}

async function readBody(req: http.IncomingMessage): Promise<string | 'too_large'> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > MAX_BODY_BYTES) return 'too_large';
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const defaultPost = async (url: string, headers: Record<string, string>, body: string): Promise<number> => {
  const r = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
  await r.arrayBuffer().catch(() => undefined);
  return r.status;
};

export interface Worker {
  server: http.Server;
  /** Resolves when no batch is running. */
  idle(): Promise<void>;
  results: Map<string, BatchOutcome>;
}

export function createWorker(deps: WorkerDeps): Worker {
  const cfg = deps.config;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((e) => process.stdout.write(JSON.stringify(e) + '\n'));
  const nonces = new NonceStore({ ttlMs: 2 * MAX_SKEW_MS, now });
  const fetcher = deps.fetch ?? createFetcher({ from: cfg.from });
  const post = deps.httpPost ?? defaultPost;
  const delays = deps.retryDelaysMs ?? [1000, 2000, 4000];
  const batchDeps: BatchDeps = { fetch: fetcher, limiters: new Map(), robotsCache: new Map(), now, limiterFactory: deps.limiterFactory };
  const results = new Map<string, BatchOutcome>();
  const running = new Set<Promise<void>>();
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };

  async function complete(req: BatchRequest, counters: BatchCounters): Promise<void> {
    if (!cfg.completionUrl) return;
    const body = JSON.stringify({ checkId: req.checkId, batch: req.batch, nonce: req.nonce, counters });
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        const status = await post(cfg.completionUrl, { 'content-type': 'application/json', authorization: `Bearer ${req.jwt}` }, body);
        log({ event: 'completion', batch: req.batch, status, attempt });
        if (status < 500) return; // 2xx applied, 4xx will not improve by retrying
      } catch {
        log({ event: 'completion_error', batch: req.batch, attempt });
      }
      if (attempt < delays.length) await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }

  async function runAndReport(req: BatchRequest): Promise<void> {
    let outcome: BatchOutcome;
    try {
      outcome = await runBatch(req, batchDeps);
    } catch {
      log({ event: 'batch_failed', batch: req.batch });
      outcome = {
        counters: { fetched: 0, newUrls: 0, blocked: 0, bytes: 0, partial: true },
        rows: [],
        skipped: { worker_error: req.urls.length },
        limiter: {},
        wallMs: 0,
      };
    }
    results.set(`${req.checkId}:${req.batch}`, outcome);
    while (results.size > 200) results.delete(results.keys().next().value as string);
    log({ event: 'batch_done', batch: req.batch, fetched: outcome.counters.fetched, partial: outcome.counters.partial, wallMs: outcome.wallMs });
    await complete(req, outcome.counters);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = req.url ?? '/';
      if (req.method === 'GET' && url === '/healthz') return json(res, 200, { ok: true });

      if (req.method === 'GET' && url === '/metrics') {
        const ts = String(req.headers['x-crawlmouse-ts'] ?? '');
        const v = verifyTs({ ts, purpose: 'metrics', signature: String(req.headers['x-crawlmouse-signature'] ?? ''), secret: cfg.signingSecret, now: now() });
        if (!v.ok) return json(res, 401, { error: v.reason });
        const m = process.memoryUsage();
        return json(res, 200, {
          rssMb: Math.round(m.rss / 1048576),
          heapUsedMb: Math.round(m.heapUsed / 1048576),
          eventLoopLagP99Ms: Math.round(loop.percentile(99) / 1e6),
          batchesRunning: running.size,
          hosts: batchDeps.limiters.size,
        });
      }

      const rm = req.method === 'GET' ? url.match(/^\/results\/([A-Za-z0-9_:-]{1,128})\/(\d{1,6})$/) : null;
      if (rm) {
        const purpose = `results:${rm[1]}:${rm[2]}`;
        const v = verifyTs({ ts: String(req.headers['x-crawlmouse-ts'] ?? ''), purpose, signature: String(req.headers['x-crawlmouse-signature'] ?? ''), secret: cfg.signingSecret, now: now() });
        if (!v.ok) return json(res, 401, { error: v.reason });
        const r = results.get(`${rm[1]}:${rm[2]}`);
        return r ? json(res, 200, r) : json(res, 404, { error: 'unknown_batch' });
      }

      if (req.method !== 'POST' || url !== '/batch') return json(res, 404, { error: 'not_found' });

      const raw = await readBody(req);
      if (raw === 'too_large') return json(res, 413, { error: 'too_large' });
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        return json(res, 400, { error: 'invalid_json' });
      }
      const body = validate(parsedJson);
      if (typeof body === 'string') return json(res, 400, { error: 'invalid_body', field: body });

      const auth = verifyBatch({
        ts: String(req.headers['x-crawlmouse-ts'] ?? ''),
        checkId: body.checkId,
        batch: body.batch,
        nonce: body.nonce,
        body: raw,
        signature: String(req.headers['x-crawlmouse-signature'] ?? ''),
        secret: cfg.signingSecret,
        now: now(),
      });
      if (!auth.ok) return json(res, 401, { error: auth.reason });

      if (!nonces.claim(body.nonce)) return json(res, 409, { error: 'nonce_replayed' });

      if (deps.isOpenBatch && !(await deps.isOpenBatch(body.checkId, body.batch, body.nonce))) {
        return json(res, 404, { error: 'no_open_batch' });
      }

      const expect = { check_id: body.checkId, batch: body.batch, nonce: body.nonce };
      if (cfg.jwtSecret) {
        const j = verifyJwt(body.jwt, cfg.jwtSecret, { now: now(), expect });
        if (!j.ok) return json(res, 401, { error: `jwt_${j.reason}` });
      } else {
        // Stub: the worker cannot verify a signature it holds no key for; it still refuses a token that is
        // malformed, expired, or minted for a different batch. The real check is the completion route.
        const c = decodeJwtClaimsUnverified(body.jwt);
        if (!c || c.role !== 'crawl_worker' || typeof c.exp !== 'number') return json(res, 401, { error: 'jwt_malformed' });
        if (now() >= c.exp * 1000) return json(res, 401, { error: 'jwt_expired' });
        if (c.check_id !== expect.check_id || c.batch !== expect.batch || c.nonce !== expect.nonce) {
          return json(res, 401, { error: 'jwt_claim_mismatch' });
        }
      }

      if (running.size >= cfg.maxConcurrentBatches) return json(res, 429, { error: 'busy' });

      json(res, 202, { accepted: true, batchId: body.batchId });
      const p: Promise<void> = runAndReport(body).finally(() => running.delete(p));
      running.add(p);
    } catch {
      if (!res.headersSent) json(res, 500, { error: 'internal' });
      else res.end();
    }
  });

  return {
    server,
    results,
    idle: async () => {
      while (running.size) await Promise.all([...running]);
    },
  };
}
