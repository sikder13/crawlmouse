/**
 * scripts/prebuild.mjs (CTO 096): on a Vercel build, `app/(v2-preview)` and nothing else leaves
 * the app directory; anywhere else, nothing moves.
 */
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXCLUDED_DIR, PREVIEW_GROUP, excludePreviewsOnVercel } from './prebuild.mjs';

/** A web root with the preview group, a kept group and a plain route, each holding a page. */
function tree() {
  const root = mkdtempSync(join(tmpdir(), 'prebuild-'));
  for (const dir of [PREVIEW_GROUP + '/v2-preview/screens', '(v2-kept)/v2-kept/login', 'dashboard']) {
    mkdirSync(join(root, 'app', dir), { recursive: true });
    writeFileSync(join(root, 'app', dir, 'page.tsx'), 'export default () => null;');
  }
  return root;
}

describe('excludePreviewsOnVercel', () => {
  it('with VERCEL=1, moves exactly app/(v2-preview) out of app/, whole', () => {
    const root = tree();
    expect(excludePreviewsOnVercel({ VERCEL: '1' }, root)).toBe(true);
    expect(readdirSync(join(root, 'app')).sort()).toEqual(['(v2-kept)', 'dashboard']);
    expect(
      existsSync(join(root, EXCLUDED_DIR, PREVIEW_GROUP, 'v2-preview', 'screens', 'page.tsx')),
    ).toBe(true);
  });

  it.each([{}, { VERCEL: '' }, { VERCEL: '0' }, { VERCEL: 'true' }, { VERCEL_ENV: 'production' }])(
    'with %j, moves nothing',
    (env) => {
      const root = tree();
      expect(excludePreviewsOnVercel(env, root)).toBe(false);
      expect(readdirSync(join(root, 'app')).sort()).toEqual([
        '(v2-kept)',
        '(v2-preview)',
        'dashboard',
      ]);
    },
  );

  it('the group the script names is the one in this app', () => {
    expect(existsSync(join(__dirname, '..', 'app', PREVIEW_GROUP))).toBe(true);
  });
});
