/**
 * R2-B1: `CHECK_INPUTS` (live.ts) is the set of repository paths the check's answers depend on, held
 * to the code rather than written from memory. The modules are a walk of check.ts's runtime imports
 * (module-graph.ts); the files they read are `READS`, and a module in the graph that touches the file
 * system without a `READS` entry fails the last case, so a probe that starts reading a new file fails
 * here until the list says where.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../../db/files';
import { REPO_ROOT } from '../env-scan';
import { moduleGraph, runtimeSpecifiers } from '../module-graph';
import { CHECK_INPUTS } from './live';

const covers = (entry: string, path: string): boolean =>
  path === entry || path.startsWith(`${entry}/`);
const covered = (path: string): boolean => CHECK_INPUTS.some((e) => covers(e, path));

/**
 * Each module in the graph that reads the file system, and the checkout paths it reads at runtime.
 * check.ts reads the env file (`scripts/.env.local`, gitignored, so it is no input of a commit);
 * env-scan.ts's scanners are not called by the check (asserted below), only `REPO_ROOT` is used.
 */
const READS: Record<string, readonly string[]> = {
  'scripts/golive/check.ts': [],
  'scripts/golive/env-scan.ts': [],
  'scripts/golive/probes/worker.ts': ['.github/workflows/worker-staging.yml'],
  'scripts/db/files.ts': ['infra/supabase/migrations'],
};

const FS_READ = /\b(readFileSync|readFile|readdirSync|readdir|createReadStream|opendirSync)\s*\(/;

const graph = moduleGraph('scripts/golive/check.ts');

describe('the module walk', () => {
  it('skips type-only imports and follows mixed, re-exported and dynamic ones', () => {
    const src = [
      "import type { A } from './a';",
      "import { type B } from './b';",
      "import { type C, d } from './c';",
      "import e from './e';",
      "export { f } from './f';",
      "export type { G } from './g';",
      "const h = await import('./h');",
      "import './i';",
    ].join('\n');
    expect(runtimeSpecifiers(src).sort()).toEqual(['./c', './e', './f', './h', './i']);
  });

  it('reaches a file two imports away and a workspace package export', () => {
    expect(graph).toContain('apps/web/lib/billing/prices.ts');
    expect(graph).toContain('inngest/check.ts');
    expect(graph).toContain('scripts/golive/probes/vercel-env.ts');
  });
});

describe('CHECK_INPUTS', () => {
  it('covers every module the check loads', () => {
    expect(graph.filter((f) => !covered(f))).toEqual([]);
  });

  it('names nothing the check neither loads nor reads', () => {
    const reads = Object.values(READS).flat();
    const unused = CHECK_INPUTS.filter(
      (e) => !graph.some((f) => covers(e, f)) && !reads.some((r) => covers(e, r)),
    );
    expect(unused).toEqual([]);
  });

  it('covers every path a loaded module reads', () => {
    for (const [file, paths] of Object.entries(READS)) {
      for (const p of paths) expect(covered(p), `${file} reads ${p}`).toBe(true);
    }
  });

  it('has a READS entry for each loaded module that touches the file system, and no other', () => {
    const readers = graph.filter((f) => FS_READ.test(readFileSync(join(REPO_ROOT, f), 'utf8')));
    expect(readers.sort()).toEqual(Object.keys(READS).sort());
  });

  it("names worker.ts's file and the migrations directory as the code writes them", () => {
    const worker = readFileSync(join(REPO_ROOT, 'scripts/golive/probes/worker.ts'), 'utf8');
    expect(worker).toContain("'.github/workflows/worker-staging.yml'");
    // check.ts calls listMigrations (for its vocabulary), which reads MIGRATIONS_DIR.
    expect(relative(REPO_ROOT, MIGRATIONS_DIR)).toBe('infra/supabase/migrations');
  });

  it("does not call env-scan's scanners from any loaded module", () => {
    const callers = graph.filter(
      (f) =>
        f !== 'scripts/golive/env-scan.ts' &&
        /\b(scan|scanDynamic|sourceFiles|scanRoots)\s*\(/.test(
          readFileSync(join(REPO_ROOT, f), 'utf8'),
        ),
    );
    expect(callers).toEqual([]);
  });
});
