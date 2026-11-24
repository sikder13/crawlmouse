import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { readRendered } from '@crawlmouse/engine/worker';
import { afterEach, describe, expect, it } from 'vitest';
import { signBatch, signMeasure, signRead } from './auth/hmac.js';
import { loadConfig } from './config.js';
import { inlineReader, type PageReader } from './reader/read.js';
import { MAX_MEASURE_BODY_BYTES, createWorker, type Worker } from './server.js';
import { signSignal } from './signal.js';
import { InstantClock } from './test-support/clock.js';
import { fakeFetcher } from './test-support/fake-fetcher.js';
import { keyPair } from './test-support/jwt.js';

/** POST /render/measure (questions/042, design C): a page's two renders, read on the reader thread. */
const SECRET = 'k'.repeat(48);
const keys = keyPair();
let worker: Worker | null = null;
afterEach(async () => {
  if (!worker) return;
  const w = worker;
  worker = null;
  await new Promise<void>((r) => w.server.close(() => r()));
});

const reading: PageReader = {
  ...inlineReader,
  rendered: async (s, r, url) => readRendered(s, r, url),
};

async function start(reader: PageReader = reading) {
  const clock = new InstantClock(1_800_000_000_000);
  worker = createWorker({
    config: loadConfig({ WORKER_SIGNING_SECRET: SECRET, WORKER_JWT_PUBLIC_KEY: keys.publicKeyEnv }),
    clock,
    fetcher: fakeFetcher(clock, () => ({ status: 200 })),
    log: () => {},
    reader,
  });
  await new Promise<void>((r) => worker!.server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(worker.server.address() as AddressInfo).port}`, clock };
}

const PAGE = {
  static_html: '<html><body><div id="root"></div></body></html>',
  rendered_html: '<html><body><main><h1>Ridge tent</h1><p>Two person.</p></main></body></html>',
  url: 'https://example.com/p',
};

async function post(
  base: string,
  ts: string,
  raw: string,
  sign: (ts: string, raw: string) => string = (t, r) => signMeasure(SECRET, t, r),
) {
  const res = await fetch(`${base}/render/measure`, {
    method: 'POST',
    headers: { 'x-crawlmouse-ts': ts, 'x-crawlmouse-signature': sign(ts, raw) },
    body: raw,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /render/measure', () => {
  it('answers what the engine reads inline, for a signed request', async () => {
    const { base, clock } = await start();
    const r = await post(base, String(clock.now()), JSON.stringify(PAGE));
    expect(r).toEqual({
      status: 200,
      body: { reading: readRendered(PAGE.static_html, PAGE.rendered_html, PAGE.url) },
    });
  });

  it('answers that the read failed when the reader gave up on the page', async () => {
    const { base, clock } = await start({
      ...inlineReader,
      rendered: async () => ({ failed: 'reader_deadline' }),
    });
    const r = await post(base, String(clock.now()), JSON.stringify(PAGE));
    expect(r).toEqual({ status: 200, body: { failed: 'reader_deadline' } });
  });

  it.each([
    ['a batch signature', (ts: string, raw: string) => signBatch(SECRET, ts, raw)],
    ['a done-signal signature', (ts: string, raw: string) => signSignal(SECRET, ts, raw)],
    ['a read signature', (ts: string) => signRead(SECRET, ts, 'render/measure')],
    ['the wrong secret', (ts: string, raw: string) => signMeasure('x'.repeat(48), ts, raw)],
  ])('refuses %s', async (_name, sign) => {
    const { base, clock } = await start();
    const r = await post(base, String(clock.now()), JSON.stringify(PAGE), sign);
    expect(r).toEqual({ status: 401, body: { error: 'bad_signature' } });
  });

  it('refuses a stale time before it reads the body', async () => {
    const { base, clock } = await start();
    const r = await post(base, String(clock.now() - 10 * 60_000), JSON.stringify(PAGE));
    expect(r).toEqual({ status: 401, body: { error: 'stale_ts' } });
  });

  it('refuses a body over its limit', async () => {
    const { base, clock } = await start();
    const big = JSON.stringify({ ...PAGE, rendered_html: 'x'.repeat(MAX_MEASURE_BODY_BYTES) });
    const r = await post(base, String(clock.now()), big);
    expect(r.status).toBe(413);
  });

  it('refuses a body that is not the measure request', async () => {
    const { base, clock } = await start();
    const r = await post(base, String(clock.now()), JSON.stringify({ static_html: 'x' }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_body');
  });

  it('refuses when the worker has no bounded reader to read on', async () => {
    const { base, clock } = await start(inlineReader);
    const r = await post(base, String(clock.now()), JSON.stringify(PAGE));
    expect(r).toEqual({ status: 503, body: { error: 'reader_unavailable' } });
  });
});

describe('the measure key', () => {
  it('signs as an HMAC computed apart from hmac.ts: the key derived from the label, then ts and body', () => {
    const key = createHmac('sha256', SECRET).update('crawlmouse-worker-measure-v1').digest();
    const expected = createHmac('sha256', key).update('123.').update('{"a":1}').digest('hex');
    expect(signMeasure(SECRET, '123', '{"a":1}')).toBe(expected);
  });
});
