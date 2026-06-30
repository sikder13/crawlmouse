import { describe, it, expect } from 'vitest';
import { groupAndCapFindings, mapFindingRows, type FindingRow } from './findings';

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
  it('shows all rows with no hidden when a category has exactly the free limit (boundary)', () => {
    const groups = groupAndCapFindings(mk('orphan', 5), false);
    expect(groups[0]!.shown).toHaveLength(5);
    expect(groups[0]!.hidden).toBe(0);
    expect(groups[0]!.total).toBe(5);
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

// SPEC 02 §6/D4 — on v2 the volume cap is RETIRED (free sees the full diagnosis; the wall moves to the
// cure). The `uncapped` flag drives that; v1 (uncapped omitted/false) stays byte-identical.
describe('groupAndCapFindings — v2 uncapped (D4: gate value, not volume)', () => {
  it('shows ALL rows for a non-Pro viewer when uncapped', () => {
    const groups = groupAndCapFindings(mk('orphan', 9), false, undefined, true);
    expect(groups[0]!.shown).toHaveLength(9);
    expect(groups[0]!.hidden).toBe(0);
  });
  it('still caps for a non-Pro viewer when NOT uncapped (v1 byte-identical)', () => {
    const groups = groupAndCapFindings(mk('orphan', 9), false, undefined, false);
    expect(groups[0]!.shown).toHaveLength(5);
    expect(groups[0]!.hidden).toBe(4);
  });
});

// SPEC 02 v1.1 — the typed full-diagnosis `findings: Finding[]` is mapped from the DB rows; `payload`
// is never stored/emitted and `pageUrl` is pulled from the joined pages.url.
describe('mapFindingRows', () => {
  it('maps DB rows to typed Finding[], pulling pageUrl from pages.url and never adding payload', () => {
    const rows: FindingRow[] = [
      { category: 'orphan', severity: 'critical', pages: { url: 'https://x.com/a' } },
      { category: 'deep_page', severity: 'minor', pages: null },
    ];
    const out = mapFindingRows(rows);
    expect(out[0]).toEqual({ category: 'orphan', severity: 'critical', pageUrl: 'https://x.com/a' });
    expect(out[1]).toEqual({ category: 'deep_page', severity: 'minor', pageUrl: undefined });
    expect(out.every((f) => !('payload' in f))).toBe(true);
  });
  it('returns an empty array for no rows', () => {
    expect(mapFindingRows([])).toEqual([]);
  });
});
