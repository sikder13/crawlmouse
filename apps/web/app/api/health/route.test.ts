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

  it('depends on next/server and the health module only, which depends on package.json only, and neither calls fetch (a liveness probe must not reach Supabase or the network)', () => {
    // Collect the literal module specifiers in each file (static import, side-effect import,
    // export-from, import(), require(); any quote style) and compare them against an allow-list. A
    // computed import()/require() argument fails outright, since its target cannot be read. Comments
    // are NOT stripped: a stripper can eat code that follows a `//` inside a string, and a specifier
    // or fetch mentioned in a comment only makes this test stricter.
    const specifiersOf = (code: string) => {
      const q = '[\'"`]';
      return new Set(
        [
          ...code.matchAll(new RegExp(`\\bfrom\\s*${q}([^'"\`]+)${q}`, 'g')),
          ...code.matchAll(new RegExp(`\\bimport\\s*${q}([^'"\`]+)${q}`, 'g')),
          ...code.matchAll(new RegExp(`\\b(?:import|require)\\s*\\(\\s*${q}([^'"\`]+)${q}`, 'g')),
        ].map((m) => m[1]),
      );
    };
    const route = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
    const health = readFileSync(new URL('../../../lib/v2/ops/health.ts', import.meta.url), 'utf8');
    expect(specifiersOf(route)).toEqual(new Set(['next/server', '../../../lib/v2/ops/health']));
    expect(specifiersOf(health)).toEqual(new Set(['../../../package.json']));
    for (const code of [route, health]) {
      expect(code).not.toMatch(/\b(?:import|require)\s*\(\s*[^'"`\s]/);
      expect(code).not.toMatch(/\bfetch\s*\(/);
    }
  });
});
