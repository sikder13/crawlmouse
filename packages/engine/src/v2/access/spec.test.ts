import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INPUTS_READ, renderAccessSpec, SPEC_URL } from './spec.js';

describe('docs/specs/v2/15-access-detectors.md', () => {
  it('is exactly what the code renders it to', () => {
    expect(readFileSync(SPEC_URL, 'utf8')).toBe(renderAccessSpec());
  });

  it('labels the derived NPR fixture as derived', () => {
    expect(renderAccessSpec()).toMatch(
      /`npr-robots-unreachable\.json` +\| DERIVED, not observed\./,
    );
  });
});

/** The fields a module can read by name: an AccessTest's, a page's, a robots reading's, and a cell's. */
const INPUT =
  /\.(id|ua|page_url|template_key|verdict|cause|raw_status|status|evidence_class|headers|url|robots_search)\b/g;

/** The fields a module's code (not its comments) reads. */
function readIn(file: string): string[] {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  return [...new Set([...src.matchAll(INPUT)].map((m) => m[1]!))].sort();
}

describe('the inputs table in the spec', () => {
  it.each(Object.entries(INPUTS_READ))(
    '%s.ts reads exactly what the table says',
    (module, fields) => {
      expect(readIn(`${module}.ts`)).toEqual([...fields].sort());
    },
  );

  it('the source scan sees a read, so an empty row is not an empty scan', () => {
    expect(readIn('robots.ts')).toContain('verdict');
  });
});
