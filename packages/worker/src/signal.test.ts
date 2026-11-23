import { createHmac, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signBatch, signRead } from './auth/hmac.js';
import { loadConfig } from './config.js';
import {
  createDoneSignal,
  SIGNAL_REPEAT_MS,
  SIGNAL_REQUEST_MS,
  signSignal,
  type SignalPost,
} from './signal.js';

const SECRET = 's'.repeat(32);
const URL_ = 'https://app.example.test/api/webhooks/worker';
const ENDED = {
  check_id: '00000000-0000-4000-8000-000000000001',
  batch: 3,
  status: 'done',
} as const;
const NOW = 1_800_000_000_000;

beforeEach(() => vi.useFakeTimers({ now: NOW }));
afterEach(() => vi.useRealTimers());

function harness(post: SignalPost = vi.fn(async () => undefined)) {
  const logged: Record<string, unknown>[] = [];
  const signal = createDoneSignal({
    url: URL_,
    secret: SECRET,
    now: () => Date.now(),
    post,
    log: (e) => logged.push(e),
  });
  return { signal, post: post as ReturnType<typeof vi.fn>, logged };
}

describe('the done signal', () => {
  it('posts ids and the batch number only, to the configured address', async () => {
    const h = harness();
    h.signal(ENDED);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.post).toHaveBeenCalledTimes(1);
    const [url, init] = h.post.mock.calls[0]!;
    expect(url).toBe(URL_);
    expect(JSON.parse(init.body)).toEqual(ENDED);
  });

  it('signs the raw body with its own context, under the time header', async () => {
    const h = harness();
    h.signal(ENDED);
    await vi.advanceTimersByTimeAsync(0);
    const init = h.post.mock.calls[0]![1];
    const ts = init.headers['x-crawlmouse-ts'];
    expect(ts).toBe(String(NOW));
    const expected = createHmac('sha256', SECRET).update(`${ts}.signal:${init.body}`).digest('hex');
    expect(init.headers['x-crawlmouse-signature']).toBe(expected);
    expect(signSignal(SECRET, ts, init.body)).toBe(expected);
  });

  it('cannot be replayed as a signature for a batch post or a read', () => {
    const raw = JSON.stringify(ENDED);
    const ts = String(NOW);
    expect(signSignal(SECRET, ts, raw)).not.toBe(signBatch(SECRET, ts, raw));
    expect(signSignal(SECRET, ts, raw)).not.toBe(signRead(SECRET, ts, raw));
  });

  it('sends once more after the repeat delay, for a wait registered just after the first', async () => {
    const h = harness();
    h.signal(ENDED);
    await vi.advanceTimersByTimeAsync(SIGNAL_REPEAT_MS - 1);
    expect(h.post).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.post).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SIGNAL_REPEAT_MS * 10);
    expect(h.post).toHaveBeenCalledTimes(2);
  });

  it('never throws, and logs no address, when the app does not answer', async () => {
    const h = harness(vi.fn(async () => Promise.reject(new Error(`refused ${URL_}`))));
    expect(() => h.signal(ENDED)).not.toThrow();
    await vi.advanceTimersByTimeAsync(SIGNAL_REPEAT_MS);
    expect(h.logged).toHaveLength(2);
    expect(JSON.stringify(h.logged)).not.toContain('app.example.test');
  });

  it('gives each request a deadline', async () => {
    const h = harness(vi.fn(() => new Promise<unknown>(() => undefined)));
    h.signal(ENDED);
    await vi.advanceTimersByTimeAsync(0);
    const { signal } = h.post.mock.calls[0]![1] as { signal: AbortSignal };
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(SIGNAL_REQUEST_MS);
    expect(signal.aborted).toBe(true);
  });
});

describe('APP_SIGNAL_URL', () => {
  const x = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x!;
  const of = (APP_SIGNAL_URL?: string) =>
    loadConfig({ WORKER_SIGNING_SECRET: SECRET, WORKER_JWT_PUBLIC_KEY: x, APP_SIGNAL_URL })
      .appSignalUrl;

  it('takes an https address', () => expect(of(URL_)).toBe(URL_));
  it.each([
    undefined,
    '',
    'not a url',
    'http://app.example.test/x',
    'https://u:p@app.example.test/x',
  ])('ignores %s, so the worker polls as before', (v) => expect(of(v)).toBeNull());
});
