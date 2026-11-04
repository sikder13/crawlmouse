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

/**
 * The release written into the bundle (src/release.ts): the first 12 hex digits of the commit
 * checked out, or `unreleased` when git cannot say (no repository, no git).
 */
export function releaseOf(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: dirname(ENTRY),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return /^[0-9a-f]{12}$/.test(sha) ? sha : 'unreleased';
  } catch {
    return 'unreleased';
  }
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
