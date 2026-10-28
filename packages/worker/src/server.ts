import http from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { sameHostIgnoringWww } from '@crawlmouse/engine/worker';
import {
  SIGNATURE_HEADER,
  TS_HEADER,
  verifyBatchSignature,
  verifyReadSignature,
} from './auth/hmac.js';
import { parseJsonStrict, verifyBatchJwt, type BatchClaims } from './auth/jwt.js';
import { Nonces } from './auth/nonces.js';
import { BatchRequestSchema, batchIdOf, urlsOf, type BatchRequest } from './batch/request.js';
import { runBatch } from './batch/run.js';
import { RobotsCache } from './batch/site-rules.js';
import { BatchStore } from './batch/store.js';
import { systemClock, type Clock } from './clock.js';
import type { WorkerConfig } from './config.js';
import { createFetcher, type Fetcher } from './fetch/fetcher.js';
import { siteKeyOf } from './politeness/site-key.js';
import { Sites } from './politeness/sites.js';
import { REFUSALS, type Refusal } from './routes.js';

/**
 * The worker's HTTP service. The order of checks on POST /batch: size, JSON, schema, HMAC and
 * timestamp, pause, JWT and its scope, capacity, a batch already accepted, nonce. The nonce is spent
 * only once everything before it has passed. The batch runs after the 202.
 */

export const MAX_BODY_BYTES = 1024 * 1024;
const BATCH_ID = /^\/batch\/([0-9a-f-]{36}:\d{1,7})$/;

export type LogEvent = Record<string, string | number | boolean | null | string[]>;

export interface WorkerDeps {
  config: WorkerConfig;
  clock?: Clock;
  /** Tests pass a fetcher that can reach their fixtures; the entry point passes none. */
  fetcher?: Fetcher;
  log?: (e: LogEvent) => void;
}

export interface Worker {
  server: http.Server;
  /** Resolves when no batch is running. */
  idle(): Promise<void>;
  running(): number;
}

async function readBody(req: http.IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The JWT names this batch, and each URL is on the site host it names, on the default port. */
function inScope(c: BatchClaims, b: BatchRequest): boolean {
  if (
    c.check_id !== b.check_id ||
    c.site_id !== b.site_id ||
    c.batch !== b.batch ||
    c.nonce !== b.nonce
  ) {
    return false;
  }
  const site = new URL(`https://${c.site_host}/`);
  // The scheme's default port only: the JWT names a site, not a port to probe on its host.
  return urlsOf(b).every((u) => {
    const url = new URL(u);
    return url.port === '' && sameHostIgnoringWww(url, site);
  });
}

export function createWorker(deps: WorkerDeps): Worker {
  const { config } = deps;
  const clock = deps.clock ?? systemClock;
  const log = deps.log ?? ((e: LogEvent) => void process.stdout.write(`${JSON.stringify(e)}\n`));
  const now = () => clock.now();
  const sites = new Sites(clock);
  const batchDeps = {
    clock,
    sites,
    fetcher: deps.fetcher ?? createFetcher(clock),
    robotsCache: new RobotsCache(clock),
  };
  const store = new BatchStore(now);
  const nonces = new Nonces(now);
  const running = new Set<Promise<void>>();
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();

  const send = (res: http.ServerResponse, status: number, body: string) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(body);
  };
  const json = (res: http.ServerResponse, status: number, body: unknown) =>
    send(res, status, JSON.stringify(body));
  const refuse = (res: http.ServerResponse, error: Refusal, detail?: Record<string, unknown>) =>
    json(res, REFUSALS[error].status, { error, ...detail });

  const header = (req: http.IncomingMessage, name: string) => String(req.headers[name] ?? '');
  const readSigned = (req: http.IncomingMessage, purpose: string) =>
    verifyReadSignature(
      config.signingSecret,
      header(req, TS_HEADER),
      purpose,
      header(req, SIGNATURE_HEADER),
      now(),
    );

  async function run(id: string, req: BatchRequest): Promise<void> {
    try {
      const result = await runBatch(req, batchDeps, (p) => store.progress(id, p));
      store.finish(id, result);
      log({
        event: 'batch_done',
        batch_id: id,
        kind: req.kind,
        site: siteKeyOf(urlsOf(req)[0]!),
        requests: result.requests,
        partial: result.partial ? result.partial.reasons : null,
      });
    } catch (e) {
      store.fail(id);
      log({ event: 'batch_failed', batch_id: id, error: e instanceof Error ? e.name : 'unknown' });
    } finally {
      sites.sweep();
    }
  }

  async function postBatch(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const raw = await readBody(req);
    if (raw === null) return refuse(res, 'too_large');
    let parsed: unknown;
    try {
      parsed = parseJsonStrict(raw);
    } catch {
      return refuse(res, 'invalid_json');
    }
    // The signature is checked before the schema, so a caller without the secret learns nothing about
    // the body's shape. The signed fields are read as they are; the schema then holds them to its rules.
    const fields = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
      string,
      unknown
    >;
    const signature = verifyBatchSignature(
      config.signingSecret,
      {
        ts: header(req, TS_HEADER),
        checkId: String(fields.check_id),
        batch: Number(fields.batch),
        nonce: String(fields.nonce),
        body: raw,
      },
      header(req, SIGNATURE_HEADER),
      now(),
    );
    if (signature) return refuse(res, signature);
    const checked = BatchRequestSchema.safeParse(parsed);
    if (!checked.success) {
      return refuse(res, 'invalid_body', {
        fields: [...new Set(checked.error.issues.map((i) => i.path.join('.') || '(root)'))],
      });
    }
    const body = checked.data;
    if (config.paused) return refuse(res, 'paused');
    const jwt = verifyBatchJwt(body.jwt, config.jwtPublicKey, now());
    if (!jwt.ok) return refuse(res, 'jwt_invalid', { reason: jwt.reason });
    if (!inScope(jwt.claims, body)) return refuse(res, 'jwt_scope');
    if (running.size >= config.maxConcurrentBatches) return refuse(res, 'busy');
    const id = batchIdOf(body);
    if (store.has(id)) return refuse(res, 'batch_exists');
    if (!nonces.claim(body.nonce)) return refuse(res, 'nonce_replayed');

    // Recorded before the 202 goes out, so a poll that follows it finds the batch.
    store.start(id, { urls_done: 0, urls_total: urlsOf(body).length, requests: 0 });
    const p: Promise<void> = run(id, body).finally(() => running.delete(p));
    running.add(p);
    log({ event: 'batch_accepted', batch_id: id, kind: body.kind, urls: urlsOf(body).length });
    json(res, 202, { batch_id: id });
  }

  function getBatch(req: http.IncomingMessage, res: http.ServerResponse, id: string): void {
    const signature = readSigned(req, `batch:${id}`);
    if (signature) return refuse(res, signature);
    const r = store.get(id);
    if (!r) return refuse(res, 'not_found');
    if (r.status === 'done')
      return send(
        res,
        200,
        `{"batch_id":${JSON.stringify(id)},"status":"done","result":${r.json}}`,
      );
    json(res, 200, { batch_id: id, status: r.status, progress: r.progress });
  }

  function metrics(req: http.IncomingMessage, res: http.ServerResponse): void {
    const signature = readSigned(req, 'metrics');
    if (signature) return refuse(res, signature);
    const m = process.memoryUsage();
    json(res, 200, {
      rss_mb: Math.round(m.rss / 1048576),
      heap_used_mb: Math.round(m.heapUsed / 1048576),
      event_loop_lag_p99_ms: Math.round(lag.percentile(99) / 1e6),
      batches_running: running.size,
      batches_stored: store.size,
      requests_per_site: sites.requestsPerSite(),
    });
  }

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const route = async () => {
      if (req.method === 'GET' && url === '/healthz') return json(res, 200, { ok: true });
      if (req.method === 'GET' && url === '/metrics') return metrics(req, res);
      const batch = req.method === 'GET' ? BATCH_ID.exec(url) : null;
      if (batch) return getBatch(req, res, batch[1]!);
      if (req.method === 'POST' && url === '/batch') return postBatch(req, res);
      refuse(res, 'not_found');
    };
    route().catch(() => {
      log({ event: 'request_failed', route: url.startsWith('/batch/') ? '/batch/{id}' : url });
      if (!res.headersSent) json(res, 500, { error: 'internal' });
      else res.end();
    });
  });
  // Longer than the edge proxy's upstream keep-alive, so it never reuses a socket the worker just closed.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 30_000;

  return {
    server,
    running: () => running.size,
    idle: async () => {
      while (running.size) await Promise.all([...running]);
    },
  };
}
