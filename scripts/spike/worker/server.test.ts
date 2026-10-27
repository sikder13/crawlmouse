import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWorker, loadConfig, type Worker, type WorkerDeps } from './server.js';
import { signBatch, signJwt, signTs, MAX_SKEW_MS } from './auth.js';
import type { Fetcher } from './fetcher.js';

// Test-only values, not credentials of any system.
const SIGNING = 'unit-test-signing-value-not-a-credential';
const JWT_SECRET = 'unit-test-jwt-value-not-a-credential';

const okFetcher: Fetcher = async (url, identity) => ({
  identity,
  host: new URL(url).hostname,
  status: url.endsWith('/robots.txt') ? 404 : 200,
  ms: 1,
  bytes: 10,
  hops: 0,
  words: 10,
  body: '<html>x</html>',
  shape: { status: url.endsWith('/robots.txt') ? 404 : 200, headers: {}, bodyHead: '', words: 10 },
});

interface Started {
  w: Worker;
  base: string;
  posts: Array<{ url: string; headers: Record<string, string>; body: string }>;
  logs: Array<Record<string, unknown>>;
}
const open: Worker[] = [];
afterEach(async () => {
  for (const w of open.splice(0)) {
    await w.idle();
    w.server.closeAllConnections();
    await new Promise<void>((r) => w.server.close(() => r()));
  }
});

async function start(over: Partial<WorkerDeps> & { cfg?: Partial<ReturnType<typeof loadConfig>> } = {}): Promise<Started> {
  const posts: Started['posts'] = [];
  const logs: Started['logs'] = [];
  const w = createWorker({
    config: { ...loadConfig({ INTERNAL_SIGNING_SECRET: SIGNING }), completionUrl: 'https://app.example.invalid/api/internal/batch-done', ...over.cfg },
    fetch: okFetcher,
    httpPost: async (url, headers, body) => {
      posts.push({ url, headers, body });
      return 200;
    },
    log: (e) => logs.push(e),
    ...over,
  });
  await new Promise<void>((r) => w.server.listen(0, '127.0.0.1', r));
  open.push(w);
  return { w, base: `http://127.0.0.1:${(w.server.address() as { port: number }).port}`, posts, logs };
}

function batchBody(over: Record<string, unknown> = {}, jwtOver: Record<string, unknown> = {}, jwtExp = Date.now() / 1000 + 900) {
  const o = { checkId: 'chk1', batch: 1, nonce: 'nonce-12345678' };
  const jwt = signJwt({ check_id: o.checkId, batch: o.batch, nonce: o.nonce, role: 'crawl_worker', exp: jwtExp, ...jwtOver }, JWT_SECRET);
  return {
    ...o,
    batchId: 'chk1:1',
    kind: 'crawl',
    urls: [{ url: 'http://10.255.255.1/a', hash: 'h', depth: 1 }],
    hostPolicy: { rps: 2 },
    jwt,
    ...over,
  };
}

async function send(
  base: string,
  body: Record<string, unknown>,
  opts: { ts?: string; secret?: string; raw?: string; sig?: string } = {},
) {
  const raw = opts.raw ?? JSON.stringify(body);
  const ts = opts.ts ?? String(Date.now());
  const signature =
    opts.sig ?? signBatch({ ts, checkId: String(body.checkId), batch: Number(body.batch), nonce: String(body.nonce), body: raw, secret: opts.secret ?? SIGNING });
  const res = await fetch(`${base}/batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-crawlmouse-ts': ts, 'x-crawlmouse-signature': signature },
    body: raw,
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('POST /batch', () => {
  it('accepts a signed batch with 202, runs it, and reports completion with the per-batch JWT as bearer', async () => {
    const s = await start();
    const body = batchBody();
    const r = await send(s.base, body);
    expect(r.status).toBe(202);
    await s.w.idle();
    expect(s.posts).toHaveLength(1);
    expect(s.posts[0]!.headers.authorization).toBe(`Bearer ${body.jwt}`);
    const sent = JSON.parse(s.posts[0]!.body);
    expect(sent).toMatchObject({ checkId: 'chk1', batch: 1, nonce: 'nonce-12345678' });
    expect(sent.counters.fetched).toBe(1);
    // The completion call carries the batch JWT and nothing else secret.
    expect(JSON.stringify(s.posts[0]!.headers)).not.toContain(SIGNING);
    expect(s.posts[0]!.body).not.toContain(SIGNING);
  });

  it('rejects a bad signature, a tampered body, and a stale timestamp with 401', async () => {
    const s = await start();
    expect((await send(s.base, batchBody(), { sig: 'ab'.repeat(32) })).status).toBe(401);
    expect((await send(s.base, batchBody(), { secret: 'other-secret-value-xx' })).status).toBe(401);
    const stale = await send(s.base, batchBody({}, {}), { ts: String(Date.now() - MAX_SKEW_MS - 5000) });
    expect(stale.status).toBe(401);
    expect(stale.json.error).toBe('stale_ts');
    const body = batchBody();
    const good = JSON.stringify(body);
    const tampered = good.replace('"depth":1', '"depth":2');
    const ts = String(Date.now());
    const sig = signBatch({ ts, checkId: 'chk1', batch: 1, nonce: 'nonce-12345678', body: good, secret: SIGNING });
    expect((await send(s.base, body, { ts, raw: tampered, sig })).status).toBe(401);
    expect(s.posts).toHaveLength(0);
  });

  it('refuses a replayed nonce with 409 and runs the batch once', async () => {
    const s = await start();
    const body = batchBody();
    expect((await send(s.base, body)).status).toBe(202);
    const again = await send(s.base, body, { ts: String(Date.now() + 1) });
    expect(again.status).toBe(409);
    await s.w.idle();
    expect(s.posts).toHaveLength(1);
  });

  it('refuses a JWT that is expired, or minted for another batch (stub path, claims only)', async () => {
    const s = await start();
    const expired = await send(s.base, batchBody({ nonce: 'nonce-aaaaaaa1' }, { nonce: 'nonce-aaaaaaa1' }, Date.now() / 1000 - 5));
    expect(expired.json.error).toBe('jwt_expired');
    const other = await send(s.base, batchBody({ nonce: 'nonce-aaaaaaa2' }, { batch: 2 }));
    expect(other.json.error).toBe('jwt_claim_mismatch');
    const junk = await send(s.base, batchBody({ nonce: 'nonce-aaaaaaa3', jwt: 'not.a.jwt' }));
    expect(junk.json.error).toBe('jwt_malformed');
    expect([expired.status, other.status, junk.status]).toEqual([401, 401, 401]);
  });

  it('verifies the JWT signature when a JWT secret is configured', async () => {
    const s = await start({ cfg: { jwtSecret: JWT_SECRET } });
    const good = await send(s.base, batchBody({ nonce: 'nonce-bbbbbbb1' }, { nonce: 'nonce-bbbbbbb1' }));
    expect(good.status).toBe(202);
    const forged = signJwt({ check_id: 'chk1', batch: 1, nonce: 'nonce-bbbbbbb2', role: 'crawl_worker', exp: Date.now() / 1000 + 60 }, 'wrong-secret-value-xx');
    const bad = await send(s.base, batchBody({ nonce: 'nonce-bbbbbbb2', jwt: forged }));
    expect(bad.json.error).toBe('jwt_bad_signature');
  });

  it('refuses a (checkId, batch) with no open batch row', async () => {
    const s = await start({ isOpenBatch: async () => false });
    expect((await send(s.base, batchBody())).status).toBe(404);
  });

  it('validates the body shape', async () => {
    const s = await start();
    const bad = async (over: Record<string, unknown>, n: string) => (await send(s.base, batchBody({ nonce: n, ...over }, { nonce: n }))).status;
    expect(await bad({ urls: [] }, 'nonce-ccccccc1')).toBe(400);
    expect(await bad({ urls: Array.from({ length: 51 }, () => ({ url: 'http://a.test/', hash: 'h', depth: 1 })) }, 'nonce-ccccccc2')).toBe(400);
    expect(await bad({ kind: 'other' }, 'nonce-ccccccc3')).toBe(400);
    expect(await bad({ hostPolicy: { rps: 'fast' } }, 'nonce-ccccccc4')).toBe(400);
    const notJson = await send(s.base, batchBody(), { raw: '{nope' });
    expect(notJson.status).toBe(400);
  });

  it('rejects a body over 1 MB with 413', async () => {
    const s = await start();
    const r = await send(s.base, batchBody(), { raw: JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 10) }) });
    expect(r.status).toBe(413);
  });

  it('answers 429 when the concurrent batch limit is reached', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: Fetcher = async (u, i) => {
      await gate;
      return okFetcher(u, i);
    };
    const s = await start({ fetch: slow, cfg: { maxConcurrentBatches: 1 } });
    expect((await send(s.base, batchBody({ nonce: 'nonce-ddddddd1' }, { nonce: 'nonce-ddddddd1' }))).status).toBe(202);
    expect((await send(s.base, batchBody({ nonce: 'nonce-ddddddd2' }, { nonce: 'nonce-ddddddd2' }))).status).toBe(429);
    release();
  });

  it('retries completion on a 5xx and stops on a 4xx', async () => {
    const statuses = [503, 502, 200];
    const calls: number[] = [];
    const s = await start({
      retryDelaysMs: [1, 1, 1],
      httpPost: async () => {
        const st = statuses[calls.length] ?? 200;
        calls.push(st);
        return st;
      },
    });
    await send(s.base, batchBody());
    await s.w.idle();
    expect(calls).toEqual([503, 502, 200]);

    const four: number[] = [];
    const s2 = await start({ retryDelaysMs: [1, 1], httpPost: async () => (four.push(409), 409) });
    await send(s2.base, batchBody({ nonce: 'nonce-eeeeeee1' }, { nonce: 'nonce-eeeeeee1' }));
    await s2.w.idle();
    expect(four).toEqual([409]);
  });

  it('never logs the signing secret, the JWT, or a header', async () => {
    const s = await start();
    const body = batchBody();
    await send(s.base, body);
    await s.w.idle();
    const text = JSON.stringify(s.logs);
    expect(text).not.toContain(SIGNING);
    expect(text).not.toContain(String(body.jwt));
    expect(text.toLowerCase()).not.toContain('authorization');
  });
});

describe('signed reads', () => {
  it('/metrics and /results need a valid timestamped signature', async () => {
    const s = await start();
    const ts = String(Date.now());
    const unsigned = await fetch(`${s.base}/metrics`);
    expect(unsigned.status).toBe(401);
    const ok = await fetch(`${s.base}/metrics`, {
      headers: { 'x-crawlmouse-ts': ts, 'x-crawlmouse-signature': signTs({ ts, purpose: 'metrics', secret: SIGNING }) },
    });
    expect(ok.status).toBe(200);
    const m = (await ok.json()) as Record<string, number>;
    expect(m.rssMb).toBeGreaterThan(0);
    expect(m).toHaveProperty('eventLoopLagP99Ms');

    await send(s.base, batchBody());
    await s.w.idle();
    const wrongPurpose = await fetch(`${s.base}/results/chk1/1`, {
      headers: { 'x-crawlmouse-ts': ts, 'x-crawlmouse-signature': signTs({ ts, purpose: 'metrics', secret: SIGNING }) },
    });
    expect(wrongPurpose.status).toBe(401);
    const results = await fetch(`${s.base}/results/chk1/1`, {
      headers: { 'x-crawlmouse-ts': ts, 'x-crawlmouse-signature': signTs({ ts, purpose: 'results:chk1:1', secret: SIGNING }) },
    });
    expect(results.status).toBe(200);
  });
});

describe('configuration', () => {
  it('requires a signing secret and has no setting that bypasses the SSRF guard', () => {
    expect(() => loadConfig({})).toThrow(/INTERNAL_SIGNING_SECRET/);
    expect(() => loadConfig({ INTERNAL_SIGNING_SECRET: 'short' })).toThrow();
    const cfg = loadConfig({ INTERNAL_SIGNING_SECRET: SIGNING, SPIKE_BYPASS_SSRF: '1', BYPASS_SSRF: '1' });
    expect(JSON.stringify(cfg).toLowerCase()).not.toContain('bypass');
  });

  it('main.ts builds the worker from config only: no bypass or resolver override is passed to the fetcher', () => {
    const src = readFileSync(fileURLToPath(new URL('./main.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/bypassSsrf|safeFetchOverrides|resolver|unsafeGapOverrideMs/);
  });

  it('the worker sources carry no Inngest key or service-role key', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    for (const f of ['server.ts', 'main.ts', 'batch.ts', 'fetcher.ts']) {
      const src = readFileSync(dir + f, 'utf8');
      expect(src).not.toMatch(/INNGEST_|SERVICE_ROLE/i);
    }
  });
});

describe('http plumbing', () => {
  it('404s unknown routes and methods', async () => {
    const s = await start();
    expect((await fetch(`${s.base}/nope`)).status).toBe(404);
    expect((await fetch(`${s.base}/batch`)).status).toBe(404);
    expect((await fetch(`${s.base}/healthz`)).status).toBe(200);
    void http;
  });
});
