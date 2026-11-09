import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  KEEP,
  SKIP,
  needsVisual,
  parseChanged,
  skippable,
} from '../../../../.github/workflows/scripts/changes.mjs';

// CI's trigger, CodeQL's condition, and when the visual shards, security-browser and zap-baseline
// run (.github/workflows/ci.yml, .github/workflows/scripts/changes.mjs). The workflow is parsed with
// the `yaml` package, which reads YAML 1.2: the key `on` is the string "on", as GitHub reads it,
// where a YAML 1.1 parser would read the boolean true. The `visual` job's script is executed.

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const CI_FILE = join(REPO, '.github/workflows/ci.yml');

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};
type Job = {
  needs?: string | string[];
  if?: string;
  steps?: Step[];
  outputs?: Record<string, string>;
};
const ci = parse(readFileSync(CI_FILE, 'utf8')) as {
  on: unknown;
  concurrency: { group: string };
  jobs: Record<string, Job>;
};

function job(name: string): Job {
  const j = ci.jobs[name];
  if (!j) throw new Error(`ci.yml has no job ${name}`);
  return j;
}

function needs(name: string): string[] {
  const n = job(name).needs;
  return n === undefined ? [] : Array.isArray(n) ? n : [n];
}

describe('ci.yml triggers', () => {
  it('runs on pushes to every branch and on nothing else', () => {
    expect(ci.on).toEqual({ push: { branches: ['**'] } });
  });

  it('keys its concurrency group on the ref, with one group per commit on main', () => {
    expect(ci.concurrency.group).toBe(
      "ci-${{ github.ref }}${{ github.ref == 'refs/heads/main' && format('-{0}', github.sha) || '' }}",
    );
  });

  it('has no step left that reads the pull_request event', () => {
    expect(readFileSync(CI_FILE, 'utf8')).not.toMatch(/pull_request/);
  });
});

describe('codeql', () => {
  it('runs only while the repository is public', () => {
    expect(job('codeql').if).toBe('${{ !github.event.repository.private }}');
  });

  it('uploads its results from every run', () => {
    const analyze = (job('codeql').steps ?? []).find((s) =>
      s.uses?.startsWith('github/codeql-action/analyze@'),
    );
    expect(analyze?.with?.upload).toBe('always');
  });
});

describe('the changes job and the jobs it gates', () => {
  it('checks out the full history without credentials, at the pinned checkout', () => {
    const [checkout] = job('changes').steps ?? [];
    const lintCheckout = (job('lint').steps ?? [])[0];
    expect(checkout?.uses).toBe(lintCheckout?.uses);
    expect(checkout?.with).toEqual({ 'fetch-depth': 0, 'persist-credentials': false });
  });

  it('outputs visual from its decide step, and runs changes.mjs on the merge-base diff', () => {
    expect(job('changes').outputs).toEqual({ visual: '${{ steps.decide.outputs.visual }}' });
    const decide = (job('changes').steps ?? []).find((s) => (s as { id?: string }).id === 'decide');
    expect(decide?.run).toContain('git merge-base origin/main HEAD');
    expect(decide?.run).toContain('--no-renames');
    expect(decide?.run).toContain('node .github/workflows/scripts/changes.mjs');
  });

  it.each(['visual-shard', 'security-browser', 'zap-baseline'])(
    '%s runs only when visual is true',
    (name) => {
      expect(needs(name)).toContain('changes');
      expect(job(name).if).toBe("needs.changes.outputs.visual == 'true'");
    },
  );

  it('security-browser and zap-baseline still need the build', () => {
    expect(needs('security-browser')).toEqual(['build', 'changes']);
    expect(needs('zap-baseline')).toEqual(['build', 'changes']);
  });

  it('the required visual check needs both, and always runs', () => {
    expect(needs('visual')).toEqual(['changes', 'visual-shard']);
    expect(job('visual').if).toBe('${{ always() }}');
  });
});

describe('the rule the required visual check applies', () => {
  const [step] = job('visual').steps ?? [];

  it('reads the three results through env', () => {
    expect(step?.env).toEqual({
      SHARDS: '${{ needs.visual-shard.result }}',
      CHANGES: '${{ needs.changes.result }}',
      VISUAL: '${{ needs.changes.outputs.visual }}',
    });
  });

  function rule(SHARDS: string, CHANGES: string, VISUAL: string) {
    return spawnSync('bash', ['-c', step?.run ?? 'exit 0'], {
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '/usr/bin:/bin', SHARDS, CHANGES, VISUAL },
      encoding: 'utf8',
    });
  }

  // Written out by hand rather than derived from the script.
  function expected(shards: string, changes: string, visual: string): boolean {
    if (shards === 'success') return true;
    return shards === 'skipped' && changes === 'success' && visual === 'false';
  }

  const RESULTS = ['success', 'failure', 'cancelled', 'skipped'];
  const cases = RESULTS.flatMap((shards) =>
    RESULTS.flatMap((changes) =>
      ['true', 'false', ''].map((visual) => [shards, changes, visual] as const),
    ),
  );

  it('covers every combination (4 x 4 x 3)', () => {
    expect(cases).toHaveLength(48);
  });

  it.each(cases)('shards=%s changes=%s visual=%j', (shards, changes, visual) => {
    const r = rule(shards, changes, visual);
    expect(r.status === 0, r.stdout + r.stderr).toBe(expected(shards, changes, visual));
  });

  it.each([
    ['skipped', 'failure', ''],
    ['skipped', 'cancelled', ''],
    ['skipped', 'success', 'true'],
    ['skipped', 'success', ''],
    ['failure', 'success', 'true'],
    ['cancelled', 'success', 'true'],
  ])('fails, naming why: shards=%s changes=%s visual=%j', (shards, changes, visual) => {
    const r = rule(shards, changes, visual);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^::error::/m);
  });
});

describe('changes.mjs', () => {
  it('pins the skip list and its exceptions', () => {
    expect(SKIP).toEqual([
      'docs/**',
      '*.md',
      'infra/**',
      'scripts/**',
      'packages/worker/**',
      'evidence/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/__tests__/**',
      '.github/workflows/db-*.yml',
      '.github/workflows/nightly.yml',
      '.github/workflows/worker-staging.yml',
      '.github/workflows/scripts/**',
      'osv-scanner.toml',
      '.gitleaksignore',
      'renovate.json',
    ]);
    expect(KEEP).toEqual([
      'docs/design/**',
      'tests/visual/**',
      'packages/types/**',
      'packages/engine/**',
      'packages/timing/**',
      'apps/web/__tests__/security/browser/**',
      '.github/workflows/scripts/changes.mjs',
      '**/package.json',
    ]);
  });

  it.each([
    ['docs only', ['docs/ops/db-migrations.md', 'README.md'], false],
    ['docs and a lib file', ['docs/ops/a.md', 'apps/web/lib/x.ts'], true],
    ['a web test file', ['apps/web/foo.test.ts'], false],
    ['a web component test', ['apps/web/components/v2/x.test.tsx'], false],
    ['a web __tests__ file', ['apps/web/__tests__/v2/a.ts'], false],
    ['a security-browser spec', ['apps/web/__tests__/security/browser/headers.pw.ts'], true],
    ['a visual spec', ['tests/visual/a.spec.ts'], true],
    ['a visual baseline', ['tests/visual/__snapshots__/a.png'], true],
    ['a locked design screen', ['docs/design/v2/screens/Final-Crawl.dc.html'], true],
    ['nothing at all', [], true],
    ['ci.yml', ['.github/workflows/ci.yml'], true],
    ['the setup action', ['.github/actions/setup/action.yml'], true],
    ['the lockfile', ['pnpm-lock.yaml'], true],
    ['the root manifest', ['package.json'], true],
    ['a manifest under a skipped directory', ['inngest/package.json'], true],
    ['the CI env file', ['apps/web/.env.ci'], true],
    ['changes.mjs itself', ['.github/workflows/scripts/changes.mjs'], true],
    ['the sarif gate', ['.github/workflows/scripts/sarif-gate.mjs'], false],
    ['a production workflow', ['.github/workflows/db-apply-prod.yml'], false],
    ['an engine test', ['packages/engine/src/a.test.ts'], true],
    ['a worker source file', ['packages/worker/src/a.ts'], false],
    ['an inngest source file, which API routes import', ['inngest/audit.ts'], true],
    ['an inngest test', ['inngest/audit.test.ts'], false],
    ['a markdown file below the root', ['apps/web/README.md'], true],
    ['a prefix of scripts/ that is not scripts/', ['scripts-x/a'], true],
    ['a prefix of docs/ that is not docs/', ['docsx/a'], true],
    ['a prefix of docs/design that is not it', ['docs/designs/a.md'], false],
    ['a prefix of evidence/', ['evidencex/a'], true],
    ['a file named like a test, not ending in one', ['apps/web/lib/a.test.ts.bak'], true],
  ])('%s', (_label, files, want) => {
    expect(needsVisual(files)).toBe(want);
  });

  it('reads NUL- and newline-separated paths', () => {
    expect(parseChanged('a\0b c\0')).toEqual(['a', 'b c']);
    expect(parseChanged('a\nb\n')).toEqual(['a', 'b']);
  });
});

// Every file reached through static imports, dynamic imports, require(), new URL(file, import.meta.url)
// and CSS @import, from: every non-test file under apps/web/app (the previews, the root layout, and
// the routes next start serves to security-browser and zap-baseline), the middleware and configs, the
// visual and security-browser specs, and the locked design screens. None may be on the skip list, or a
// change to it would skip the jobs that would have caught it. Not seen: a file read at run time other
// than through new URL('<literal>', import.meta.url), and a whole `import type` (erased, so it cannot
// change what runs).
describe('the import closure of what the gated jobs render and serve', () => {
  const WEB = join(REPO, 'apps/web');
  const CODE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|css)$/;
  const EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css'];

  function walkDir(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walkDir(full));
      else out.push(full);
    }
    return out;
  }

  // Workspace packages by name, with their exports (or main) for `@crawlmouse/<pkg>[/sub]`.
  const packages = new Map<string, { dir: string; exports: Record<string, unknown> }>();
  for (const dir of [
    'apps/web',
    'inngest',
    'scripts',
    ...readdirSync(join(REPO, 'packages')).map((p) => `packages/${p}`),
  ]) {
    const manifest = join(REPO, dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
      name: string;
      exports?: unknown;
      main?: string;
    };
    const exports =
      typeof pkg.exports === 'string'
        ? { '.': pkg.exports }
        : ((pkg.exports as Record<string, unknown> | undefined) ??
          (pkg.main ? { '.': pkg.main } : {}));
    packages.set(pkg.name, { dir: join(REPO, dir), exports });
  }

  function isDirectory(path: string): boolean {
    return existsSync(path) && statSync(path).isDirectory();
  }

  function exportTarget(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      const v = value as Record<string, unknown>;
      return exportTarget(v.import ?? v.default ?? v.types);
    }
    return undefined;
  }

  function resolveFile(base: string): string | undefined {
    const candidates = [base, base.replace(/\.(?:js|mjs|cjs)$/, '')];
    for (const c of candidates) {
      for (const ext of EXTENSIONS) {
        const f = c + ext;
        if (existsSync(f) && statSync(f).isFile()) return f;
      }
      for (const index of ['index.ts', 'index.tsx', 'index.js', 'index.mjs']) {
        const f = join(c, index);
        if (existsSync(f)) return f;
      }
    }
    return undefined;
  }

  /** Files for a specifier, [] for a package outside the repository, undefined when unresolved. */
  function resolveSpecifier(from: string, spec: string): string[] | undefined {
    let target: string | undefined;
    if (spec.startsWith('.')) target = resolve(dirname(from), spec);
    else if (spec.startsWith('@/')) target = join(WEB, spec.slice(2));
    else {
      const parts = spec.split('/');
      const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
      const pkg = packages.get(name);
      if (!pkg) return [];
      const sub = spec.slice(name.length);
      const exported = exportTarget(pkg.exports[sub === '' ? '.' : `.${sub}`]);
      if (!exported) return undefined;
      target = join(pkg.dir, exported);
    }
    const file = resolveFile(target);
    return file ? [file] : undefined;
  }

  const NEW_URL = /\bnew URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;
  const PATTERNS = [
    // import x from '...', import { a, type B } from '...'; a whole `import type` is erased.
    /\bimport\s+(?!type\s)[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+(?!type\s)(?:\*|\{)[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    NEW_URL,
    /@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g,
  ];

  // Test files under apps/web/app are not served, so they are not roots (a test file an import reaches
  // still counts).
  const roots = [
    ...walkDir(join(WEB, 'app')).filter((f) => !/\.test\.tsx?$/.test(f)),
    ...['middleware.ts', 'next.config.mjs', 'postcss.config.mjs', 'tailwind.config.ts'].map((f) =>
      join(WEB, f),
    ),
    ...['instrumentation.ts', 'instrumentation-client.ts', 'sentry.server.config.ts'].map((f) =>
      join(WEB, f),
    ),
    ...walkDir(join(REPO, 'tests/visual')),
    ...walkDir(join(WEB, '__tests__/security/browser')),
    ...walkDir(join(REPO, 'docs/design/v2/screens')),
  ];

  const reached = new Set<string>();
  const unresolved: string[] = [];
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (reached.has(file)) continue;
    reached.add(file);
    if (!CODE.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const pattern of PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const spec = match[1]!;
        if (/^(?:https?:|data:|node:|#)/.test(spec)) continue;
        // A directory named through new URL(…, import.meta.url) is a working directory or a folder
        // read at run time, not an import; the one such folder the specs read is a root above.
        if (pattern === NEW_URL && isDirectory(resolve(dirname(file), spec))) continue;
        const files = resolveSpecifier(file, spec);
        if (files === undefined) unresolved.push(`${relative(REPO, file)} -> ${spec}`);
        else for (const f of files) if (!reached.has(f)) queue.push(f);
      }
    }
  }
  const inRepo = [...reached].map((f) => relative(REPO, f).split(sep).join('/'));

  it('resolves every relative, aliased and workspace import it finds', () => {
    expect(unresolved).toEqual([]);
  });

  it('is not trivial: it reaches the engine, the types package and past apps/web/app', () => {
    expect(inRepo.length).toBeGreaterThan(1000);
    expect(inRepo.some((f) => f.startsWith('packages/engine/src/'))).toBe(true);
    expect(inRepo.some((f) => f.startsWith('packages/types/src/'))).toBe(true);
    expect(inRepo.some((f) => f.startsWith('apps/web/lib/'))).toBe(true);
    expect(inRepo.some((f) => f.startsWith('apps/web/components/'))).toBe(true);
  });

  it('contains no file on the skip list', () => {
    expect(inRepo.filter((f) => skippable(f))).toEqual([]);
  });
});
