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

  it('imports no database or network client (a liveness probe must not depend on Supabase)', () => {
    const src = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
    const imports = src.match(/^import .+$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) {
      expect(line).not.toMatch(/supabase|stripe|inngest|rate-limit|fetch/i);
    }
  });
});
