import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRendered } from '@crawlmouse/engine/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundleReader } from '../../build.js';
import { ThreadReader } from './thread-reader.js';

/**
 * A page's two renders, read on the reader thread as the engine reads them inline (questions/042,
 * design C). The thread runs the bundled reader, as the image does.
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

describe('a page’s two renders, read on the thread', () => {
  it('answers exactly what the engine reads inline', async () => {
    const r = reader();
    for (const [name, [s, rendered]] of Object.entries(PAIRS)) {
      expect(await r.rendered(s, rendered, URL_), name).toEqual(readRendered(s, rendered, URL_));
    }
  });

  it('splits the two sides where the static one ends, whatever characters it holds', async () => {
    const r = reader();
    const s = '<body><p>a 😀 b</p></body>';
    const rendered = '<body><p>c d e f</p></body>';
    expect(await r.rendered(s, rendered, URL_)).toMatchObject({ raw_words: 3, rendered_words: 4 });
  });

  it('stops a page that would hold the thread, and reads the next one', async () => {
    const r = reader(500);
    // `extractMainContent` on repeated <title> grows faster than its size (questions/026).
    const slow = `<html><head>${'<title>x</title>'.repeat(140_000)}</head><body><p>w</p></body></html>`;
    const started = Date.now();
    expect(await r.rendered(slow, slow, URL_)).toEqual({ failed: 'reader_deadline' });
    expect(Date.now() - started).toBeLessThan(5_000);
    const [s, rendered] = PAIRS['server-rendered']!;
    expect(await r.rendered(s, rendered, URL_)).toEqual(readRendered(s, rendered, URL_));
  }, 30_000);
});
