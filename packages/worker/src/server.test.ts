import { readFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { signBatch, signRead } from './auth/hmac.js';
import { RESULT_TTL_MS } from './batch/store.js';
import { loadConfig, isCrawlPaused, type WorkerConfig } from './config.js';
import type { Fetcher } from './fetch/fetcher.js';
import { BODY_DEADLINE_MS, createWorker, type LogEvent, type Worker } from './server.js';
import { InstantClock } from './test-support/clock.js';
import { fakeFetcher } from './test-support/fake-fetcher.js';
import { claims, keyPair, signJwt } from './test-support/jwt.js';
import { isCrawlPaused as appIsCrawlPaused } from '../../../apps/web/lib/crawl-pause.js';

const SECRET = 'k'.repeat(48);
const keys = keyPair();
const CHECK = '00000000-0000-4000-8000-0000000000c9';
const SITE = '00000000-0000-4000-8000-0000000000a9';
let nonceSeq = 0;

interface Running {
  worker: Worker;
  base: string;
  clock: InstantClock;
  logs: LogEvent[];
}
let current: Running | null = null;

afterEach(async () => {
  if (!current) return;
  await current.worker.idle();
  await new Promise<void>((r) => current!.worker.server.close(() => r()));
  current = null;
});

async function start(over: Partial<WorkerConfig> = {}, fetcher?: Fetcher): Promise<Running> {
  const clock = new InstantClock(1_800_000_000_000);
  const logs: LogEvent[] = [];
  const config: WorkerConfig = {
    ...loadConfig({ WORKER_SIGNING_SECRET: SECRET, WORKER_JWT_PUBLIC_KEY: keys.publicKeyEnv }),
    ...over,
  };
  const worker = createWorker({
    config,
    clock,
    fetcher:
      fetcher ??
      fakeFetcher(clock, (url) =>
        url.endsWith('/robots.txt') ? { status: 404, body: '' } : { status: 200 },
      ),
    log: (e) => logs.push(e),
  });
  await new Promise<void>((r) => worker.server.listen(0, '127.0.0.1', r));
  current = {
    worker,
    base: `http://127.0.0.1:${(worker.server.address() as AddressInfo).port}`,
    clock,
    logs,
  };
  return current;
}

function batchBody(over: Record<string, unknown> = {}, claimOver: Record<string, unknown> = {}) {
  const nonce = `nonce-${String(++nonceSeq).padStart(16, '0')}`;
  const body = {
    kind: 'crawl',
    check_id: CHECK,
    site_id: SITE,
    batch: nonceSeq,
    nonce,
    budget: { max_requests: 50, max_bytes: 1_000_000, max_seconds: 300 },
    urls: ['https://www.example.com/', 'https://example.com/a'],
    ...over,
  } as Record<string, unknown>;
  const now = current!.clock.now();
  body.jwt ??= signJwt(keys.privateKey, {
    ...claims({ now, batch: body.batch as number, nonce: body.nonce as string }),
    ...claimOver,
  });
  return body;
}

async function post(
  body: Record<string, unknown> | string,
  opts: { ts?: string; sign?: (raw: string) => string } = {},
) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const ts = opts.ts ?? String(current!.clock.now());
  const signature = opts.sign?.(raw) ?? signBatch(SECRET, ts, raw);
  const res = await fetch(`${current!.base}/batch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-crawlmouse-ts': ts,
      'x-crawlmouse-signature': signature,
    },
    body: raw,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function get(path: string, purpose: string, ts = String(current!.clock.now())) {
  const res = await fetch(`${current!.base}${path}`, {
    headers: { 'x-crawlmouse-ts': ts, 'x-crawlmouse-signature': signRead(SECRET, ts, purpose) },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('GET /healthz', () => {
  it('answers without a signature', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('POST /batch: accepted', () => {
  it('answers 202 with the batch id, runs the batch, and GET /batch/{id} returns the result', async () => {
    const { worker } = await start();
    const body = batchBody();
    const accepted = await post(body);
    expect(accepted).toEqual({ status: 202, body: { batch_id: `${CHECK}:${body.batch}` } });
    await worker.idle();
    const id = String(accepted.body.batch_id);
    const polled = await get(`/batch/${id}`, `batch:${id}`);
    expect(polled.status).toBe(200);
    expect(polled.body).toMatchObject({
      batch_id: id,
      status: 'done',
      result: { kind: 'crawl', check_id: CHECK, site_id: SITE },
    });
  });

  it('accepts URLs on the www and bare forms of the site host', async () => {
    await start();
    expect(
      (await post(batchBody({ urls: ['https://example.com/', 'https://www.example.com/x'] })))
        .status,
    ).toBe(202);
  });
});

describe('POST /batch: signature and replay', () => {
  it('refuses a bad signature, a changed body and a stale timestamp with 401', async () => {
    const { clock } = await start();
    expect((await post(batchBody(), { sign: () => 'ab'.repeat(32) })).body).toEqual({
      error: 'bad_signature',
    });
    const body = batchBody();
    const signedFor = JSON.stringify(body);
    const changed = JSON.stringify({ ...body, urls: ['https://example.com/other'] });
    const ts = String(clock.now());
    const r = await post(changed, { ts, sign: () => signBatch(SECRET, ts, signedFor) });
    expect(r).toEqual({ status: 401, body: { error: 'bad_signature' } });
    expect((await post(batchBody(), { ts: String(clock.now() - 5 * 60_000 - 1) })).body).toEqual({
      error: 'stale_ts',
    });
  });

  it('refuses the same request twice: the batch runs once', async () => {
    const { worker } = await start();
    const body = batchBody();
    expect((await post(body)).status).toBe(202);
    expect(await post(body)).toEqual({ status: 409, body: { error: 'batch_exists' } });
    await worker.idle();
  });

  it('refuses a nonce already used, even for another batch', async () => {
    await start();
    const first = batchBody();
    expect((await post(first)).status).toBe(202);
    const second = batchBody({ nonce: first.nonce }, { nonce: first.nonce });
    expect(await post(second)).toEqual({ status: 409, body: { error: 'nonce_replayed' } });
  });
});

describe('POST /batch: the JWT scopes the batch to one check and one site', () => {
  it('refuses a batch for another site under a valid JWT', async () => {
    await start();
    // The JWT is valid and names SITE on example.com; the body asks for another site id.
    const otherSite = batchBody({ site_id: '00000000-0000-4000-8000-0000000000ff' });
    expect(await post(otherSite)).toEqual({ status: 403, body: { error: 'jwt_scope' } });
  });

  it('refuses a batch whose URLs are on another host than the JWT names', async () => {
    await start();
    for (const url of [
      'https://evil.example.net/',
      'https://shop.example.com/',
      'https://example.com.evil.net/',
      'https://example.com:8443/',
      'http://example.com:22/',
    ]) {
      expect(await post(batchBody({ urls: [url] }))).toEqual({
        status: 403,
        body: { error: 'jwt_scope' },
      });
    }
  });

  it('refuses a JWT minted for another check, batch or nonce', async () => {
    await start();
    expect(
      (await post(batchBody({}, { check_id: '00000000-0000-4000-8000-0000000000cf' }))).status,
    ).toBe(403);
    expect((await post(batchBody({}, { batch: 999 }))).status).toBe(403);
    expect((await post(batchBody({}, { nonce: 'another-nonce-0000001' }))).status).toBe(403);
  });

  it('refuses an expired JWT, and one signed by another key', async () => {
    const { clock } = await start();
    const iat = Math.floor(clock.now() / 1000) - 1000;
    expect(await post(batchBody({}, { iat, exp: iat + 900 }))).toEqual({
      status: 401,
      body: { error: 'jwt_invalid', reason: 'expired' },
    });
    const body = batchBody();
    body.jwt = signJwt(
      keyPair().privateKey,
      claims({ now: clock.now(), batch: body.batch as number, nonce: body.nonce as string }),
    );
    expect(await post(body)).toEqual({
      status: 401,
      body: { error: 'jwt_invalid', reason: 'bad_signature' },
    });
  });
});

describe('POST /batch: the body', () => {
  it.each(['max_requests', 'max_bytes', 'max_seconds'])(
    'refuses a batch without the %s budget',
    async (budget) => {
      await start();
      const body = batchBody();
      const b = { ...(body.budget as Record<string, number>) };
      delete b[budget];
      expect(await post({ ...body, budget: b })).toEqual({
        status: 400,
        body: { error: 'invalid_body', fields: [`budget.${budget}`] },
      });
    },
  );

  it('answers 401, not 500, to signed fields of the wrong type', async () => {
    await start();
    const raw = '{"check_id":{"toString":1,"valueOf":1},"batch":{"valueOf":1},"nonce":[]}';
    expect(await post(raw, { sign: () => 'ab'.repeat(32) })).toEqual({
      status: 401,
      body: { error: 'bad_signature' },
    });
  });

  it('checks the signature before the body, so an unsigned caller learns nothing of its shape', async () => {
    await start();
    expect(await post({ hello: 'world' }, { sign: () => 'ab'.repeat(32) })).toEqual({
      status: 401,
      body: { error: 'bad_signature' },
    });
  });

  it('refuses a batch with no budget at all, and an unknown field', async () => {
    await start();
    const body = batchBody();
    delete body.budget;
    expect((await post(body)).body).toEqual({ error: 'invalid_body', fields: ['budget'] });
    expect((await post({ ...batchBody(), rps: 10 })).body).toMatchObject({ error: 'invalid_body' });
  });

  it('refuses a __proto__ key and a body that is not JSON', async () => {
    await start();
    const body = batchBody();
    const raw = `{"__proto__":{"polluted":true},${JSON.stringify(body).slice(1)}`;
    expect((await post(raw)).body).toEqual({ error: 'invalid_json' });
    expect(await post('not json')).toEqual({ status: 400, body: { error: 'invalid_json' } });
  });

  it('checks the signature over the raw bytes before parsing anything', async () => {
    await start();
    // Unsigned, a body that is not JSON is refused for its signature, so nothing was parsed first.
    expect(await post('not json', { sign: () => 'ab'.repeat(32) })).toEqual({
      status: 401,
      body: { error: 'bad_signature' },
    });
    expect(await post('{"a":1}', { sign: () => 'ab'.repeat(32) })).toEqual({
      status: 401,
      body: { error: 'bad_signature' },
    });
  });

  it('refuses a signed body that is not valid UTF-8', async () => {
    const { base, clock } = await start();
    const raw = Buffer.concat([
      Buffer.from(JSON.stringify(batchBody()).slice(0, -1)),
      Buffer.from(',"x":"\xff"}', 'latin1'),
    ]);
    const ts = String(clock.now());
    const res = await fetch(`${base}/batch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-crawlmouse-ts': ts,
        'x-crawlmouse-signature': signBatch(SECRET, ts, raw),
      },
      body: raw,
    });
    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 400,
      body: { error: 'invalid_json' },
    });
  });

  it('refuses a URL listed twice, in any spelling the crawl treats as the same page', async () => {
    await start();
    const variant = await post(
      batchBody({ urls: ['https://example.com/a', 'https://EXAMPLE.com/a#top'] }),
    );
    expect(variant).toEqual({ status: 400, body: { error: 'invalid_body', fields: ['urls'] } });
    const r = await post(batchBody({ urls: ['https://example.com/a', 'https://example.com/a'] }));
    expect(r).toEqual({ status: 400, body: { error: 'invalid_body', fields: ['urls'] } });
  });

  it('refuses a body over 1 MB with 413', async () => {
    await start();
    expect((await post('x'.repeat(1024 * 1024 + 1), { sign: () => 'ab'.repeat(32) })).status).toBe(
      413,
    );
  });
});

describe('POST /batch: pause and capacity', () => {
  it('answers 503 when CRAWL_PAUSED is set, and runs nothing', async () => {
    const fetcher = fakeFetcher(new InstantClock(), () => ({ status: 200 }));
    const { worker } = await start({ paused: true }, fetcher);
    expect(await post(batchBody())).toEqual({ status: 503, body: { error: 'paused' } });
    await worker.idle();
    expect(fetcher.calls).toHaveLength(0);
  });

  it('reads CRAWL_PAUSED exactly as the app does', () => {
    for (const v of ['1', ' 1\n', '0', 'true', 'yes', '', undefined, '11']) {
      expect(isCrawlPaused({ CRAWL_PAUSED: v })).toBe(appIsCrawlPaused({ CRAWL_PAUSED: v }));
    }
  });

  it('does not spend the nonce on a busy refusal: the same request is accepted once there is room', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const clock = new InstantClock();
    const slow: Fetcher = async (url, identity, limits) => {
      await gate;
      return fakeFetcher(clock, () => ({ status: 404, body: '' }))(url, identity, limits);
    };
    const { worker } = await start({ maxConcurrentBatches: 1 }, slow);
    expect((await post(batchBody())).status).toBe(202);
    const retried = batchBody();
    expect((await post(retried)).status).toBe(429);
    release();
    await worker.idle();
    expect((await post(retried)).status).toBe(202);
  });

  it('answers 429 when the maximum number of batches is running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const clock = new InstantClock();
    const slow: Fetcher = async (url, identity, limits) => {
      await gate;
      return fakeFetcher(clock, () => ({ status: 404, body: '' }))(url, identity, limits);
    };
    await start({ maxConcurrentBatches: 1 }, slow);
    expect((await post(batchBody())).status).toBe(202);
    expect(await post(batchBody())).toEqual({ status: 429, body: { error: 'busy' } });
    release();
  });
});

describe('GET /batch/{id}', () => {
  it('reports running with progress while a batch runs', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const clock = new InstantClock();
    const slow: Fetcher = async (url, identity, limits) => {
      await gate;
      return fakeFetcher(clock, () => ({ status: 404, body: '' }))(url, identity, limits);
    };
    await start({}, slow);
    const { body } = await post(batchBody());
    const id = String(body.batch_id);
    expect((await get(`/batch/${id}`, `batch:${id}`)).body).toEqual({
      batch_id: id,
      status: 'running',
      progress: { urls_done: 0, urls_total: 2, requests: 0 },
    });
    release();
  });

  it('reports failed when the batch throws inside the worker', async () => {
    const { worker } = await start({}, async () => {
      throw new Error('boom');
    });
    const { body } = await post(batchBody());
    await worker.idle();
    const id = String(body.batch_id);
    expect((await get(`/batch/${id}`, `batch:${id}`)).body).toMatchObject({ status: 'failed' });
  });

  it('answers 404 for an unknown id, and for a finished batch past its TTL', async () => {
    const { worker, clock } = await start();
    const unknown = `${CHECK}:424242`;
    expect((await get(`/batch/${unknown}`, `batch:${unknown}`)).status).toBe(404);
    const { body } = await post(batchBody());
    await worker.idle();
    const id = String(body.batch_id);
    clock.advance(RESULT_TTL_MS);
    expect((await get(`/batch/${id}`, `batch:${id}`)).status).toBe(404);
  });

  it('refuses a read signed for another batch or another purpose', async () => {
    const { worker } = await start();
    const { body } = await post(batchBody());
    await worker.idle();
    const id = String(body.batch_id);
    expect((await get(`/batch/${id}`, `batch:${CHECK}:0`)).status).toBe(401);
    expect((await get(`/batch/${id}`, 'metrics')).status).toBe(401);
  });
});

describe('GET /metrics', () => {
  it('needs a signature, and reports memory, lag, batches and requests per site', async () => {
    const { base, worker } = await start();
    expect((await fetch(`${base}/metrics`)).status).toBe(401);
    await post(batchBody());
    await worker.idle();
    const m = await get('/metrics', 'metrics');
    expect(m.status).toBe(200);
    expect(Object.keys(m.body).sort()).toEqual(
      [
        'batches_running',
        'batches_stored',
        'event_loop_lag_p99_ms',
        'heap_used_mb',
        'peak_rss_mb',
        'requests_per_site',
        'rss_mb',
      ].sort(),
    );
    // The process's peak resident memory since it started, from /proc on Linux (the VM); null elsewhere.
    if (process.platform !== 'linux') {
      expect(m.body.peak_rss_mb).toBeNull();
      return;
    }
    // A peak well above what the process holds now: 256 MiB touched, then freed.
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as () => void;
    let big: Buffer | null = Buffer.alloc(256 * 1048576, 1);
    expect(big[big.length - 1]).toBe(1);
    big = null;
    gc();
    const hwm = () =>
      Math.round(
        Number(/^VmHWM:\s+(\d+) kB$/m.exec(readFileSync('/proc/self/status', 'utf8'))![1]) / 1024,
      );
    const before = hwm();
    const mem = (await get('/metrics', 'metrics')).body as { peak_rss_mb: number; rss_mb: number };
    expect(mem.peak_rss_mb).toBeGreaterThanOrEqual(before);
    expect(mem.peak_rss_mb).toBeLessThanOrEqual(hwm());
    expect(mem.peak_rss_mb).toBeGreaterThan(mem.rss_mb + 128);
    // Two origins (www and bare), so two robots.txt reads, then the two pages: one site key.
    expect(m.body.requests_per_site).toEqual({ 'example.com': 4 });
  });
});

describe('what the worker writes to its log', () => {
  it('never the signing secret, a JWT, a header or a page URL', async () => {
    const { worker, logs } = await start();
    const body = batchBody();
    await post(body);
    await post(body);
    await post(batchBody(), { sign: () => 'ab'.repeat(32) });
    await worker.idle();
    const text = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of [
      SECRET,
      String(body.jwt),
      'x-crawlmouse',
      'https://www.example.com/',
      'https://example.com/a',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('configuration', () => {
  it('requires a signing secret of 32+ characters and an Ed25519 public key', () => {
    expect(() => loadConfig({ WORKER_JWT_PUBLIC_KEY: keys.publicKeyEnv })).toThrow(
      /WORKER_SIGNING_SECRET/,
    );
    expect(() =>
      loadConfig({ WORKER_SIGNING_SECRET: 'short', WORKER_JWT_PUBLIC_KEY: keys.publicKeyEnv }),
    ).toThrow(/WORKER_SIGNING_SECRET/);
    expect(() => loadConfig({ WORKER_SIGNING_SECRET: SECRET })).toThrow(/WORKER_JWT_PUBLIC_KEY/);
    expect(() =>
      loadConfig({
        WORKER_SIGNING_SECRET: SECRET,
        WORKER_JWT_PUBLIC_KEY: keys.publicKeyEnv,
        MAX_CONCURRENT_BATCHES: '0',
      }),
    ).toThrow();
  });

  it('reads no environment variable but its own five: no database or Inngest key can reach it', () => {
    const read = new Set<string>();
    for (const file of ['main.ts', 'config.ts', 'server.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      for (const m of source.matchAll(/\benv\.([A-Z_]+)/g)) read.add(m[1]!);
      expect(source.match(/process\.env\.[A-Z_]/g)).toBeNull();
    }
    expect([...read].sort()).toEqual([
      'CRAWL_PAUSED',
      'MAX_CONCURRENT_BATCHES',
      'PORT',
      'WORKER_JWT_PUBLIC_KEY',
      'WORKER_SIGNING_SECRET',
    ]);
  });

  it('the entry point and config pass the fetcher nothing that bypasses the SSRF guard', () => {
    for (const file of ['main.ts', 'config.ts', 'server.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source).not.toMatch(/bypassSsrf|resolver/);
    }
    const server = readFileSync(new URL('server.ts', import.meta.url), 'utf8');
    expect(server).toContain('createFetcher(clock)');
  });
});

describe('POST /batch: what an unsigned request can hold', () => {
  /** Sends the headers and one chunk of the body, holds the rest back, and waits for the answer. */
  async function partialPost(
    headers: Record<string, string>,
  ): Promise<{ status: number; body: unknown }> {
    const { request } = await import('node:http');
    return new Promise((resolve, reject) => {
      const req = request(`${current!.base}/batch`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(1024 * 1024),
          ...headers,
        },
      });
      req.on('response', (res) => {
        let text = '';
        res.on('data', (d: Buffer) => (text += d.toString()));
        res.on('end', () => {
          req.destroy();
          resolve({ status: res.statusCode!, body: JSON.parse(text) });
        });
      });
      req.on('error', reject);
      req.write('x'.repeat(1000));
      setTimeout(() => reject(new Error('no answer while the body was held back')), 3000);
    });
  }

  it('refuses a stale timestamp before reading the body', async () => {
    const { clock } = await start();
    const r = await partialPost({
      'x-crawlmouse-ts': String(clock.now() - 6 * 60_000),
      'x-crawlmouse-signature': 'ab'.repeat(32),
    });
    expect(r).toEqual({ status: 401, body: { error: 'stale_ts' } });
  });

  it('refuses a missing timestamp or a signature that is not 64 hex characters before reading the body', async () => {
    const { clock } = await start();
    expect(await partialPost({ 'x-crawlmouse-signature': 'ab'.repeat(32) })).toEqual({
      status: 401,
      body: { error: 'bad_ts' },
    });
    expect(
      await partialPost({ 'x-crawlmouse-ts': String(clock.now()), 'x-crawlmouse-signature': 'zz' }),
    ).toEqual({ status: 401, body: { error: 'bad_signature' } });
  });

  it(
    `gives a signed-looking body ${BODY_DEADLINE_MS / 1000} s to arrive`,
    async () => {
      const { clock } = await start();
      const r = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        void import('node:http').then(({ request }) => {
          const req = request(`${current!.base}/batch`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'content-length': '100',
              'x-crawlmouse-ts': String(clock.now()),
              'x-crawlmouse-signature': 'ab'.repeat(32),
            },
          });
          req.on('response', (res) => {
            let text = '';
            res.on('data', (d: Buffer) => (text += d.toString()));
            res.on('end', () => {
              req.destroy();
              resolve({ status: res.statusCode!, body: JSON.parse(text) });
            });
          });
          req.on('error', reject);
          req.write('{');
        });
      });
      expect(r).toEqual({ status: 408, body: { error: 'body_timeout' } });
    },
    BODY_DEADLINE_MS + 5000,
  );
});
