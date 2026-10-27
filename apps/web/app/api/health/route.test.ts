import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { GET } from './route';

// Independent truth: read apps/web/package.json from disk rather than through the route's own import.
const expectedVersion = (
  JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

let savedSha: string | undefined;
beforeEach(() => {
  savedSha = process.env.VERCEL_GIT_COMMIT_SHA;
});
afterEach(() => {
  if (savedSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = savedSha;
});

describe('GET /api/health', () => {
  it('responds 200 with ok, the package version and the deploy commit', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      version: expectedVersion,
      commit: '0123456789abcdef0123456789abcdef01234567',
    });
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('reports commit: null when VERCEL_GIT_COMMIT_SHA is absent (local / non-Vercel)', async () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: expectedVersion, commit: null });
  });

  it('depends on next/server and package.json only, and calls no fetch (a liveness probe must not reach Supabase or the network)', () => {
    // Read every module specifier however the import is written (multi-line, side-effect, dynamic,
    // require, export-from), with comments stripped, and compare against an allow-list.
    const code = readFileSync(new URL('./route.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const specifiers = [
      ...code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g),
      ...code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g),
      ...code.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g),
    ].map((m) => m[1]);
    expect(new Set(specifiers)).toEqual(new Set(['next/server', '../../../package.json']));
    expect(code).not.toMatch(/\bfetch\s*\(/);
  });
});
