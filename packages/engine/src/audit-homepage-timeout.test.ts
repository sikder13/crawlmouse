import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import http from 'node:http';
import { runAudit } from './audit.js';

// A loopback origin whose HOMEPAGE response is artificially delayed, so we can prove the audit's
// homepage fetch honors the env-tunable budget (homepageFetchTimeoutMs) instead of the generic 10s
// safeFetch default. robots/sitemap 404 so discovery seeds the homepage only.
let server: http.Server;
let baseUrl: string;
let homepageDelayMs = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.on('error', () => {}); // swallow ECONNRESET when the client aborts on timeout
    const path = req.url ?? '/';
    if (path === '/robots.txt' || path === '/sitemap.xml') {
      res.statusCode = 404;
      res.end('');
      return;
    }
    const send = () => {
      if (res.destroyed || res.writableEnded) return; // client already aborted (timed out)
      res.setHeader('content-type', 'text/html');
      res.end(`<html><head><title>Home</title></head><body><a href="/a">A</a></body></html>`);
    };
    if ((path === '/' || path === '') && homepageDelayMs > 0) {
      const t = setTimeout(send, homepageDelayMs);
      res.on('close', () => clearTimeout(t));
    } else {
      send();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

afterEach(() => {
  vi.unstubAllEnvs();
  homepageDelayMs = 0;
});

const run = () =>
  runAudit(
    { url: baseUrl, pageCap: 50, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000 },
    { allowPrivateIpsForTesting: true },
  );

describe('runAudit — homepage fetch budget (wiring)', () => {
  it('applies the configured homepage budget: a homepage slower than it fails as a timeout', async () => {
    // Budget clamps to the 1s floor; the homepage takes 1.3s. This rejects ONLY if audit.ts threads
    // the configured budget into the homepage safeFetch — with the old 10s default it would not.
    vi.stubEnv('HOMEPAGE_FETCH_TIMEOUT_MS', '1000');
    homepageDelayMs = 1300;
    await expect(run()).rejects.toThrow(/timed out/i);
  });
});
