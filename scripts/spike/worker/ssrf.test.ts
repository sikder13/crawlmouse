import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createFetcher, classifyFetchError } from './fetcher.js';
import { createSsrfFixtureServer, listen, close, SSRF_CASES, gzipBomb, BOMB_DECODED_BYTES } from '../fixtures/ssrf.js';

describe('classifyFetchError', () => {
  it.each([
    ['URL resolves to private or reserved IP (169.254.169.254): http://x/', 'ssrf_refused'],
    ['Disallowed URL scheme: file:', 'ssrf_refused'],
    ['Credentials in URL are not allowed: x', 'ssrf_refused'],
    ['DNS resolution failed for x', 'ssrf_refused'],
    ['Blocked connection to private or reserved IP (10.0.0.1) for x', 'ssrf_refused'],
    ['Response body exceeded 10485760 bytes', 'too_large'],
    ['Request timed out after 10000ms: http://x/', 'timeout'],
    ['Total deadline exceeded: http://x/', 'timeout'],
    ['Too many redirects (> 5) starting from http://x/', 'redirects'],
    ['socket hang up', 'network'],
  ])('%s -> %s', (m, c) => expect(classifyFetchError(m)).toBe(c));
});

describe('SSRF through the fetch path the worker uses (spec 2.9), guard NOT bypassed', () => {
  const fetcher = createFetcher({});

  it('refuses 169.254.169.254 without opening a connection', async () => {
    const spy = vi.spyOn(net.Socket.prototype, 'connect');
    const r = await fetcher('http://169.254.169.254/latest/meta-data/', 'crawlmouse');
    expect(r.errorClass).toBe('ssrf_refused');
    expect(r.status).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it.each([
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://10.0.0.5/',
    'http://100.100.100.200/',
    'http://[64:ff9b::a9fe:a9fe]/',
    'http://[2002:a9fe:a9fe::1]/',
    'file:///etc/passwd',
    'http://user:pw@example.com/',
  ])('refuses %s', async (url) => {
    const r = await fetcher(url, 'crawlmouse');
    expect(r.errorClass).toBe('ssrf_refused');
  });

  it('refuses a name whose answer changes between validation and connect (rebinding)', async () => {
    let calls = 0;
    const rebinding = createFetcher({
      safeFetchOverrides: { resolver: async () => (++calls === 1 ? ['93.184.216.34'] : ['127.0.0.1']) },
    });
    const r = await rebinding('http://rebind.example/', 'crawlmouse');
    expect(r.errorClass).toBe('ssrf_refused');
    expect(r.status).toBe(0);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('refuses a 302 to a private address at the next hop, with a single connection made', async () => {
    const urls: string[] = [];
    const spy = vi.spyOn(http, 'request').mockImplementation(((url: URL, _o: unknown, cb: (res: unknown) => void) => {
      urls.push(String(url));
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      req.end = () => {
        const res = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string> };
        res.statusCode = 302;
        res.headers = { location: 'http://10.0.0.7/admin' };
        cb(res);
        res.end();
      };
      req.destroy = () => {};
      return req;
    }) as unknown as typeof http.request);
    const f = createFetcher({ safeFetchOverrides: { resolver: async (h) => (net.isIP(h) ? [h] : ['93.184.216.34']) } });
    const r = await f('http://public.example/', 'crawlmouse');
    spy.mockRestore();
    expect(r.errorClass).toBe('ssrf_refused');
    expect(urls).toEqual(['http://public.example/']);
  });
});

describe('fixture-served cases: the guard is bypassed ONLY so a loopback fixture is reachable at all', () => {
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    server = createSsrfFixtureServer();
    base = await listen(server);
  });
  afterAll(() => close(server));

  // With the guard bypassed the redirect is followed, so the hop cases are asserted at the transport
  // level above. Here the Location header is asserted as the fixture really sends it.
  it.each(['302-metadata', '302-mapped'])('fixture %s sends a Location to a private literal', async (name) => {
    const res = await new Promise<http.IncomingMessage>((resolve) => http.get(`${base}/ssrf/${name}`, resolve));
    expect(res.statusCode).toBe(302);
    expect(String(res.headers.location)).toMatch(/169\.254\.169\.254|\[::ffff:127\.0\.0\.1\]/);
    res.resume();
  });

  it('gzip bomb: 100:1 or better, decoded size above the cap, aborted at 10 MB', async () => {
    expect(BOMB_DECODED_BYTES / gzipBomb().length).toBeGreaterThan(100);
    const f = createFetcher({ safeFetchOverrides: { bypassSsrf: true } });
    const r = await f(`${base}/ssrf/gzip-bomb`, 'crawlmouse');
    expect(r.errorClass).toBe('too_large');
    expect(r.body).toBe('');
  });

  it('11 MB body is aborted, not read', async () => {
    const f = createFetcher({ safeFetchOverrides: { bypassSsrf: true } });
    const r = await f(`${base}/ssrf/body-11mb`, 'crawlmouse');
    expect(r.errorClass).toBe('too_large');
  });

  it('the case table covers each spec 2.9 item', () => {
    expect(SSRF_CASES.map((c) => c.id).sort()).toEqual(
      ['body-11mb', 'gzip-bomb', 'metadata-literal', 'redirect-to-metadata', 'redirect-to-v4-mapped', 'v4-mapped-loopback'].sort(),
    );
  });
});
