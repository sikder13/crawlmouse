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
import { runBatch, type BatchDeps, type BatchRequest, type BatchOutcome, type BatchProgress } from './batch.js';
import { createFetcher, type Fetcher } from './fetcher.js';
import type { BatchCounters } from './completion.js';

/**
 * POST /batch (ARCH-2 4.4 contract). Order of checks: size, JSON shape, HMAC and 5 minute window, single-use
 * nonce, open-batch lookup, per-batch JWT, concurrency. Answers 202 at once; the batch runs after the
 * response. The worker holds no Inngest key and no service-role key: completion goes to the app's route
 * with the per-batch JWT it was handed.
 *
 * GET /batch/{batchId} (signed, purpose `batch:{batchId}`) reports the batch: `running` with progress,
 * `done` with the outcome, or `failed`. Entries live in memory, at most BATCH_STORE_MAX of them, and are
 * dropped BATCH_TTL_MS after they finish; an unknown or dropped id answers 404.
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

export const BATCH_TTL_MS = 60 * 60_000;
export const BATCH_STORE_MAX = 500;

export type BatchEntry =
  | { status: 'running'; acceptedAt: number; progress: BatchProgress }
  | { status: 'done'; acceptedAt: number; finishedAt: number; progress: BatchProgress; result: BatchOutcome }
  | { status: 'failed'; acceptedAt: number; finishedAt: number; progress: BatchProgress; error: 'worker_error' };

/** In-memory batch records: bounded by count, expired by age after finishing. */
export class BatchStore {
  private readonly entries = new Map<string, BatchEntry>();
  constructor(private readonly now: () => number, private readonly ttlMs = BATCH_TTL_MS, private readonly max = BATCH_STORE_MAX) {}

  private prune(): void {
    const t = this.now();
    for (const [k, e] of this.entries) {
      if (e.status !== 'running' && t - e.finishedAt >= this.ttlMs) this.entries.delete(k);
    }
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value as string);
  }

  set(id: string, e: BatchEntry): void {
    this.entries.delete(id);
    this.entries.set(id, e);
    this.prune();
  }

  get(id: string): BatchEntry | undefined {
    this.prune();
    return this.entries.get(id);
  }

  get size(): number {
    this.prune();
    return this.entries.size;
  }
}

export interface Worker {
  server: http.Server;
  /** Resolves when no batch is running. */
  idle(): Promise<void>;
  batches: BatchStore;
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
  const batches = new BatchStore(now);
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
    const id = `${req.checkId}:${req.batch}`;
    const acceptedAt = now();
    let progress: BatchProgress = { urlsDone: 0, urlsTotal: req.urls.length, requests: 0, fetched: 0 };
    batches.set(id, { status: 'running', acceptedAt, progress });
    let outcome: BatchOutcome;
    try {
      outcome = await runBatch(req, batchDeps, (p) => {
        progress = p;
        const e = batches.get(id);
        if (e?.status === 'running') e.progress = p;
      });
    } catch {
      log({ event: 'batch_failed', batch: req.batch });
      batches.set(id, { status: 'failed', acceptedAt, finishedAt: now(), progress, error: 'worker_error' });
      outcome = {
        counters: { fetched: 0, newUrls: 0, blocked: 0, bytes: 0, partial: true },
        rows: [],
        skipped: { worker_error: req.urls.length },
        limiter: {},
        wallMs: 0,
      };
      await complete(req, outcome.counters);
      return;
    }
    batches.set(id, { status: 'done', acceptedAt, finishedAt: now(), progress, result: outcome });
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

      const bm = req.method === 'GET' ? url.match(/^\/batch\/([A-Za-z0-9_:-]{1,128})$/) : null;
      if (bm) {
        const id = bm[1]!;
        const v = verifyTs({ ts: String(req.headers['x-crawlmouse-ts'] ?? ''), purpose: `batch:${id}`, signature: String(req.headers['x-crawlmouse-signature'] ?? ''), secret: cfg.signingSecret, now: now() });
        if (!v.ok) return json(res, 401, { error: v.reason });
        const e = batches.get(id);
        if (!e) return json(res, 404, { error: 'unknown_batch' });
        if (e.status === 'running') return json(res, 200, { batchId: id, status: 'running', progress: e.progress });
        if (e.status === 'failed') return json(res, 200, { batchId: id, status: 'failed', progress: e.progress, error: e.error });
        return json(res, 200, { batchId: id, status: 'done', progress: e.progress, result: e.result });
      }

      const rm = req.method === 'GET' ? url.match(/^\/results\/([A-Za-z0-9_:-]{1,128})\/(\d{1,6})$/) : null;
      if (rm) {
        const purpose = `results:${rm[1]}:${rm[2]}`;
        const v = verifyTs({ ts: String(req.headers['x-crawlmouse-ts'] ?? ''), purpose, signature: String(req.headers['x-crawlmouse-signature'] ?? ''), secret: cfg.signingSecret, now: now() });
        if (!v.ok) return json(res, 401, { error: v.reason });
        const e = batches.get(`${rm[1]}:${rm[2]}`);
        return e?.status === 'done' ? json(res, 200, e.result) : json(res, 404, { error: 'unknown_batch' });
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

      // The store entry is written inside runAndReport before its first await, so a poll that arrives
      // after the 202 finds the batch.
      const p: Promise<void> = runAndReport(body).finally(() => running.delete(p));
      running.add(p);
      json(res, 202, { accepted: true, batchId: `${body.checkId}:${body.batch}` });
    } catch {
      if (!res.headersSent) json(res, 500, { error: 'internal' });
      else res.end();
    }
  });

  // Longer than the edge proxy's upstream keep-alive, so the proxy does not reuse a socket the worker
  // has just closed (the default is 5 s).
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  return {
    server,
    batches,
    idle: async () => {
      while (running.size) await Promise.all([...running]);
    },
  };
}
