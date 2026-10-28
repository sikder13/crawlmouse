import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Metafile } from 'esbuild';
import { bundle } from '../build.js';
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
      const listening = await new Promise<string>((resolve, reject) => {
        child.stdout.on(
          'data',
          (d: Buffer) => d.toString().includes('"listening"') && resolve(d.toString()),
        );
        child.on('exit', (code) => reject(new Error(`exited with ${code}`)));
      });
      expect(JSON.parse(listening.trim().split('\n')[0]!)).toEqual({
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

  it('refuses to start without its secrets', async () => {
    const child = spawn(process.execPath, [outfile], {
      env: { PATH: process.env.PATH },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code).not.toBe(0);
  }, 30_000);
});
