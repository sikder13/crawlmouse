import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRendered } from '@crawlmouse/engine/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundleReader } from '../../build.js';
import { ThreadReader } from './thread-reader.js';

const bytesOf = (static_html: string, rendered_html: string, url = URL_) =>
  new TextEncoder().encode(JSON.stringify({ static_html, rendered_html, url }));

/**
 * A POST /render/measure body, decoded, parsed and read on the reader thread as the engine reads the
 * two renders inline (questions/042, design C). The thread runs the bundled reader, as the image does.
 */
const dir = mkdtempSync(join(tmpdir(), 'worker-rendered-'));
const entry = join(dir, 'reader.mjs');
const readers: ThreadReader[] = [];
const reader = (deadlineMs?: number) => {
  const r = new ThreadReader(pathToFileURL(entry), undefined, deadlineMs);
  readers.push(r);
  return r;
};

beforeAll(async () => {
  await bundleReader(entry);
}, 60_000);
afterAll(async () => {
  await Promise.all(readers.map((r) => r.close()));
  rmSync(dir, { recursive: true, force: true });
});

const URL_ = 'https://example.com/p';
const PAIRS: Record<string, [string, string]> = {
  'server-rendered': [
    '<html><body><main><h1>Ridge tent</h1><p>Two person, three season.</p></main></body></html>',
    '<html><body><main><h1>Ridge tent</h1><p>Two person, three season.</p></main></body></html>',
  ],
  'client-rendered': [
    '<html><body><div id="root"></div><script src="/app.js"></script></body></html>',
    '<html><body><div id="root"><h1>Ridge tent</h1><p>Two person.</p><a href="/shop">Shop</a></div></body></html>',
  ],
  'no body tag': [
    '<title>Just a title</title><p>loose words here</p>',
    '<p>loose words here and more</p>',
  ],
  challenge: [
    '<html><head><title>Just a moment...</title></head><body>checking</body></html>',
    '<html><body><p>real text</p></body></html>',
  ],
  'non-latin': [
    '<body><p>Привет мир 世界 ✓</p></body>',
    '<body><p>Привет мир 世界 ✓ ещё</p></body>',
  ],
};

describe('a measure body, read on the thread', () => {
  it('answers exactly what the engine reads inline', async () => {
    const r = reader();
    for (const [name, [s, rendered]] of Object.entries(PAIRS)) {
      expect(await r.measure(bytesOf(s, rendered)), name).toEqual({
        reading: readRendered(s, rendered, URL_),
      });
    }
  });

  it('keeps each side whole, a leading byte-order mark and characters outside the BMP included', async () => {
    const r = reader();
    const s = '\uFEFF<body><p>a 😀 b</p></body>';
    const rendered = '\uFEFF<body><p>c d e f</p></body>';
    expect(await r.measure(bytesOf(s, rendered))).toEqual({
      reading: readRendered(s, rendered, URL_),
    });
  });

  it('keeps a byte-order mark at the very start of the body, as it was signed', async () => {
    const r = reader();
    const raw = bytesOf('<p>a</p>', '<p>b</p>');
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...raw]);
    // A decoder that dropped it would parse this as JSON; kept, it is not JSON.
    expect(await r.measure(withBom)).toEqual({ invalid: 'json' });
  });

  it('answers a body that is not JSON, or not the measure request, without reading it', async () => {
    const r = reader();
    expect(await r.measure(new TextEncoder().encode('{"static_html":'))).toEqual({
      invalid: 'json',
    });
    expect(await r.measure(new TextEncoder().encode('{"__proto__":{}}'))).toEqual({
      invalid: 'json',
    });
    expect(await r.measure(new TextEncoder().encode('{"static_html":"x"}'))).toEqual({
      invalid: ['rendered_html', 'url'],
    });
  });

  it('stops a page that would hold the thread, and reads the next one', async () => {
    const r = reader(500);
    // `extractMainContent` on repeated <title> grows faster than its size (questions/026).
    const slow = `<html><head>${'<title>x</title>'.repeat(140_000)}</head><body><p>w</p></body></html>`;
    const started = Date.now();
    expect(await r.measure(bytesOf(slow, slow))).toEqual({ failed: 'reader_deadline' });
    expect(Date.now() - started).toBeLessThan(5_000);
    const [s, rendered] = PAIRS['server-rendered']!;
    expect(await r.measure(bytesOf(s, rendered))).toEqual({
      reading: readRendered(s, rendered, URL_),
    });
  }, 30_000);

  // The route hands the reader the Buffer readBody made: under 4 KiB, Buffer.concat takes it from
  // Node's shared pool, so its ArrayBuffer holds other buffers too; over 4 KiB it has its own.
  const asRouteGivesIt = (static_html: string, rendered_html: string) =>
    Buffer.concat([Buffer.from(JSON.stringify({ static_html, rendered_html, url: URL_ }))]);
  const bigPage = `<body><main>${'<p>tent pole stake guy line </p>'.repeat(400)}</main></body>`;

  it.each([
    ['under 4 KiB, from the shared pool', PAIRS['client-rendered']!],
    ['over 4 KiB, a buffer of its own', [bigPage, bigPage] as [string, string]],
  ])(
    'reads a Buffer body %s, and leaves it and its neighbours whole',
    async (_name, [s, rendered]) => {
      const r = reader();
      const body = asRouteGivesIt(s, rendered);
      const neighbour = Buffer.from('still here');
      const before = body.toString();
      for (let i = 0; i < 2; i++) {
        expect(await r.measure(body)).toEqual({ reading: readRendered(s, rendered, URL_) });
      }
      expect(body.toString()).toBe(before);
      expect(neighbour.toString()).toBe('still here');
    },
  );

  it.each([
    ['under 4 KiB', PAIRS['client-rendered']!],
    ['over 4 KiB', [bigPage, bigPage] as [string, string]],
  ])(
    'sends a queued Buffer body %s again, whole, to the thread that replaces a stopped one',
    async (_name, [s, rendered]) => {
      const r = reader(500);
      const slow = `<html><head>${'<title>x</title>'.repeat(140_000)}</head><body><p>w</p></body></html>`;
      const queued = asRouteGivesIt(s, rendered);
      const [first, second] = await Promise.all([
        r.measure(asRouteGivesIt(slow, slow)),
        r.measure(queued),
      ]);
      expect(first).toEqual({ failed: 'reader_deadline' });
      expect(second).toEqual({ reading: readRendered(s, rendered, URL_) });
    },
    30_000,
  );
});
