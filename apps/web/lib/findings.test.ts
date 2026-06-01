import { describe, it, expect } from 'vitest';
import { groupAndCapFindings, type FindingRow } from './findings';

const mk = (category: string, n: number): FindingRow[] =>
  Array.from({ length: n }, (_, i) => ({ category, severity: 'minor', pages: { url: `https://x.com/${category}/${i}` } }));

describe('groupAndCapFindings', () => {
  it('caps each category to top-5 for free users and reports hidden count', () => {
    const groups = groupAndCapFindings([...mk('orphan', 7), ...mk('deep_page', 3)], false);
    const orphan = groups.find((g) => g.category === 'orphan')!;
    expect(orphan.total).toBe(7);
    expect(orphan.shown).toHaveLength(5);
    expect(orphan.hidden).toBe(2);
    const deep = groups.find((g) => g.category === 'deep_page')!;
    expect(deep.shown).toHaveLength(3);
    expect(deep.hidden).toBe(0);
  });
  it('shows everything for Pro users', () => {
    const groups = groupAndCapFindings(mk('orphan', 7), true);
    expect(groups[0]!.shown).toHaveLength(7);
    expect(groups[0]!.hidden).toBe(0);
  });
  it('returns an empty array for no findings', () => {
    expect(groupAndCapFindings([], false)).toEqual([]);
  });
});
