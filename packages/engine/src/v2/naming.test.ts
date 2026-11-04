/**
 * A1: the second grade is AI readability everywhere in v2. No v2 source or fixture names "AI
 * visibility" or "AI readiness" in any spelling, outside the specifiers of imports from v1 modules,
 * whose names stay.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const OLD_NAME = /ai[\s_-]*(?:visibility|readiness)/i;
/** `from '…'` and `import('…')` specifiers: paths of v1 modules, which keep their names. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*)(['"])[^'"]*\1/g;

export function oldNamesIn(source: string): string[] {
  return source
    .replace(SPECIFIER, '')
    .split('\n')
    .filter((line) => OLD_NAME.test(line));
}

function files(dir: URL): URL[] {
  return readdirSync(dir).flatMap((name) => {
    const url = new URL(name, dir);
    if (statSync(url).isDirectory()) return files(new URL(`${name}/`, dir));
    return /\.(?:ts|json)$/.test(name) ? [url] : [];
  });
}

describe('v2 names the grade AI readability', () => {
  it('no v2 source file names AI visibility or AI readiness', () => {
    const self = new URL(import.meta.url).pathname; // this file holds the spellings it looks for
    const scanned = [
      ...files(new URL('./', import.meta.url)),
      ...files(new URL('../../fixtures/v2/', import.meta.url)),
    ].filter((f) => f.pathname !== self);
    expect(scanned.length).toBeGreaterThan(100);
    const found = scanned.flatMap((f) =>
      oldNamesIn(readFileSync(f, 'utf8')).map((line) => `${f.pathname}: ${line.trim()}`),
    );
    expect(found).toEqual([]);
  });

  it('the scan finds each spelling, and leaves a v1 import path alone', () => {
    for (const s of [
      'aiVisibility',
      'ai_visibility',
      'AI_VISIBILITY',
      'AiReadiness',
      'ai-readiness',
      'AI readiness',
    ]) {
      expect(oldNamesIn(`const x = '${s}';`), s).toHaveLength(1);
    }
    expect(oldNamesIn(`import { X } from '../analysis/ai-readiness/constants.js';`)).toEqual([]);
    expect(oldNamesIn(`const m = await import('../analysis/ai-readiness/x.js');`)).toEqual([]);
  });
});
