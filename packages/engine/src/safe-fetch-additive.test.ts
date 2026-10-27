import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { safeFetch } from './safe-fetch.js';

// Additive options on safeFetch: `headers`, `hops` in the result, `totalDeadlineMs`.
// Every default is pinned too, so an existing caller sees no change.

let server: http.Server;
let baseUrl: string;
let lastHeaders: http.IncomingHttpHeaders = {};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    lastHeaders = req.headers;
    const path = req.url ?? '/';
    if (path === '/hello') {
      res.end('hello');
    } else if (path === '/r1') {
      res.statusCode = 301;
      res.setHeader('location', '/r2');
      res.end();
    } else if (path === '/r2') {
      res.statusCode = 302;
      res.setHeader('location', '/hello');
      res.end();
    } else if (path === '/drip') {
      // Slow drip: one byte every 40 ms keeps the socket idle timer from ever firing.
      res.write('x');
      const t = setInterval(() => res.write('x'), 40);
      res.on('close', () => clearInterval(t));
    } else {
      res.statusCode = 404;
      res.end('');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

afterEach(() => vi.restoreAllMocks());

describe('safeFetch additive options: defaults unchanged', () => {
  it('sends the original two headers plus the Node defaults, and no others, when headers is omitted', async () => {
    await safeFetch(`${baseUrl}/hello`, { bypassSsrf: true });
    expect(lastHeaders['user-agent']).toBe('CrawlmouseBot/1.0 (+https://crawlmouse.com/bot)');
    expect(lastHeaders['accept-encoding']).toBe('gzip, deflate, br');
    expect(lastHeaders['accept']).toBeUndefined();
    expect(lastHeaders['from']).toBeUndefined();
  });

  it('returns an empty hops array when there is no redirect', async () => {
    const r = await safeFetch(`${baseUrl}/hello`, { bypassSsrf: true });
    expect(r.hops).toEqual([]);
  });
});

describe('safeFetch headers option', () => {
  it('sends caller headers and lets them replace the defaults', async () => {
    await safeFetch(`${baseUrl}/hello`, {
      bypassSsrf: true,
      headers: {
        'User-Agent': 'TestBot/9.9',
        Accept: 'text/html',
        From: 'ops@example.invalid',
        'Accept-Encoding': 'gzip',
      },
    });
    expect(lastHeaders['user-agent']).toBe('TestBot/9.9');
    expect(lastHeaders['accept']).toBe('text/html');
    expect(lastHeaders['from']).toBe('ops@example.invalid');
    expect(lastHeaders['accept-encoding']).toBe('gzip');
    expect(lastHeaders['sec-ch-ua']).toBeUndefined();
  });

  it('headers.user-agent wins over the userAgent option', async () => {
    await safeFetch(`${baseUrl}/hello`, { bypassSsrf: true, userAgent: 'A', headers: { 'user-agent': 'B' } });
    expect(lastHeaders['user-agent']).toBe('B');
  });

  it.each(['host', 'Authorization', 'cookie', 'proxy-authorization', 'content-length', 'transfer-encoding', 'connection'])(
    'refuses to let the caller set %s',
    async (name) => {
      await expect(safeFetch(`${baseUrl}/hello`, { bypassSsrf: true, headers: { [name]: 'x' } })).rejects.toThrow(
        /header .* not allowed/i,
      );
    },
  );
});

describe('safeFetch hops', () => {
  it('records each redirect hop as {from, status, location}', async () => {
    const r = await safeFetch(`${baseUrl}/r1`, { bypassSsrf: true });
    expect(r.finalUrl).toBe(`${baseUrl}/hello`);
    expect(r.hops).toEqual([
      { from: `${baseUrl}/r1`, status: 301, location: `${baseUrl}/r2` },
      { from: `${baseUrl}/r2`, status: 302, location: `${baseUrl}/hello` },
    ]);
  });
});

describe('safeFetch totalDeadlineMs', () => {
  it('bounds a slow-drip response that the idle timeout never catches', async () => {
    const t0 = Date.now();
    await expect(safeFetch(`${baseUrl}/drip`, { bypassSsrf: true, timeoutMs: 5000, totalDeadlineMs: 300 })).rejects.toThrow(
      /total deadline/i,
    );
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('does not fire when the fetch finishes inside the deadline', async () => {
    const r = await safeFetch(`${baseUrl}/hello`, { bypassSsrf: true, totalDeadlineMs: 5000 });
    expect(r.body).toBe('hello');
  });
});

describe('safeFetch redirect to a private address (stubbed transport)', () => {
  it('validates the Location of hop 1 and never opens a second connection', async () => {
    const calls: string[] = [];
    vi.spyOn(http, 'request').mockImplementation(((url: URL, _opts: unknown, cb: (res: unknown) => void) => {
      calls.push(String(url));
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      req.end = () => {
        const res = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string> };
        res.statusCode = 302;
        res.headers = { location: 'http://169.254.169.254/latest/meta-data/' };
        cb(res);
        res.end();
      };
      req.destroy = () => {};
      return req;
    }) as unknown as typeof http.request);

    await expect(
      safeFetch('http://public.example/start', { resolver: async (h) => (net.isIP(h) ? [h] : ['93.184.216.34']) }),
    ).rejects.toThrow(/private or reserved/i);
    expect(calls).toEqual(['http://public.example/start']);
  });
});
