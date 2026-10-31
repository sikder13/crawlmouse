import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Worker } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bundleReader } from '../../build.js';
import { MAX_DOM_DEPTH, MAX_READ_TAGS } from '../rows/text.js';
import { inlineReader } from './read.js';
import { READ_DEADLINE_MS, ThreadReader } from './thread-reader.js';

// The thread runs the bundled reader, as the image does: dist/reader.mjs beside dist/main.mjs.

const dir = mkdtempSync(join(tmpdir(), 'worker-reader-'));
const entry = join(dir, 'reader.mjs');
const readers: ThreadReader[] = [];
const reader = (
  limits?: ConstructorParameters<typeof ThreadReader>[1],
  deadlineMs?: number,
  file = entry,
) => {
  const r = new ThreadReader(pathToFileURL(file), limits, deadlineMs);
  readers.push(r);
  return r;
};

/**
 * A stand-in reader thread whose time per read the test decides: `hang` never answers, `busy:N` holds
 * the thread N ms, `exit` ends the thread, anything else answers its length as a word count.
 */
const standIn = join(dir, 'stand-in.mjs');
const STAND_IN = `import { parentPort } from 'node:worker_threads';
const d = new TextDecoder();
parentPort.on('message', (m) => {
  const body = d.decode(new Uint8Array(m.body));
  if (body === 'hang') for (;;);
  if (body === 'exit') process.exit(1);
  const busy = /^busy:(\\d+)$/.exec(body);
  if (busy) { const until = Date.now() + Number(busy[1]); while (Date.now() < until); }
  parentPort.postMessage({ id: m.id, result: { words: body.length, note: null } });
});
parentPort.postMessage({ ready: true });`;

beforeAll(async () => {
  await bundleReader(entry);
  writeFileSync(standIn, STAND_IN);
}, 60_000);
afterAll(async () => {
  await Promise.all(readers.map((r) => r.close()));
  rmSync(dir, { recursive: true, force: true });
});

const PAGES = {
  links: `<html><head><link rel="canonical" href="/c"></head><body><p>Hello there</p>${Array.from(
    { length: 50 },
    (_, i) => `<a href="/p/${i}">read more</a> <a href="https://other.example/x">out</a>`,
  ).join('')}</body></html>`,
  nested: `<body>${'<a href="/x">'.repeat(20)}deep text${'</a>'.repeat(20)}</body>`,
  tooDeep: `<body>${'<div>'.repeat(MAX_DOM_DEPTH + 5)}x</body>`,
  manyTags: `<body>${'<b>w</b>'.repeat(MAX_READ_TAGS)}</body>`,
  notTagged: 'just words, no tags at all',
};

describe('the page reader thread', () => {
  it('reads a page as the inline reader does', async () => {
    const r = reader();
    for (const [name, body] of Object.entries(PAGES)) {
      for (const bodyCut of [false, true]) {
        const url = 'https://example.com/a';
        expect(await r.page(body, bodyCut, url), name).toEqual(
          await inlineReader.page(body, bodyCut, url),
        );
        expect(await r.words(body, bodyCut), name).toEqual(await inlineReader.words(body, bodyCut));
      }
    }
  }, 60_000);

  it('answers reads sent at once, each with its own page', async () => {
    const r = reader();
    const bodies = Array.from({ length: 20 }, (_, i) => `<p>${'w '.repeat(i)}</p>`);
    const words = await Promise.all(bodies.map((b) => r.words(b, false)));
    expect(words.map((w) => ('words' in w ? w.words : 'not read'))).toEqual(
      bodies.map((_, i) => i),
    );
  });

  it('answers crashed when the thread dies, and reads the next page on a new thread', async () => {
    // A heap too small for this page, and big enough for a small one.
    const r = reader({ maxOldGenerationSizeMb: 24, maxYoungGenerationSizeMb: 4 });
    const big = `<body>${'<p>w</p>'.repeat(MAX_READ_TAGS / 2)}</body>`;
    expect(await r.page(big, false, 'https://example.com/')).toEqual({
      failed: 'reader_thread_crashed',
    });
    expect(await r.words(big, false)).toEqual({ failed: 'reader_thread_crashed' });
    expect(await r.words('<p>two words</p>', false)).toEqual({ words: 2, note: null });
    expect(r.restarts).toBe(2);
  }, 60_000);

  it('answers crashed only for the read the thread died on, and reads those queued behind it on a new thread', async () => {
    // Reads go in order, so the oldest unanswered read is the one the thread was on.
    const r = reader({ maxOldGenerationSizeMb: 24, maxYoungGenerationSizeMb: 4 });
    const big = `<body>${'<p>w</p>'.repeat(MAX_READ_TAGS / 2)}</body>`;
    const [killed, after, last] = await Promise.all([
      r.page(big, false, 'https://example.com/'),
      r.words('<p>one two</p>', false),
      r.words('<p>three</p>', false),
    ]);
    expect(killed).toEqual({ failed: 'reader_thread_crashed' });
    expect([after, last]).toEqual([
      { words: 2, note: null },
      { words: 1, note: null },
    ]);
    expect(r.restarts).toBe(1);
  }, 60_000);

  it('rejects a read the reader throws on, as the inline reader does, and goes on reading', async () => {
    const r = reader();
    const url = 'not a url';
    await expect(inlineReader.page('<a href="/a">a</a>', false, url)).rejects.toThrow(
      /Invalid URL/,
    );
    await expect(r.page('<a href="/a">a</a>', false, url)).rejects.toThrow(/Invalid URL/);
    expect(await r.words('<p>w</p>', false)).toEqual({ words: 1, note: null });
    expect(r.restarts).toBe(0);
  });

  it('fails only a read past its deadline, stops that thread, and reads those queued behind it on a new one', async () => {
    const r = reader(undefined, 300, standIn);
    const terminate = vi.spyOn(Worker.prototype, 'terminate');
    const t0 = performance.now();
    const answers = await Promise.all(['a', 'hang', 'bb', 'ccc'].map((b) => r.words(b, false)));
    expect(terminate).toHaveBeenCalledTimes(1); // the hung thread, which would otherwise spin on
    terminate.mockRestore();
    expect(answers).toEqual([
      { words: 1, note: null },
      { failed: 'reader_deadline' },
      { words: 2, note: null },
      { words: 3, note: null },
    ]);
    expect(r.restarts).toBe(1);
    expect(performance.now() - t0).toBeLessThan(5_000);
  });

  it('times each read from when the thread reaches it, not from when it was sent', async () => {
    // Three reads of 250 ms each against a 600 ms deadline: the last finishes 750 ms after it was sent.
    const r = reader(undefined, 600, standIn);
    const answers = await Promise.all(
      ['busy:250', 'busy:250', 'busy:250'].map((b) => r.words(b, false)),
    );
    expect(answers).toEqual(Array(3).fill({ words: 8, note: null }));
    expect(r.restarts).toBe(0);
  });

  it('fails only the read in progress when the thread exits, and reads the rest on a new thread', async () => {
    const r = reader(undefined, 5_000, standIn);
    const answers = await Promise.all(['a', 'exit', 'bb'].map((b) => r.words(b, false)));
    expect(answers).toEqual([
      { words: 1, note: null },
      { failed: 'reader_thread_crashed' },
      { words: 2, note: null },
    ]);
    expect(r.restarts).toBe(1);
  });

  it(`gives each read ${READ_DEADLINE_MS / 1000} s by default`, async () => {
    expect(READ_DEADLINE_MS).toBe(20_000);
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const r = reader(undefined, undefined, standIn);
    await r.words('a', false);
    const delays = spy.mock.calls.map((c) => c[1]);
    spy.mockRestore();
    expect(delays).toContain(READ_DEADLINE_MS);
  });

  it('runs with a 192 MB old space', async () => {
    const spy = vi.spyOn(Worker.prototype, 'postMessage');
    const r = reader();
    await r.words('<p>w</p>', false);
    const thread = spy.mock.contexts[0] as Worker;
    spy.mockRestore();
    expect(thread.resourceLimits?.maxOldGenerationSizeMb).toBe(192);
  });

  it('hands the body over in a transferred buffer, and leaves other buffers alone', async () => {
    const spy = vi.spyOn(Worker.prototype, 'postMessage');
    const r = reader();
    // A small body: Buffer.from would give a slice of Node's shared pool, which a transfer detaches.
    const other = Buffer.from('still here');
    await r.words('<p>a b c</p>', false);
    const [message, transfer] = spy.mock.calls[0]! as [{ body: ArrayBuffer }, ArrayBuffer[]];
    spy.mockRestore();
    expect(transfer).toEqual([message.body]);
    expect(message.body.byteLength).toBe(0); // detached: moved to the thread, not copied
    expect(other.toString()).toBe('still here');
  });
});

describe('the page reader thread and the process', () => {
  // A script that uses the reader with nothing else keeping the process alive.
  const run = async (body: string) => {
    const lib = join(dir, 'thread-reader.mjs');
    await build({
      entryPoints: [new URL('./thread-reader.ts', import.meta.url).pathname],
      outfile: lib,
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'warning',
    });
    const script = join(dir, `script-${Math.random().toString(36).slice(2)}.mjs`);
    writeFileSync(
      script,
      `import { ThreadReader } from ${JSON.stringify(pathToFileURL(lib).href)};\n` +
        `const r = new ThreadReader(new URL(${JSON.stringify(pathToFileURL(entry).href)}));\n${body}`,
    );
    return spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 20_000 });
  };

  it('keeps the process alive while a read is pending', async () => {
    const r = await run(
      // Started and idle first, so only the pending read can hold the process open.
      `await r.start(); r.words('<p>${'w '.repeat(1000)}</p>', false).then((w) => console.log(JSON.stringify(w)));`,
    );
    expect({ status: r.status, out: r.stdout.trim() }).toEqual({
      status: 0,
      out: JSON.stringify({ words: 1000, note: null }),
    });
  }, 30_000);

  it('does not keep the process alive once no read is pending', async () => {
    const r = await run(`await r.words('<p>w</p>', false); console.log('read');`);
    expect({ status: r.status, signal: r.signal, out: r.stdout.trim() }).toEqual({
      status: 0,
      signal: null,
      out: 'read',
    });
  }, 30_000);
});
