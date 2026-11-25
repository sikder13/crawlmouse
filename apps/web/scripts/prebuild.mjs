/**
 * Before `next build`: on a Vercel build, the preview screens are left out of the build (CTO 094,
 * 096). `app/(v2-preview)` holds `/v2-preview`, `/kept-preview` and `/mail-preview`, which
 * `previewAllowed()` (app/(v2-preview)/v2-preview/_preview/guard.ts) answers with a 404 on every
 * Vercel deployment, preview and production alike. Compiling its 142 pages there costs build memory
 * for routes no visitor can open. CI, the visual harness and local builds keep them.
 *
 * Only with `VERCEL=1`, the test `skipBuildChecks` uses (lib/build-checks.mjs). The move is one
 * `rename` of one directory, so the tree is never half-moved; it happens in the build's own fresh
 * checkout, which Vercel discards after the build, and `VERCEL` is part of turbo's build hash
 * (turbo.json), so a cached output is never shared with a build that keeps the previews.
 */
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PREVIEW_GROUP = '(v2-preview)';
export const EXCLUDED_DIR = '.vercel-excluded';

/** Moves `app/(v2-preview)` out of `app/` when `env.VERCEL` is exactly `1`; says whether it did. */
export function excludePreviewsOnVercel(env, webRoot) {
  if (env.VERCEL !== '1') return false;
  const from = join(webRoot, 'app', PREVIEW_GROUP);
  if (!existsSync(from)) return false;
  mkdirSync(join(webRoot, EXCLUDED_DIR), { recursive: true });
  renameSync(from, join(webRoot, EXCLUDED_DIR, PREVIEW_GROUP));
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const webRoot = fileURLToPath(new URL('..', import.meta.url));
  if (excludePreviewsOnVercel(process.env, webRoot)) {
    console.log(`prebuild: left app/${PREVIEW_GROUP} out of this Vercel build (404s on Vercel)`);
  }
}
