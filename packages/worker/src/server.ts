import { readFileSync } from 'node:fs';
import http from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { sameHostIgnoringWww } from '@crawlmouse/engine/worker';
import {
  SIGNATURE_HEADER,
  TS_HEADER,
  tsProblem,
  type SignatureFailure,
  verifyBatchSignature,
  verifyReadSignature,
} from './auth/hmac.js';
import { parseJsonStrict, verifyBatchJwt, type BatchClaims } from './auth/jwt.js';
import { Nonces } from './auth/nonces.js';
import { BatchRequestSchema, batchIdOf, urlsOf, type BatchRequest } from './batch/request.js';
import { runBatch } from './batch/run.js';
import { inlineReader, type PageReader } from './reader/read.js';
import { RobotsCache } from './batch/site-rules.js';
import { DeclarationCache } from './batch/declarations.js';
import { BatchStore } from './batch/store.js';
import { systemClock, type Clock } from './clock.js';
import type { WorkerConfig } from './config.js';
import { createFetcher, type Fetcher } from './fetch/fetcher.js';
import { siteKeyOf } from './politeness/site-key.js';
import { Sites } from './politeness/sites.js';
import { REFUSALS, type Refusal } from './routes.js';

/**
 * The worker's HTTP service. The order of checks on POST /batch: size, HMAC and timestamp over the
 * raw bytes, UTF-8 and JSON, schema, pause, JWT and its scope, capacity, a batch already accepted,
 * nonce. Nothing is decoded or parsed before the signature has passed. The nonce is spent only once
 * everything before it has passed. The batch runs after the 202.
 */

export const MAX_BODY_BYTES = 1024 * 1024;
const BATCH_ID = /^\/batch\/([0-9a-f-]{36}:\d{1,7})$/;

export type LogEvent = Record<string, string | number | boolean | null | string[]>;

export interface WorkerDeps {
  config: WorkerConfig;
  clock?: Clock;
  /** Tests pass a fetcher that can reach their fixtures; the entry point passes none. */
  fetcher?: Fetcher;
  /** The entry point passes the reader thread; tests read pages inline. */
  reader?: PageReader;
  log?: (e: LogEvent) => void;
}

export interface Worker {
  server: http.Server;
  /** Resolves when no batch is running. */
  idle(): Promise<void>;
  running(): number;
}

/**
 * The process's peak resident memory since it started (VmHWM), in MiB; null where /proc is not there.
 * A restart starts it again.
 */
function peakRssMb(): number | null {
  try {
    const kib = /^VmHWM:\s+(\d+) kB$/m.exec(readFileSync('/proc/self/status', 'utf8'));
    return kib ? Math.round(Number(kib[1]) / 1024) : null;
  } catch {
    return null;
  }
}

/** How long a POST /batch body may take to arrive, from its headers. */
export const BODY_DEADLINE_MS = 5_000;

/**
 * The body, as bytes; null when it is over MAX_BODY_BYTES or the request failed; 'timeout' when it did
 * not arrive within BODY_DEADLINE_MS. Reading stops at either limit, so the answer can still be sent.
 */
function readBody(req: http.IncomingMessage): Promise<Buffer | null | 'timeout'> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (body: Buffer | null | 'timeout') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.removeAllListeners('data');
      req.pause();
      resolve(body);
    };
    const timer = setTimeout(() => finish('timeout'), BODY_DEADLINE_MS);
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return finish(null);
      chunks.push(chunk);
    });
    req.on('end', () => finish(Buffer.concat(chunks)));
    req.on('error', () => finish(null));
  });
}

/** A signed request's headers can fail before its body arrives: a bad or stale time, or a signature that is not 64 hex characters. */
function headerProblem(req: http.IncomingMessage, now: number): SignatureFailure | null {
  const ts = tsProblem(String(req.headers[TS_HEADER] ?? ''), now);
  if (ts) return ts;
  return /^[0-9a-f]{64}$/i.test(String(req.headers[SIGNATURE_HEADER] ?? ''))
    ? null
    : 'bad_signature';
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

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
    reader: deps.reader ?? inlineReader,
    vantage: deps.config.vantage,
    declarationCache: new DeclarationCache(clock),
  };
  const store = new BatchStore(now);
  const nonces = new Nonces(now);
  const running = new Set<Promise<void>>();
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();

  const send = (res: http.ServerResponse, status: number, body: string | Buffer) => {
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
    // Refused on its headers alone where they cannot pass: no time, a stale one, or a signature that is
    // not 64 hex characters. A request whose headers pass is buffered (to MAX_BODY_BYTES, within
    // BODY_DEADLINE_MS) before its signature is checked, because the signature covers the body, so an
    // unsigned request with well-formed headers is buffered.
    const early = headerProblem(req, now());
    if (early) {
      res.setHeader('connection', 'close');
      return refuse(res, early);
    }
    const raw = await readBody(req);
    if (raw === 'timeout' || raw === null) res.setHeader('connection', 'close');
    if (raw === 'timeout') return refuse(res, 'body_timeout');
    if (raw === null) return refuse(res, 'too_large');
    const signature = verifyBatchSignature(
      config.signingSecret,
      header(req, TS_HEADER),
      raw,
      header(req, SIGNATURE_HEADER),
      now(),
    );
    if (signature) return refuse(res, signature);
    let parsed: unknown;
    try {
      parsed = parseJsonStrict(utf8.decode(raw));
    } catch {
      return refuse(res, 'invalid_json');
    }
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
    if (running.size >= config.batchConcurrency) return refuse(res, 'busy');
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
    if (r.status === 'done') {
      const head = Buffer.from(`{"batch_id":${JSON.stringify(id)},"status":"done","result":`);
      return send(res, 200, Buffer.concat([head, r.json, Buffer.from('}')]));
    }
    json(res, 200, { batch_id: id, status: r.status, progress: r.progress });
  }

  function metrics(req: http.IncomingMessage, res: http.ServerResponse): void {
    const signature = readSigned(req, 'metrics');
    if (signature) return refuse(res, signature);
    const m = process.memoryUsage();
    json(res, 200, {
      rss_mb: Math.round(m.rss / 1048576),
      peak_rss_mb: peakRssMb(),
      heap_used_mb: Math.round(m.heapUsed / 1048576),
      event_loop_lag_p99_ms: Math.round(lag.percentile(99) / 1e6),
      batches_running: running.size,
      batches_stored: store.size,
      requests_per_site: sites.requestsPerSite(),
      // Reader threads started to replace one that died or passed a read's deadline (0 inline).
      reader_restarts: batchDeps.reader.restarts ?? 0,
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
