/**
 * /dashboard behind V2_CHECKS_PUBLIC (CC-26b D1, R14). v1's page is main's file byte for byte and
 * imports nothing of v2; with the flag on the middleware rewrites /dashboard to this page
 * (`middleware.test.ts`, "the v2 dashboard rewrite"). This page is a 404 with the flag off.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ viewerRead: 0 }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/v2/account/viewer', () => ({
  loadViewer: async () => {
    h.viewerRead += 1;
    return { kind: 'signed_out' };
  },
}));

import V2Dashboard from './page';

const HERE = join(process.cwd(), 'app', 'dashboard');

/** sha256 of apps/web/app/dashboard/page.tsx on origin/main 607bb19a. */
const MAIN_SHA256 = '3c564084adaf59952d38a962ecd91a3ac87f54c710f482d4b3c084e2df4e4ce0';

beforeEach(() => {
  h.viewerRead = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe('v1 /dashboard', () => {
  it('is main’s file, byte for byte', () => {
    const source = readFileSync(join(HERE, 'page.tsx'));
    expect(createHash('sha256').update(source).digest('hex')).toBe(MAIN_SHA256);
  });
});

describe('/dashboard/v2', () => {
  it.each(['', 'true'])('is a 404 with V2_CHECKS_PUBLIC=%j, before any read', async (flag) => {
    vi.stubEnv('V2_CHECKS_PUBLIC', flag);
    await expect(V2Dashboard()).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK;404'),
    });
    expect(h.viewerRead).toBe(0);
  });

  it('with the flag on, reads the viewer: signed out goes to /login', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    await expect(V2Dashboard()).rejects.toMatchObject({
      digest: expect.stringContaining('/login'),
    });
    expect(h.viewerRead).toBe(1);
  });
});
