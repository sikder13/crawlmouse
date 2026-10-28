import net from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { systemClock } from '../clock.js';
import { CRAWL } from '../identities.js';
import { startServer, type FixtureServer } from '../test-support/http.js';
import { MAX_BODY_BYTES, MAX_KEPT_BYTES, createFetcher } from './fetcher.js';

const limits = { maxBytes: MAX_BODY_BYTES, deadlineMs: 5_000 };
const ELEVEN_MB = 11 * 1024 * 1024;

let server: FixtureServer;
beforeAll(async () => {
  // Bound to the IPv6 wildcard so the IPv4-mapped loopback literal would reach it, if anything let it.
  server = await startServer((req, res) => {
    if (req.url === '/gzip-bomb') {
      const bomb = gzipSync(Buffer.alloc(12 * 1024 * 1024));
      res.setHeader('content-encoding', 'gzip');
      res.setHeader('content-type', 'text/html');
      res.end(bomb);
    } else if (req.url === '/eleven-mb') {
      res.setHeader('content-type', 'text/html');
      const chunk = Buffer.alloc(64 * 1024, 0x61);
      let sent = 0;
      const pump = () => {
        while (sent < ELEVEN_MB) {
          sent += chunk.length;
          if (!res.write(chunk)) return void res.once('drain', pump);
        }
        res.end();
      };
      pump();
    } else if (req.url === '/nine-mb-arrows') {
      // U+2192 is three bytes in UTF-8, so MAX_KEPT_BYTES (a power of two) falls inside one.
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(Buffer.from('→'.repeat(3_000_000)));
    } else if (req.url === '/kept-exactly') {
      res.setHeader('content-type', 'text/html');
      res.end(Buffer.alloc(MAX_KEPT_BYTES, 0x61));
    } else if (req.url === '/drip') {
      res.write('x');
      const t = setInterval(() => res.write('x'), 20);
      res.on('close', () => clearInterval(t));
    } else if (req.url === '/loop') {
      res.statusCode = 302;
      res.setHeader('location', '/loop');
      res.end();
    } else {
      res.setHeader('content-type', 'text/html');
      res.end('<p>ok</p>');
    }
  }, '::');
});
afterAll(() => server.close());
afterEach(() => vi.restoreAllMocks());

const viaGuard = createFetcher(systemClock);
const pastGuard = createFetcher(systemClock, { bypassSsrf: true });

describe('SSRF: refused through the production fetch path, guard not bypassed', () => {
  it('refuses 169.254.169.254 without opening a socket', async () => {
    const connect = vi.spyOn(net.Socket.prototype, 'connect');
    const r = await viaGuard('http://169.254.169.254/latest/meta-data/', CRAWL, limits);
    expect(r.error).toBe('ssrf_refused');
    expect(r.status).toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });

  it('refuses [::ffff:127.0.0.1] before any request reaches the listener behind it', async () => {
    const target = `http://[::ffff:127.0.0.1]:${server.port}/`;
    // The listener is reachable at that address when the guard is bypassed, so a zero below means refusal.
    expect((await pastGuard(target, CRAWL, limits)).status).toBe(200);
    const before = server.requests.length;

    const r = await viaGuard(target, CRAWL, limits);
    // The guard hands the bracketed literal to DNS, which cannot resolve it, so it fails closed there.
    expect(r.error).toBe('dns_failed');
    expect(server.requests.length).toBe(before);
  });

  it('refuses a name that resolves public at validation and private at connect (rebinding)', async () => {
    let lookups = 0;
    const rebinding = createFetcher(systemClock, {
      resolver: async () => (++lookups === 1 ? ['93.184.216.34'] : ['127.0.0.1']),
    });
    const before = server.requests.length;
    const r = await rebinding(`http://rebind.test:${server.port}/`, CRAWL, limits);
    expect(r.error).toBe('ssrf_refused');
    expect(lookups).toBe(2);
    expect(server.requests.length).toBe(before);
  });
});

describe('size caps (the guard is bypassed only so the loopback fixture is reachable)', () => {
  it('aborts a gzip bomb once the decoded body passes 10 MB', async () => {
    const r = await pastGuard(`${server.base}/gzip-bomb`, CRAWL, limits);
    expect(r.error).toBe('too_large');
    expect(r.body).toBe('');
  });

  it('aborts an 11 MB body', async () => {
    const r = await pastGuard(`${server.base}/eleven-mb`, CRAWL, limits);
    expect(r.error).toBe('too_large');
  });

  it('applies a smaller per-request byte limit when the batch has less left', async () => {
    const r = await pastGuard(`${server.base}/ok`, CRAWL, { maxBytes: 4, deadlineMs: 5_000 });
    expect(r.error).toBe('too_large');
  });
});

describe('what is kept of a body', () => {
  it(`keeps the first ${MAX_KEPT_BYTES} bytes of a 9 MB body, to a whole character, and counts all of it`, async () => {
    const r = await pastGuard(`${server.base}/nine-mb-arrows`, CRAWL, limits);
    expect(r).toMatchObject({ status: 200, error: null, bytes: 9_000_000, bodyCut: true });
    expect(r.body).toBe('→'.repeat(Math.floor(MAX_KEPT_BYTES / 3)));
  });

  it(`keeps a body of exactly ${MAX_KEPT_BYTES} bytes whole`, async () => {
    const r = await pastGuard(`${server.base}/kept-exactly`, CRAWL, limits);
    expect(r).toMatchObject({ bytes: MAX_KEPT_BYTES, bodyCut: false });
    expect(r.body).toHaveLength(MAX_KEPT_BYTES);
  });

  it('keeps 2 MiB, by an independent count', () => {
    expect(MAX_KEPT_BYTES).toBe(2_097_152);
  });
});

describe('error classes come from the real safeFetch messages', () => {
  it('dns_failed when the name does not resolve', async () => {
    const f = createFetcher(systemClock, { resolver: async () => [] });
    expect((await f('http://nx.test/', CRAWL, limits)).error).toBe('dns_failed');
  });

  it('timeout when a slow drip outlives the request deadline', async () => {
    const r = await pastGuard(`${server.base}/drip`, CRAWL, {
      maxBytes: MAX_BODY_BYTES,
      deadlineMs: 200,
    });
    expect(r.error).toBe('timeout');
  });

  it('network when the connection is refused', async () => {
    const closed = await startServer(() => undefined);
    await closed.close();
    expect((await pastGuard(`${closed.base}/`, CRAWL, limits)).error).toBe('network');
  });
});

describe('what is sent', () => {
  it("sends the identity's headers and decodes the body", async () => {
    const r = await pastGuard(`${server.base}/ok`, CRAWL, limits);
    expect(r).toMatchObject({ status: 200, body: '<p>ok</p>', bytes: 9, error: null, hops: [] });
    const sent = server.requests.at(-1)!.headers;
    expect(sent['user-agent']).toBe(CRAWL.userAgent);
    expect(sent['from']).toBe('bot@crawlmouse.com');
    expect(sent['accept']).toContain('text/html');
  });

  it('returns a redirect as it is, without following it', async () => {
    const r = await pastGuard(`${server.base}/loop`, CRAWL, limits);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/loop');
    expect(r.error).toBeNull();
  });
});
