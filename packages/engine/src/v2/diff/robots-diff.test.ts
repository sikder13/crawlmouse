import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LCS_CELL_LIMIT, lineDiff } from './robots-diff.js';

/** Whether `part` appears in `whole` in order, not necessarily side by side. */
function isSubsequence(part: string[], whole: string[]): boolean {
  let k = 0;
  for (const line of whole) if (k < part.length && line === part[k]) k++;
  return k === part.length;
}
const split = (text: string) =>
  text.split('\n').filter((l, k, all) => k < all.length - 1 || l !== '');

describe('lineDiff', () => {
  it('finds nothing between equal texts, whatever their line endings', () => {
    expect(lineDiff('User-agent: *\r\nDisallow: /\r\n', 'User-agent: *\nDisallow: /\n')).toEqual({
      removed: [],
      added: [],
    });
  });

  it('quotes a changed line as removed and added, and leaves the rest', () => {
    expect(lineDiff('a\nb\nc\n', 'a\nB\nc\n')).toEqual({ removed: ['b'], added: ['B'] });
  });

  it('sees a line that moved, which a count of lines would miss', () => {
    const { removed, added } = lineDiff(
      'User-agent: A\nDisallow: /\nUser-agent: B\n',
      'User-agent: A\nUser-agent: B\nDisallow: /\n',
    );
    expect(removed).toHaveLength(1);
    expect(added).toEqual(removed);
  });

  it('keeps the longest common run of lines on both sides (property)', () => {
    const line = fc.constantFrom('User-agent: *', 'Disallow: /', 'Allow: /a', 'Sitemap: x', '');
    fc.assert(
      fc.property(fc.array(line, { maxLength: 12 }), fc.array(line, { maxLength: 12 }), (a, b) => {
        const before = a.join('\n');
        const after = b.join('\n');
        const { removed, added } = lineDiff(before, after);
        const A = split(before);
        const B = split(after);
        // The quoted lines come from each side in file order, and what is kept is a longest
        // common subsequence (its length checked by brute force on these small inputs).
        expect(isSubsequence(removed, A)).toBe(true);
        expect(isSubsequence(added, B)).toBe(true);
        expect(A.length - removed.length).toBe(lcsLength(A, B));
        expect(B.length - added.length).toBe(lcsLength(A, B));
      }),
      { numRuns: 300 },
    );
  });

  it(`stops looking for the shortest diff past ${LCS_CELL_LIMIT.toLocaleString('en')} cells, and still gives a true one`, () => {
    const before = Array.from({ length: 1500 }, (_, k) => `Disallow: /old/${k}`);
    const after = Array.from({ length: 1500 }, (_, k) => `Disallow: /new/${k}`);
    before.splice(700, 0, 'Allow: /shared');
    after.splice(800, 0, 'Allow: /shared');
    const started = performance.now();
    const { removed, added } = lineDiff(before.join('\n'), after.join('\n'));
    expect(performance.now() - started).toBeLessThan(500);
    expect(isSubsequence(removed, before)).toBe(true);
    expect(isSubsequence(added, after)).toBe(true);
    // Past the limit the shared line in the middle is quoted on both sides rather than kept.
    expect(removed).toHaveLength(before.length);
  });
});

function lcsLength(a: string[], b: string[]): number {
  const row = new Array<number>(b.length + 1).fill(0);
  for (const x of a) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = row[j]!;
      row[j] = x === b[j - 1] ? diagonal + 1 : Math.max(row[j]!, row[j - 1]!);
      diagonal = up;
    }
  }
  return row[b.length]!;
}
