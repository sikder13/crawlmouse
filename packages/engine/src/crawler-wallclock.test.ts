import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { runCrawl } from './crawler.js';

// A loopback origin whose page is artificially slow, so the crawl cannot finish within a short
// wall-clock budget — proving runCrawl ABORTS and throws a timeout-classified error rather than
// running until the serverless function is killed at maxDuration (Issue 2b).
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.on('error', () => {}); // swallow ECONNRESET when the crawler is torn down
    const t = setTimeout(() => {
      if (res.destroyed || res.writableEnded) return;
      res.setHeader('content-type', 'text/html');
      res.end('<html><head><title>Slow</title></head><body>slow</body></html>');
    }, 1500);
    res.on('close', () => clearTimeout(t));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('runCrawl — wall-clock budget', () => {
  it('aborts a crawl that exceeds maxCrawlMs and throws a timeout-classified error', async () => {
    // 300ms budget vs a 1.5s page: the crawl cannot complete in time, so runCrawl must reject. The
    // error message must classify as `timeout` (Issue 2's classifyFailure keys on "timed out").
    await expect(
      runCrawl({
        startUrls: [baseUrl],
        pageCap: 50,
        perHostConcurrency: 2,
        staggerMs: 0,
        pageTimeoutMs: 5000,
        allowPrivateIpsForTesting: true,
        maxCrawlMs: 300,
      }),
    ).rejects.toThrow(/timed out/i);
  });
});
