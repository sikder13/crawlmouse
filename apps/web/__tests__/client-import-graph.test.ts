import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GUARD: no client component reaches the Inngest functions, the `inngest` package or a `node:` built-in.
 *
 * `next build` failed on #168 with `Reading from "node:async_hooks" is not handled by plugins`: a
 * client component (`PublicLink.tsx`) imported the site copy, the copy imported
 * `lib/v2/pipeline/limits.ts` for one constant, and `limits.ts` imports `inngest/check`, whose client
 * imports `node:async_hooks`. Unit tests and `tsc` passed; only the build saw it. This walks the
 * static import graph of every file under `app`, `components` and `lib` whose first statement is
 * `'use client'`, from its own imports, and fails on a path to the repo's `inngest/` folder, to the
 * `inngest` package, or to a `node:` specifier, which webpack cannot read in a client bundle.
 * A bare built-in name without the scheme (`'crypto'`) is not matched.
 *
 * What it reads: `import … from`, `export … from`, a bare `import '…'` and `import('…')`, with `@/` and
 * relative specifiers resolved. An `import type` or `export type` is erased and is not followed.
 * What it does not see: a workspace package's own imports (`@crawlmouse/*` is not followed), and an
 * import that `next.config` aliases elsewhere.
 */

const WEB = resolve(__dirname, '..');
const REPO = resolve(WEB, '../..');
const INNGEST_DIR = join(REPO, 'inngest') + '/';
const ROOTS = ['app', 'components', 'lib'];
const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(tsx?|mjs|js)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [p] : [];
  });
}

const isClient = (text: string) =>
  /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use client['"]/.test(text);

/** The specifiers a module imports at run time. */
export function specifiers(text: string): string[] {
  const out: string[] = [];
  const stmt = /(?:^|[\n;])\s*(import|export)\s+([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(stmt)) {
    if (/^type\b/.test(m[2]!)) continue;
    out.push(m[3]!);
  }
  for (const m of text.matchAll(/(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g)) out.push(m[1]!);
  for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]!);
  return out;
}

function resolveSpec(from: string, spec: string): string | null {
  const base = spec.startsWith('@/')
    ? join(WEB, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(dirname(from), spec)
      : null;
  if (base === null) return null;
  for (const ext of EXTENSIONS) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/** A package a client bundle cannot take: Inngest's, or a Node built-in (webpack has no `node:` scheme). */
const isServerPackage = (spec: string) =>
  spec === 'inngest' || spec.startsWith('inngest/') || spec.startsWith('node:');

/** A path from `start` to Inngest or a `node:` built-in, as the files it passes through, or null. */
export function pathToServer(start: string): string[] | null {
  const seen = new Set<string>();
  const walk = (file: string, trail: string[]): string[] | null => {
    if (file.startsWith(INNGEST_DIR)) return [...trail, file];
    if (seen.has(file)) return null;
    seen.add(file);
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      if (isServerPackage(spec)) return [...trail, file, spec];
      const next = resolveSpec(file, spec);
      if (next) {
        const found = walk(next, [...trail, file]);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(start, []);
}

const rel = (p: string) => (p.startsWith('/') ? relative(REPO, p) : p);

describe('GUARD: client components do not reach Inngest or a Node built-in', () => {
  const clients = ROOTS.flatMap((r) => files(join(WEB, r))).filter((f) =>
    isClient(readFileSync(f, 'utf8')),
  );

  it('finds client components to check', () => {
    expect(clients.length).toBeGreaterThan(50);
    expect(clients.map(rel)).toContain('apps/web/components/v2/screens/site/PublicLink.tsx');
  });

  it('the walk finds real paths: limits.ts reaches inngest/check, the hook reaches node:crypto', () => {
    const path = pathToServer(join(WEB, 'lib/v2/pipeline/limits.ts'));
    expect(path?.map(rel)).toEqual(['apps/web/lib/v2/pipeline/limits.ts', 'inngest/check.ts']);
    const hook = pathToServer(join(WEB, 'lib/v2/account/deploy-hook.ts'));
    expect(hook?.map(rel)).toEqual(['apps/web/lib/v2/account/deploy-hook.ts', 'node:crypto']);
  });

  it('reads every import form, and passes over type-only ones', () => {
    expect(
      specifiers(
        [
          "import a from './a';",
          "import { type B, c } from '@/c';",
          "import type { D } from './d';",
          "export { e } from './e';",
          "export type { F } from './f';",
          "import './g';",
          "const h = await import('./h');",
        ].join('\n'),
      ),
    ).toEqual(['./a', '@/c', './e', './g', './h']);
  });

  it('no client component has a path to Inngest or a node: built-in', () => {
    const found = clients
      .map((f) => pathToServer(f))
      .filter((p): p is string[] => p !== null)
      .map((p) => p.map(rel).join(' → '));
    expect(found).toEqual([]);
  });
});
