import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemClock } from '../clock.js';
import { CRAWL } from '../identities.js';
import { createFetcher, MAX_BODY_BYTES } from './fetcher.js';
import { MAX_TIMING_MS, boundedMs, timed } from './timing.js';
import type { Clock } from '../clock.js';

/**
 * Per-request timing, observed from Node's http client diagnostics channel without touching
 * safeFetch: each request is told apart by the async context its fetch runs in.
 */

const limits = { maxBytes: MAX_BODY_BYTES, deadlineMs: 5_000 };
let server: http.Server;
let port = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const wait = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('wait') ?? '0');
    setTimeout(() => {
      res.setHeader('content-type', 'text/html');
      res.end('<html><body>ok</body></html>');
    }, wait);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const fetcher = createFetcher(systemClock, { bypassSsrf: true });

describe('request timing', () => {
  it('records DNS, connect, first byte and total as whole milliseconds, in that order', async () => {
    const f = await fetcher(`http://localhost:${port}/?wait=60`, CRAWL, limits);
    const t = f.timing;
    expect(t.dns_ms).not.toBeNull();
    expect(t.connect_ms).not.toBeNull();
    for (const v of [t.dns_ms, t.connect_ms, t.ttfb_ms, t.total_ms])
      expect(Number.isInteger(v)).toBe(true);
    expect(t.dns_ms!).toBeLessThanOrEqual(t.connect_ms!);
    expect(t.connect_ms!).toBeLessThanOrEqual(t.ttfb_ms!);
    expect(t.ttfb_ms!).toBeGreaterThanOrEqual(50);
    expect(t.ttfb_ms!).toBeLessThanOrEqual(t.total_ms);
  });

  it('records no DNS time for an address literal, which is not looked up', async () => {
    const f = await fetcher(`http://127.0.0.1:${port}/`, CRAWL, limits);
    expect(f.timing.dns_ms).toBeNull();
    expect(f.timing.connect_ms).not.toBeNull();
  });

  it('keeps concurrent requests apart: each gets its own first-byte time', async () => {
    const [slow, fast] = await Promise.all([
      fetcher(`http://127.0.0.1:${port}/?wait=250&a`, CRAWL, limits),
      fetcher(`http://127.0.0.1:${port}/?wait=0&b`, CRAWL, limits),
    ]);
    expect(slow.timing.ttfb_ms!).toBeGreaterThanOrEqual(230);
    expect(fast.timing.ttfb_ms!).toBeLessThan(150);
  });

  it('a request on a reused connection records neither DNS nor connect', async () => {
    // A server of its own, so the first request opens a connection and the second can reuse it.
    let opened = 0;
    const own = http.createServer((_q, res) => res.end('ok'));
    own.on('connection', () => opened++);
    await new Promise<void>((r) => own.listen(0, '127.0.0.1', r));
    const p = (own.address() as AddressInfo).port;
    try {
      const first = await fetcher(`http://localhost:${p}/r1`, CRAWL, limits);
      const second = await fetcher(`http://localhost:${p}/r2`, CRAWL, limits);
      expect(opened).toBe(1);
      expect(first.timing.connect_ms).not.toBeNull();
      expect(second.timing).toMatchObject({ dns_ms: null, connect_ms: null });
      expect(second.timing.ttfb_ms).not.toBeNull();
    } finally {
      own.closeAllConnections();
      await new Promise<void>((r) => own.close(() => r()));
    }
  });

  it('a request nothing answered records no first byte, and still its total', async () => {
    const closed = http.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const dead = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    const f = await fetcher(`http://127.0.0.1:${dead}/`, CRAWL, limits);
    expect(f.status).toBeNull();
    expect(f.timing.ttfb_ms).toBeNull();
    expect(Number.isInteger(f.timing.total_ms)).toBe(true);
  });

  it(`bounds every value to 0..${MAX_TIMING_MS}, rounding to whole milliseconds`, () => {
    expect(boundedMs(-0.4)).toBe(0);
    expect(boundedMs(12.6)).toBe(13);
    expect(boundedMs(MAX_TIMING_MS + 1)).toBe(MAX_TIMING_MS);
    expect(boundedMs(Number.POSITIVE_INFINITY)).toBe(MAX_TIMING_MS);
  });

  it('keeps the phases in order when the clock steps back between two marks', async () => {
    // Real time, with 5 s taken off from the request's response onwards: an NTP step mid-request.
    let back = 0;
    const clock: Clock = { now: () => Date.now() - back, sleep: async () => undefined };
    const { timing } = await timed(
      clock,
      () =>
        new Promise<void>((resolve) => {
          const req = http.get(`http://localhost:${port}/?wait=20`, (res) => {
            back = 5_000;
            res.resume();
            res.on('end', () => resolve());
          });
          req.on('error', () => resolve());
        }),
    );
    const known = [timing.dns_ms, timing.connect_ms, timing.ttfb_ms, timing.total_ms].filter(
      (v): v is number => v !== null,
    );
    expect(known.every((v, i) => i === 0 || v >= known[i - 1]!)).toBe(true);
  });
});
