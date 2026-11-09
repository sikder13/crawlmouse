// Decides whether CI's visual shards, security-browser and zap-baseline run for a branch: they run
// unless every file the branch changed is on the reviewed SKIP list below, a list of paths that
// cannot change what the preview pages render or how next start answers. The list is the reviewed
// part; apps/web/__tests__/security/ci-workflow.test.ts walks the imports of every non-test
// file under apps/web/app, the middleware, the Next, PostCSS, Tailwind, instrumentation and Sentry
// configs, the visual and security-browser specs and the locked design screens, and fails if any
// file they reach is skippable. The comment above that walk says what it cannot see.
//
// A path is skipped when it matches a SKIP pattern and no KEEP pattern. An empty list of changed
// files runs everything: an empty diff is more likely a broken diff than a branch with no change.
//
// CLI: changed paths on stdin, separated by NUL or newline. Prints `visual=true|false` (for
// $GITHUB_OUTPUT) on stdout, and the paths that forced a run on stderr.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Paths that cannot affect rendering. Not `inngest/**`: the API routes next start serves to
 * security-browser and zap-baseline import it.
 */
export const SKIP = [
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
];

/** Exceptions to SKIP: these always run the jobs. */
export const KEEP = [
  // Read by tests/visual's reference, parity and copy specs.
  'docs/design/**',
  'tests/visual/**',
  'packages/types/**',
  'packages/engine/**',
  'packages/timing/**',
  // security-browser's own specs and Playwright config.
  'apps/web/__tests__/security/browser/**',
  // This file decides what runs.
  '.github/workflows/scripts/changes.mjs',
  // A manifest changes what pnpm installs for every job, wherever it sits.
  '**/package.json',
];

/** A glob over repository-relative paths: `**` crosses directories, `*` does not. */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

const SKIP_RE = SKIP.map(globToRegExp);
const KEEP_RE = KEEP.map(globToRegExp);

export function skippable(path) {
  return SKIP_RE.some((re) => re.test(path)) && !KEEP_RE.some((re) => re.test(path));
}

/** The changed paths that cannot be skipped. */
export function forcing(files) {
  return files.filter((f) => !skippable(f));
}

export function needsVisual(files) {
  if (files.length === 0) return true;
  return forcing(files).length > 0;
}

export function parseChanged(text) {
  return text.split(/[\0\n]/).filter((f) => f !== '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = parseChanged(readFileSync(0, 'utf8'));
  const visual = needsVisual(files);
  if (files.length === 0) {
    console.error('no changed files read: running everything');
  } else if (visual) {
    const force = forcing(files);
    console.error(`${force.length} of ${files.length} changed file(s) can affect rendering:`);
    for (const f of force) console.error(`  ${f}`);
  } else {
    console.error(`all ${files.length} changed file(s) are on the skip list`);
  }
  console.log(`visual=${visual}`);
}
