import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { safeFetch } from './safe-fetch.js';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/hello') {
      res.setHeader('content-type', 'text/plain');
      res.end('hello world');
    } else if (path === '/redirect') {
      res.statusCode = 302;
      res.setHeader('location', `${baseUrl}/hello`);
      res.end();
    } else if (path === '/loop') {
      res.statusCode = 302;
      res.setHeader('location', `${baseUrl}/loop`);
      res.end();
    } else if (path === '/big') {
      res.setHeader('content-type', 'text/plain');
      res.end('x'.repeat(50_000));
    } else if (path === '/sitemap.xml.gz') {
      // Content-level gzip (no content-encoding header), as Yoast/WP emit.
      res.setHeader('content-type', 'application/gzip');
      res.end(gzipSync(Buffer.from('<urlset><url><loc>https://x.com/a</loc></url></urlset>')));
    } else {
      res.statusCode = 404;
      res.end('');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('safeFetch', () => {
  it('fetches a basic body', async () => {
    const r = await safeFetch(`${baseUrl}/hello`, { bypassSsrf: true });
    expect(r.status).toBe(200);
    expect(r.body).toBe('hello world');
  });

  it('follows redirects and reports the final URL', async () => {
    const r = await safeFetch(`${baseUrl}/redirect`, { bypassSsrf: true });
    expect(r.status).toBe(200);
    expect(r.body).toBe('hello world');
    expect(r.finalUrl).toBe(`${baseUrl}/hello`);
  });

  it('aborts on a redirect loop past the cap', async () => {
    await expect(safeFetch(`${baseUrl}/loop`, { bypassSsrf: true, maxRedirects: 3 })).rejects.toThrow(
      /too many redirects/i,
    );
  });

  it('enforces the body size cap', async () => {
    await expect(safeFetch(`${baseUrl}/big`, { bypassSsrf: true, maxBytes: 1000 })).rejects.toThrow(
      /exceeded/i,
    );
  });

  it('transparently decompresses a gzipped sitemap file', async () => {
    const r = await safeFetch(`${baseUrl}/sitemap.xml.gz`, { bypassSsrf: true });
    expect(r.body).toContain('<loc>https://x.com/a</loc>');
  });

  it('refuses to connect to a host that resolves to a private IP (no bypass)', async () => {
    await expect(
      safeFetch('http://internal.example/', { resolver: async () => ['10.0.0.1'] }),
    ).rejects.toThrow(/private|reserved/i);
  });

  it('rejects disallowed schemes', async () => {
    await expect(safeFetch('file:///etc/passwd', { resolver: async () => ['8.8.8.8'] })).rejects.toThrow(
      /scheme/i,
    );
  });
});
