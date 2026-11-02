import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DETECTORS } from './index.js';
import { INPUTS_READ, renderStructureSpec, SPEC_URL } from './spec.js';

describe('docs/specs/v2/16-structure-detectors.md', () => {
  it('is exactly what the code renders it to', () => {
    expect(readFileSync(SPEC_URL, 'utf8')).toBe(renderStructureSpec());
  });
});

/** The inputs a detector can read by name: the PageFacts fields, robots_search and disallowed. */
const INPUT =
  /\.(final_url|redirect|canonical|links_read|simhash|hreflang|robots_search|disallowed)\b/g;
const MODULE: Record<string, string> = {
  scope: 'scope.ts',
  orphan_pages: 'orphans.ts',
  deep_pages: 'deep-pages.ts',
  generic_anchor_text: 'generic-anchors.ts',
  redirect_chain: 'redirect-chains.ts',
  duplicate_pagination: 'duplicate-pagination.ts',
  canonical_mismatch: 'canonical-mismatch.ts',
  hreflang_gap: 'hreflang-gaps.ts',
};

/** The inputs a module's code (not its comments) reads. */
function readIn(file: string): string[] {
  const code = readFileSync(new URL(file, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  return [...new Set([...code.matchAll(INPUT)].map((m) => m[1]!))].sort();
}

describe('the inputs table in the spec', () => {
  it('names a module for scope and for every detector', () => {
    expect(Object.keys(INPUTS_READ).sort()).toEqual(
      ['scope', ...DETECTORS.map((d) => d.type)].sort(),
    );
  });

  it.each(Object.entries(MODULE))('%s reads exactly what the table says (%s)', (key, file) => {
    expect(readIn(file)).toEqual([...INPUTS_READ[key as keyof typeof INPUTS_READ]].sort());
  });

  it('the source scan sees a read, so an empty row is not an empty scan', () => {
    expect(readIn('redirect-chains.ts')).toContain('redirect');
  });
});
