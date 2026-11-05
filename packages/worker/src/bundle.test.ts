import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Metafile } from 'esbuild';
import { bundle, releaseOf } from '../build.js';
import { READER_FILE } from './reader/file.js';
import { keyPair } from './test-support/jwt.js';

// The image runs this bundle and nothing else, so it is built and started here as it ships.

const dir = mkdtempSync(join(tmpdir(), 'worker-bundle-'));
const outfile = join(dir, 'main.mjs');
let meta: Metafile;

beforeAll(async () => {
  meta = await bundle(outfile);
}, 60_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

describe('the release the bundle names', () => {
  it('is the first 12 hex digits of the commit checked out, written into main.mjs', () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(releaseOf({})).toBe(head.slice(0, 12));
    expect(readFileSync(outfile, 'utf8')).toContain(JSON.stringify(head.slice(0, 12)));
  });

  it('is unreleased where git cannot say, and an error in CI', () => {
    const fails = () => {
      throw new Error('fatal: detected dubious ownership');
    };
    expect(releaseOf({}, fails)).toBe('unreleased');
    expect(releaseOf({}, () => 'abc123')).toBe('unreleased');
    expect(() => releaseOf({ CI: 'true' }, fails)).toThrow(/cannot name its release/);
    expect(() => releaseOf({ GITHUB_ACTIONS: 'true' }, fails)).toThrow(/cannot name its release/);
    expect(releaseOf({ CI: 'false' }, fails)).toBe('unreleased');
    expect(releaseOf({ CI: '0' }, fails)).toBe('unreleased');
  });
});

describe('the worker bundle', () => {
  it('does not contain crawlee, the module behind the overview §11 production failure', () => {
    const inputs = Object.keys(meta.inputs);
    expect(inputs.some((p) => /[/\\]crawlee[/\\]|@crawlee[/\\]/.test(p))).toBe(false);
    expect(inputs.some((p) => p.endsWith('engine/src/safe-fetch.ts'))).toBe(true);
    expect(inputs.some((p) => p.endsWith('engine/src/ssrf-guard.ts'))).toBe(true);
  });

  it('starts from the environment alone and answers /healthz', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [outfile], {
      env: {
        PATH: process.env.PATH,
        PORT: String(port),
        WORKER_SIGNING_SECRET: 'b'.repeat(40),
        WORKER_JWT_PUBLIC_KEY: keyPair().publicKeyEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      let out = '';
      const listening = await new Promise<string>((resolve, reject) => {
        child.stdout.on('data', (d: Buffer) => {
          out += d.toString();
          if (out.includes('"listening"')) resolve(out);
        });
        child.on('exit', (code) => reject(new Error(`exited with ${code}`)));
      });
      // The reader thread started from reader.mjs beside main.mjs, before the server listened.
      expect(listening).toContain('{"event":"reader_started"}');
      const line = listening.split('\n').find((l) => l.includes('"listening"'))!;
      expect(JSON.parse(line)).toEqual({
        event: 'listening',
        port,
        paused: false,
      });
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      child.kill('SIGTERM');
    }
  }, 30_000);

  it('carries no esbuild in main.mjs, and writes reader.mjs beside it', async () => {
    const mainInputs = Object.keys(meta.inputs);
    expect(mainInputs.some((p) => /[/\\]esbuild[/\\]/.test(p))).toBe(false);
    expect(mainInputs.some((p) => p.endsWith('src/reader/thread-reader.ts'))).toBe(true);
    expect(existsSync(join(dir, READER_FILE))).toBe(true);
  });

  it('refuses to start without reader.mjs beside it', async () => {
    const alone = mkdtempSync(join(tmpdir(), 'worker-alone-'));
    try {
      copyFileSync(outfile, join(alone, 'main.mjs'));
      const child = spawn(process.execPath, [join(alone, 'main.mjs')], {
        env: {
          PATH: process.env.PATH,
          PORT: String(await freePort()),
          WORKER_SIGNING_SECRET: 'b'.repeat(40),
          WORKER_JWT_PUBLIC_KEY: keyPair().publicKeyEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
      expect(code).not.toBe(0);
      expect(out).not.toContain('"listening"');
    } finally {
      rmSync(alone, { recursive: true, force: true });
    }
  }, 30_000);

  it('refuses to start without its secrets', async () => {
    const child = spawn(process.execPath, [outfile], {
      env: { PATH: process.env.PATH },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code).not.toBe(0);
  }, 30_000);
});
