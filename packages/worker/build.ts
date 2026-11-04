import { execFileSync } from 'node:child_process';
import { build, type Metafile } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { READER_FILE } from './src/reader/file.js';

export { READER_FILE };

/**
 * Bundles the worker into two ES modules with every dependency inside them, so the image needs nothing
 * but Node: dist/main.mjs, the server, and dist/reader.mjs beside it, the page reader thread's entry
 * (src/reader/thread.ts), which main.mjs starts by that name. Run with
 * `pnpm --filter @crawlmouse/worker build`.
 */

export const ENTRY = fileURLToPath(new URL('src/main.ts', import.meta.url));
export const OUTFILE = fileURLToPath(new URL('dist/main.mjs', import.meta.url));
export const READER_ENTRY = fileURLToPath(new URL('src/reader/thread.ts', import.meta.url));

/** Both bundles: main.mjs at `outfile`, reader.mjs beside it. The metafile is main.mjs's. */
export async function bundle(outfile = OUTFILE): Promise<Metafile> {
  await bundleReader(join(dirname(outfile), READER_FILE));
  return bundleOne(ENTRY, outfile);
}

export async function bundleReader(outfile: string): Promise<Metafile> {
  return bundleOne(READER_ENTRY, outfile);
}

/** Runs `git rev-parse HEAD` beside the entry point; throws when git cannot say. */
const gitHead = (): string =>
  execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: dirname(ENTRY),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

/**
 * The release written into the bundle (src/release.ts): the first 12 hex digits of the commit
 * checked out. A local build git cannot place (no repository, a "dubious ownership" refusal) is
 * `unreleased`; in CI (`CI` or `GITHUB_ACTIONS` set) that is an error, so a deployed bundle always
 * names its commit.
 */
export function releaseOf(
  env: Readonly<Record<string, string | undefined>> = process.env,
  head: () => string = gitHead,
): string {
  let sha = '';
  try {
    sha = head();
  } catch {
    sha = '';
  }
  if (/^[0-9a-f]{40}$/.test(sha)) return sha.slice(0, 12);
  if (env.CI || env.GITHUB_ACTIONS)
    throw new Error('build: the commit could not be read, so the bundle cannot name its release');
  return 'unreleased';
}

async function bundleOne(entry: string, outfile: string): Promise<Metafile> {
  const result = await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    metafile: true,
    legalComments: 'none',
    define: { __WORKER_RELEASE__: JSON.stringify(releaseOf()) },
    logLevel: 'warning',
    // Some bundled CommonJS dependencies call require() on node built-ins.
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  });
  return result.metafile;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await bundle();
