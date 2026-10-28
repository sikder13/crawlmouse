import { build, type Metafile } from 'esbuild';
import { fileURLToPath } from 'node:url';

/**
 * Bundles the worker into one ES module, dist/main.mjs, with every dependency inside it, so the image
 * needs nothing but Node. Run with `pnpm --filter @crawlmouse/worker build`.
 */

export const ENTRY = fileURLToPath(new URL('src/main.ts', import.meta.url));
export const OUTFILE = fileURLToPath(new URL('dist/main.mjs', import.meta.url));

export async function bundle(outfile = OUTFILE): Promise<Metafile> {
  const result = await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    metafile: true,
    legalComments: 'none',
    logLevel: 'warning',
    // Some bundled CommonJS dependencies call require() on node built-ins.
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  });
  return result.metafile;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await bundle();
