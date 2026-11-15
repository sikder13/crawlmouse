import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCrawl } from './crawler.js';
import { FORBIDDEN_HEADERS } from './safe-fetch.js';

// C-6 (v1 inventory): the Crawlee path took `extraHeaders` without safeFetch's forbidden-header
// refusal. A crawl given one of those names is refused before any request is made; a crawl given
// only allowed names sends them as before.

let server: http.Server;
let baseUrl: string;
const received: http.IncomingHttpHeaders[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    received.push(req.headers);
    res.setHeader('content-type', 'text/html');
    res.end('<html><head><title>Home</title></head><body></body></html>');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const crawl = (extraHeaders: Record<string, string>) =>
  runCrawl({
    startUrls: [baseUrl],
    pageCap: 1,
    perHostConcurrency: 1,
    staggerMs: 0,
    pageTimeoutMs: 5000,
    allowPrivateIpsForTesting: true,
    extraHeaders,
  });

/** The spellings a caller could send: as listed, upper case, and capitalised per word. */
const spellings = (name: string) => [
  name,
  name.toUpperCase(),
  name.replace(/(^|-)([a-z])/g, (_, dash: string, c: string) => dash + c.toUpperCase()),
];

describe('extraHeaders on the Crawlee path', () => {
  it('lists the same names safeFetch refuses (anti-vacuity)', () => {
    expect([...FORBIDDEN_HEADERS].sort()).toEqual(
      [
        'authorization',
        'connection',
        'content-length',
        'cookie',
        'host',
        'proxy-authorization',
        'transfer-encoding',
      ].sort(),
    );
  });

  it.each([...FORBIDDEN_HEADERS].flatMap((name) => spellings(name).map((s) => [s] as const)))(
    'refuses %s before making any request',
    async (name) => {
      const before = received.length;
      await expect(crawl({ [name]: 'x' })).rejects.toThrow(/is not allowed/);
      expect(received.length).toBe(before);
    },
  );

  it('sends allowed headers as before, with the name as given', async () => {
    const before = received.length;
    const out = await crawl({ 'X-Probe': 'one', Accept: 'text/html' });
    expect(out.pages.length).toBe(1);
    const sent = received.slice(before);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0]!['x-probe']).toBe('one');
    expect(sent[0]!.accept).toBe('text/html');
  });
});
