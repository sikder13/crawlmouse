import { readFileSync } from 'node:fs';
import http from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { inSiteScope } from '@crawlmouse/engine/worker';
import {
  BODY_BYTES_HEADER,
  BODY_SHA256_HEADER,
  SIGNATURE_HEADER,
  TS_HEADER,
  sha256Hex,
  tsProblem,
  type SignatureFailure,
  verifyBatchSignature,
  verifyMeasureSignature,
  verifyReadSignature,
} from './auth/hmac.js';
import { parseJsonStrict, verifyBatchJwt, type BatchClaims } from './auth/jwt.js';
import { Nonces } from './auth/nonces.js';
import { BatchRequestSchema, batchIdOf, urlsOf, type BatchRequest } from './batch/request.js';
import { runBatch } from './batch/run.js';
import { inlineReader, isNotRead, type PageReader } from './reader/read.js';
import type { MeasureReader } from './reader/measure.js';
import { RobotsCache } from './batch/site-rules.js';
import { DeclarationCache } from './batch/declarations.js';
import { BatchStore } from './batch/store.js';
import { systemClock, type Clock } from './clock.js';
import type { WorkerConfig } from './config.js';
import { createDoneSignal, type SignalPost } from './signal.js';
import { createFetcher, type Fetcher } from './fetch/fetcher.js';
import { Sites } from './politeness/sites.js';
import { REFUSALS, type Refusal } from './routes.js';

/**
 * The worker's HTTP service. The order of checks on POST /batch: size, HMAC and timestamp over the
 * raw bytes, UTF-8 and JSON, schema, pause, JWT and its scope, capacity, a batch already accepted,
 * nonce. Nothing is decoded or parsed before the signature has passed. The nonce is spent only once
 * everything before it has passed. The batch runs after the 202.
 */

export const MAX_BODY_BYTES = 1024 * 1024;
/**
 * A POST /render/measure body: two rendered pages of at most the engine's MAX_REPLY_BYTES each
 * (10 MiB, packages/engine/src/v2/render/client.ts) and the JSON around them.
 */
export const MAX_MEASURE_BODY_BYTES = 2 * 10 * 1024 * 1024 + 64 * 1024;
/**
 * Signed measure requests held at once: one on the measure thread and one queued behind it, so a
 * queued request waits at most one READ_DEADLINE_MS. Past it a request is refused `measure_busy`, and
 * the app's client waits and asks again (apps/web/lib/worker-client/client.ts). Only a request whose
 * signed headers have passed takes a slot.
 */
export const MEASURE_CONCURRENCY = 2;
const BATCH_ID = /^\/batch\/([0-9a-f-]{36}:\d{1,7})$/;
const BATCH_PROGRESS = /^\/batch\/([0-9a-f-]{36}:\d{1,7})\/progress(?:\?after=(\d{1,6}))?$/;

export type LogEvent = Record<string, string | number | boolean | null | string[]>;

export interface WorkerDeps {
  config: WorkerConfig;
  clock?: Clock;
  /** Tests pass a fetcher that can reach their fixtures; the entry point passes none. */
  fetcher?: Fetcher;
  /** The entry point passes the reader thread; tests read pages inline. */
  reader?: PageReader;
  /**
   * The thread rendered pages are measured on, separate from `reader` so a slow rendered page never
   * holds up a crawl read. The entry point passes one; without it POST /render/measure answers
   * `reader_unavailable`, because nothing inline stops a read at a deadline.
   */
  measureReader?: MeasureReader;
  log?: (e: LogEvent) => void;
  /** Tests pass what the signal is sent through; the entry point passes none. */
  signalPost?: SignalPost;
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
function readBody(
  req: http.IncomingMessage,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<Buffer | null | 'timeout'> {
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
      if (size > maxBytes) return finish(null);
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
  // The scheme's default port only: the JWT names a site, not a port to probe on its host. The check
  // builder's planner plans by the same function, so it never sends a URL this refuses.
  return urlsOf(b).every((u) => inSiteScope(new URL(u), site));
}

export function createWorker(deps: WorkerDeps): Worker {
  const { config } = deps;
  const clock = deps.clock ?? systemClock;
  const log = deps.log ?? ((e: LogEvent) => void process.stdout.write(`${JSON.stringify(e)}\n`));
  const now = () => clock.now();
  const sites = new Sites(clock, config.labHostPoliteness);
  const batchDeps = {
    clock,
    sites,
    fetcher: deps.fetcher ?? createFetcher(clock),
    robotsCache: new RobotsCache(clock),
    reader: deps.reader ?? inlineReader,
    vantage: deps.config.vantage,
    declarationCache: new DeclarationCache(clock),
  };
  const signal = config.appSignalUrl
    ? createDoneSignal({
        url: config.appSignalUrl,
        secret: config.signingSecret,
        now,
        log,
        ...(deps.signalPost && { post: deps.signalPost }),
        ...(config.appSignalBypass && { protectionBypass: config.appSignalBypass }),
      })
    : null;
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
      const result = await runBatch(req, batchDeps, (p, live) => store.progress(id, p, live));
      store.finish(id, result);
      signal?.({ check_id: req.check_id, batch: req.batch, status: 'done' });
      log({
        event: 'batch_done',
        batch_id: id,
        kind: req.kind,
        site: sites.keyOf(urlsOf(req)[0]!),
        requests: result.requests,
        partial: result.partial ? result.partial.reasons : null,
      });
    } catch (e) {
      store.fail(id);
      signal?.({ check_id: req.check_id, batch: req.batch, status: 'failed' });
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
    store.start(id, {
      urls_done: 0,
      urls_total: urlsOf(body).length,
      requests: 0,
      pages: 0,
      links: 0,
      homepage_read: false,
    });
    const p: Promise<void> = run(id, body).finally(() => running.delete(p));
    running.add(p);
    log({ event: 'batch_accepted', batch_id: id, kind: body.kind, urls: urlsOf(body).length });
    json(res, 202, { batch_id: id, ...(signal && { signals: true }) });
  }

  let measuring = 0;
  /**
   * The order of checks: the signed headers (time, digest, length, HMAC) before a byte of the body is
   * read; then the measure thread, the slot, the body against its signed length and digest. The body is
   * decoded and parsed on the measure thread, never here. Every refusal before the body is read closes
   * the connection, so an unread body is not left on a kept-alive socket.
   */
  async function postMeasure(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const close = (why: Refusal) => {
      res.setHeader('connection', 'close');
      refuse(res, why);
    };
    const early = headerProblem(req, now());
    if (early) return close(early);
    const sha256 = header(req, BODY_SHA256_HEADER);
    const declared = header(req, BODY_BYTES_HEADER);
    if (!/^[0-9a-f]{64}$/.test(sha256) || !/^\d{1,9}$/.test(declared))
      return close('bad_signature');
    const bytes = Number(declared);
    const signature = verifyMeasureSignature(
      config.signingSecret,
      header(req, TS_HEADER),
      sha256,
      bytes,
      header(req, SIGNATURE_HEADER),
      now(),
    );
    if (signature) return close(signature);
    if (bytes > MAX_MEASURE_BODY_BYTES) return close('too_large');
    const reader = deps.measureReader;
    if (!reader) return close('reader_unavailable');
    if (measuring >= MEASURE_CONCURRENCY) return close('measure_busy');
    measuring++;
    try {
      const raw = await readBody(req, bytes);
      if (raw === 'timeout') return close('body_timeout');
      // Over the signed length (readBody stops there), or not the bytes that were signed: a body cut
      // short has another digest.
      if (raw === null || sha256Hex(raw) !== sha256) {
        return close('bad_signature');
      }
      let r: Awaited<ReturnType<MeasureReader['measure']>>;
      try {
        r = await reader.measure(raw);
      } catch {
        // The read threw on the thread (measure.ts catches what the page can cause; this is the rest).
        log({ event: 'measure_threw' });
        return json(res, 200, { failed: 'read_threw' });
      }
      if (isNotRead(r)) return json(res, 200, { failed: r.failed });
      if ('invalid' in r) {
        return r.invalid === 'json'
          ? refuse(res, 'invalid_json')
          : refuse(res, 'invalid_body', { fields: r.invalid });
      }
      json(res, 200, { reading: r.reading });
    } finally {
      measuring--;
    }
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

  /** A batch's state and counts, never its result: cheap to answer however large the result is. */
  function getProgress(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    id: string,
    after: number,
  ): void {
    const signature = readSigned(req, `progress:${id}`);
    if (signature) return refuse(res, signature);
    const r = store.get(id);
    if (!r) return refuse(res, 'not_found');
    if (r.status === 'running') {
      const live = store.livePages(id, after);
      return json(res, 200, {
        batch_id: id,
        status: r.status,
        progress: r.progress,
        pages_total: live.total,
        live_pages: live.pages,
      });
    }
    json(res, 200, { batch_id: id, status: r.status });
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
      // The same, for the thread rendered pages are measured on (0 when there is none).
      measure_reader_restarts: deps.measureReader?.restarts ?? 0,
    });
  }

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const route = async () => {
      if (req.method === 'GET' && url === '/healthz') return json(res, 200, { ok: true });
      if (req.method === 'GET' && url === '/metrics') return metrics(req, res);
      const batch = req.method === 'GET' ? BATCH_ID.exec(url) : null;
      if (batch) return getBatch(req, res, batch[1]!);
      const progress = req.method === 'GET' ? BATCH_PROGRESS.exec(url) : null;
      if (progress) return getProgress(req, res, progress[1]!, Number(progress[2] ?? 0));
      if (req.method === 'POST' && url === '/batch') return postBatch(req, res);
      if (req.method === 'POST' && url === '/render/measure') return postMeasure(req, res);
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
