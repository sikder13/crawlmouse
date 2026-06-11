import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guard for the Vercel serverless-tracing invariant behind the /api/webhooks/inngest function.
//
// The Inngest serve route pulls in @crawlmouse/inngest -> @crawlmouse/engine -> `crawlee`.
// next.config.mjs marks `crawlee` as a server-external package (it does NOT bundle cleanly — it
// lazy-`require()`s @crawlee/* and optional browser drivers), so the COMPILED route emits a bare
// runtime `require("crawlee")`. Vercel's Node File Tracer (nft) only ships a module into a function
// if that module is resolvable from the app's own node_modules. `crawlee` reaches apps/web only
// transitively (via @crawlmouse/engine), and in this pnpm monorepo a transitive-only dep is NOT
// resolvable from apps/web — so nft omitted it and prod died with `Error: Cannot find module
// 'crawlee'` on every hit to the endpoint (Inngest could neither sync NOR invoke the 4 functions,
// i.e. the core audit feature was dead in prod).
//
// The fix: declare `crawlee` as a DIRECT dependency of apps/web so pnpm symlinks it into
// apps/web/node_modules and nft traces it (and its closure) into the lambda. This guard pins the
// two halves of that invariant together so neither can silently drift:
//   1. next.config still EXTERNALIZES crawlee (=> the route still runtime-requires it), and
//   2. apps/web still DECLARES crawlee as a direct runtime dependency (=> nft can ship it).
// Drop either and the endpoint 500s in prod again; this test fails first.
const WEB_DIR = resolve(__dirname, '..');

function read(rel: string): string {
  const source = readFileSync(resolve(WEB_DIR, rel), 'utf8');
  expect(source.trim().length, `${rel} is empty or whitespace-only`).toBeGreaterThan(0);
  return source;
}

describe('inngest /api/webhooks/inngest crawlee tracing invariant', () => {
  it('declares crawlee as a DIRECT runtime dependency of apps/web (so Vercel nft traces it)', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    // Must be a runtime dependency, not dev — the lambda requires it at runtime.
    expect(
      pkg.dependencies?.crawlee,
      'crawlee must be in apps/web "dependencies" or the prod Inngest endpoint 500s with "Cannot find module \'crawlee\'"',
    ).toBeTruthy();
    expect(pkg.devDependencies?.crawlee, 'crawlee must NOT be only a devDependency').toBeUndefined();
  });

  it('keeps crawlee externalized in next.config (the reason the direct dep is required)', () => {
    const cfg = read('next.config.mjs');
    // serverExternalPackages drives nft "do not bundle, require at runtime" behavior; the manual
    // webpack externals block mirrors it. Either way, crawlee must remain externalized — that is
    // precisely why the direct dependency above is load-bearing.
    expect(
      /serverExternalPackages\s*:\s*\[[\s\S]*?['"]crawlee['"][\s\S]*?\]/.test(cfg),
      'crawlee must remain in next.config serverExternalPackages',
    ).toBe(true);
  });

  it('pins crawlee to the same major range the engine resolves, so pnpm dedupes to one copy', () => {
    const webPkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string> };
    const enginePkg = JSON.parse(readFileSync(resolve(WEB_DIR, '../../packages/engine/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(webPkg.dependencies?.crawlee).toBe(enginePkg.dependencies?.crawlee);
  });
});
