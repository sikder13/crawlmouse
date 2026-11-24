import { createHash, createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readRendered } from '@crawlmouse/engine/worker';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256Hex, signBatch, signMeasure, signRead } from './auth/hmac.js';
import { loadConfig } from './config.js';
import { readMeasure, type MeasureReader } from './reader/measure.js';
import { inlineReader, type PageReader } from './reader/read.js';
import {
  MAX_MEASURE_BODY_BYTES,
  MEASURE_CONCURRENCY,
  createWorker,
  type Worker,
} from './server.js';
import { signSignal } from './signal.js';
import { InstantClock } from './test-support/clock.js';
import { fakeFetcher } from './test-support/fake-fetcher.js';
import { keyPair } from './test-support/jwt.js';

/**
 * POST /render/measure (questions/042, design C): a page's two renders, read on the measure thread.
 * Here the measure reader runs measure.ts inline; reader/rendered.test.ts runs it on a real thread.
 */
const SECRET = 'k'.repeat(48);
const keys = keyPair();
let worker: Worker | null = null;
afterEach(async () => {
  if (!worker) return;
  const w = worker;
  worker = null;
  w.server.closeAllConnections();
  await new Promise<void>((r) => w.server.close(() => r()));
});

const inlineMeasure: MeasureReader = { measure: async (b) => readMeasure(b) };

async function start(measureReader: MeasureReader | null = inlineMeasure, reader?: PageReader) {
  const clock = new InstantClock(1_800_000_000_000);
  worker = createWorker({
    config: loadConfig({ WORKER_SIGNING_SECRET: SECRET, WORKER_JWT_PUBLIC_KEY: keys.publicKeyEnv }),
    clock,
    fetcher: fakeFetcher(clock, () => ({ status: 200 })),
    log: () => {},
    reader: reader ?? inlineReader,
    ...(measureReader && { measureReader }),
  });
  await new Promise<void>((r) => worker!.server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(worker.server.address() as AddressInfo).port}`, clock };
}

const PAGE = {
  static_html: '<html><body><div id="root"></div></body></html>',
  rendered_html: '<html><body><main><h1>Ridge tent</h1><p>Two person.</p></main></body></html>',
  url: 'https://example.com/p',
};
const PAGE_RAW = JSON.stringify(PAGE);

interface Signed {
  ts: string;
  sha256: string;
  bytes: string;
  signature: string;
}
/** The headers the app's client sends for `raw`; a test overrides any of them. */
function signed(ts: string, raw: string, over: Partial<Signed> = {}): Signed {
  const bytes = Buffer.byteLength(raw);
  const sha256 = sha256Hex(Buffer.from(raw));
  return {
    ts,
    sha256,
    bytes: String(bytes),
    signature: signMeasure(SECRET, ts, sha256, bytes),
    ...over,
  };
}

async function post(base: string, raw: string, h: Signed) {
  const res = await fetch(`${base}/render/measure`, {
    method: 'POST',
    headers: {
      'x-crawlmouse-ts': h.ts,
      'x-crawlmouse-body-sha256': h.sha256,
      'x-crawlmouse-body-bytes': h.bytes,
      'x-crawlmouse-signature': h.signature,
    },
    body: raw,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/**
 * Sends `h` with a body that starts and never finishes, and resolves with the answer's status. A route
 * that read the body before answering would answer only at its body deadline.
 */
function unfinished(base: string, h: Signed): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: Number(new URL(base).port),
      method: 'POST',
      path: '/render/measure',
      headers: {
        'x-crawlmouse-ts': h.ts,
        'x-crawlmouse-body-sha256': h.sha256,
        'x-crawlmouse-body-bytes': h.bytes,
        'x-crawlmouse-signature': h.signature,
        'content-length': String(MAX_MEASURE_BODY_BYTES),
      },
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
      req.destroy();
    });
    req.on('error', reject);
    req.write('{"static_html":"');
  });
}

/** A reader whose reads wait until `release` is called, counting how many it was given. */
function holding(): MeasureReader & { taken: number; release: () => void } {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const h = {
    taken: 0,
    release: () => open(),
    measure: async (b: Uint8Array) => {
      h.taken++;
      await gate;
      return readMeasure(b);
    },
  };
  return h;
}

describe('POST /render/measure', () => {
  it('answers what the engine reads inline, for a signed request', async () => {
    const { base, clock } = await start();
    const r = await post(base, PAGE_RAW, signed(String(clock.now()), PAGE_RAW));
    expect(r).toEqual({
      status: 200,
      body: { reading: readRendered(PAGE.static_html, PAGE.rendered_html, PAGE.url) },
    });
  });

  it('reads on the measure reader, never the crawl reader', async () => {
    const crawl = { ...inlineReader, words: () => Promise.reject(new Error('crawl reader')) };
    const page = () => Promise.reject(new Error('crawl reader'));
    const { base, clock } = await start(inlineMeasure, { ...crawl, page });
    const r = await post(base, PAGE_RAW, signed(String(clock.now()), PAGE_RAW));
    expect(r).toEqual({
      status: 200,
      body: { reading: readRendered(PAGE.static_html, PAGE.rendered_html, PAGE.url) },
    });
  });

  it('answers that the read failed when the measure thread gave up on the page', async () => {
    const { base, clock } = await start({ measure: async () => ({ failed: 'reader_deadline' }) });
    const r = await post(base, PAGE_RAW, signed(String(clock.now()), PAGE_RAW));
    expect(r).toEqual({ status: 200, body: { failed: 'reader_deadline' } });
  });

  it('answers that the read failed, and keeps serving, when the read throws', async () => {
    let calls = 0;
    const { base, clock } = await start({
      measure: async (b) => (calls++ === 0 ? Promise.reject(new Error('boom')) : readMeasure(b)),
    });
    const first = await post(base, PAGE_RAW, signed(String(clock.now()), PAGE_RAW));
    expect(first).toEqual({ status: 200, body: { failed: 'read_threw' } });
    const next = await post(base, PAGE_RAW, signed(String(clock.now()), PAGE_RAW));
    expect(next.status).toBe(200);
  });

  it.each([
    ['a batch signature', (ts: string, raw: string) => signBatch(SECRET, ts, raw)],
    ['a done-signal signature', (ts: string, raw: string) => signSignal(SECRET, ts, raw)],
    ['a read signature', (ts: string) => signRead(SECRET, ts, 'render/measure')],
    [
      'the wrong secret',
      (ts: string, raw: string) =>
        signMeasure('x'.repeat(48), ts, sha256Hex(Buffer.from(raw)), Buffer.byteLength(raw)),
    ],
  ])('refuses %s', async (_name, sign) => {
    const { base, clock } = await start();
    const ts = String(clock.now());
    const r = await post(base, PAGE_RAW, signed(ts, PAGE_RAW, { signature: sign(ts, PAGE_RAW) }));
    expect(r).toEqual({ status: 401, body: { error: 'bad_signature' } });
  });

  it('refuses a body that is not the one signed, at the same length', async () => {
    const { base, clock } = await start();
    const other = PAGE_RAW.replace('Ridge', 'Ridgy');
    expect(other.length).toBe(PAGE_RAW.length);
    const r = await post(base, other, signed(String(clock.now()), PAGE_RAW));
    expect(r).toEqual({ status: 401, body: { error: 'bad_signature' } });
  });

  it.each([
    ['longer', PAGE_RAW + ' '],
    ['shorter', PAGE_RAW.slice(0, -1)],
  ])('refuses a body %s than the length signed', async (_name, raw) => {
    const { base, clock } = await start();
    const r = await post(base, raw, signed(String(clock.now()), PAGE_RAW));
    expect(r).toEqual({ status: 401, body: { error: 'bad_signature' } });
  });

  it.each([
    ['a digest that is not 64 hex characters', { sha256: 'abc' }],
    ['a length that is not a number', { bytes: '12x' }],
  ])('refuses %s', async (_name, over) => {
    const { base, clock } = await start();
    const r = await post(base, PAGE_RAW, signed(String(clock.now()), PAGE_RAW, over));
    expect(r).toEqual({ status: 401, body: { error: 'bad_signature' } });
  });

  it('refuses a stale time', async () => {
    const { base, clock } = await start();
    const r = await post(base, PAGE_RAW, signed(String(clock.now() - 10 * 60_000), PAGE_RAW));
    expect(r).toEqual({ status: 401, body: { error: 'stale_ts' } });
  });

  it('refuses a signed length over the limit without reading the body', async () => {
    const { base, clock } = await start();
    const ts = String(clock.now());
    const bytes = MAX_MEASURE_BODY_BYTES + 1;
    const sha256 = 'a'.repeat(64);
    const h = {
      ts,
      sha256,
      bytes: String(bytes),
      signature: signMeasure(SECRET, ts, sha256, bytes),
    };
    expect(await post(base, '{}', h)).toEqual({ status: 413, body: { error: 'too_large' } });
  });

  it('answers a bad signature from its headers, while the body is still arriving', async () => {
    const { base, clock } = await start();
    const h = signed(String(clock.now()), PAGE_RAW, { signature: 'f'.repeat(64) });
    expect(await unfinished(base, h)).toBe(401);
  });

  it('refuses a body that is not JSON, and one that is not the measure request', async () => {
    const { base, clock } = await start();
    const notJson = '{"static_html":';
    expect(await post(base, notJson, signed(String(clock.now()), notJson))).toEqual({
      status: 400,
      body: { error: 'invalid_json' },
    });
    const wrong = JSON.stringify({ static_html: 'x' });
    const r = await post(base, wrong, signed(String(clock.now()), wrong));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: 'invalid_body' });
  });

  it('refuses when the worker has no measure thread to read on', async () => {
    const { base, clock } = await start(null);
    const r = await post(base, PAGE_RAW, signed(String(clock.now()), PAGE_RAW));
    expect(r).toEqual({ status: 503, body: { error: 'reader_unavailable' } });
  });
});

describe('measuring slots', () => {
  it(`holds ${MEASURE_CONCURRENCY} signed requests, and answers the next one busy`, async () => {
    const reader = holding();
    const { base, clock } = await start(reader);
    const ts = String(clock.now());
    const held = Array.from({ length: MEASURE_CONCURRENCY }, () =>
      post(base, PAGE_RAW, signed(ts, PAGE_RAW)),
    );
    while (reader.taken < MEASURE_CONCURRENCY) await new Promise((r) => setTimeout(r, 5));
    expect(await post(base, PAGE_RAW, signed(ts, PAGE_RAW))).toEqual({
      status: 429,
      body: { error: 'measure_busy' },
    });
    reader.release();
    for (const r of await Promise.all(held)) expect(r.status).toBe(200);
  });

  it('gives no slot to a request whose signature fails, however long its body takes', async () => {
    const { base, clock } = await start();
    const ts = String(clock.now());
    const forged = signed(ts, PAGE_RAW, { signature: '0'.repeat(64) });
    const answers = Array.from({ length: MEASURE_CONCURRENCY * 2 }, () => unfinished(base, forged));
    // Their headers arrive first: a route that took a slot before checking would be full now.
    await new Promise((r) => setTimeout(r, 100));
    const started = Date.now();
    expect(await post(base, PAGE_RAW, signed(ts, PAGE_RAW))).toMatchObject({ status: 200 });
    for (const status of await Promise.all(answers)) expect(status).toBe(401);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('the measure key', () => {
  it('signs as an HMAC computed apart from hmac.ts: the derived key, over ts, digest and length', () => {
    const body = '{"a":1}';
    const digest = createHash('sha256').update(body).digest('hex');
    const key = createHmac('sha256', SECRET).update('crawlmouse-worker-measure-v1').digest();
    const expected = createHmac('sha256', key).update(`123.${digest}.7`).digest('hex');
    expect(sha256Hex(Buffer.from(body))).toBe(digest);
    expect(signMeasure(SECRET, '123', digest, 7)).toBe(expected);
  });
});
