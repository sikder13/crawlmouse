import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * V2_PIPELINE registers the pipeline's functions; V2_CHECKS_PUBLIC switches what the account door
 * promises about checks (CC-20b split them). Each is read in flags.ts and nowhere else, and the two
 * account pages that render the promises read the copy flag, never the pipeline one.
 */

const WEB = join(__dirname, '../..');
const SKIP = new Set(['node_modules', '.next', '__tests__', 'tests', 'public']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIP.has(name) ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const rel = (path: string) => relative(WEB, path);

describe('the v2 pipeline and copy flags', () => {
  it('are read from the environment in lib/auth/flags.ts only', () => {
    const readers = sources(WEB)
      .filter((f) => /\bV2_(PIPELINE|CHECKS_PUBLIC)\b/.test(readFileSync(f, 'utf8')))
      .filter((f) => /env\??\.V2_(PIPELINE|CHECKS_PUBLIC)\b/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(readers).toEqual(['lib/auth/flags.ts']);
  });

  it.each(['app/(account)/signup/page.tsx', 'app/(account)/check-email/page.tsx'])(
    '%s renders the promises from V2_CHECKS_PUBLIC',
    (page) => {
      const source = readFileSync(join(WEB, page), 'utf8');
      expect(source).toMatch(/checksPublic=\{checksPublicEnabled\(\)\}/);
      expect(source).not.toMatch(/\bpipelineEnabled\b/);
    },
  );
});
