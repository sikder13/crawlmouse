import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadFixtures, SPEC_URL } from './spec/load.js';
import { renderContractSpec, table } from './spec/render.js';

describe('docs/specs/v2/11-type-contract.md', () => {
  it('is exactly what the schemas, entity docs and fixtures render to', () => {
    expect(readFileSync(SPEC_URL, 'utf8')).toBe(renderContractSpec(loadFixtures()));
  });

  it('lays tables out the way Prettier does, so the format check leaves them alone', () => {
    expect(
      table(
        ['a', 'bb'],
        [
          ['x', 'y'],
          ['longer cell', 'z'],
        ],
      ),
    ).toBe(
      [
        '| a           | bb  |',
        '| ----------- | --- |',
        '| x           | y   |',
        '| longer cell | z   |',
      ].join('\n'),
    );
  });

  it.each(['a|b', '*emphasis*', '__proto__', 'café'])(
    'refuses a cell Prettier would rewrite: %s',
    (cell) => {
      expect(() => table(['x'], [[cell]])).toThrow(/Prettier would rewrite/);
    },
  );
});
