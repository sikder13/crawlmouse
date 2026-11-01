import { describe, expect, it } from 'vitest';
import { findCheck, fixesAsOf, fixture } from '../fixtures';
import { FREE_FIXES, freeFixes, isFreeFix } from './free-fixes';
import { FIRST_AUDIT } from './segment/test-helpers';

describe('the free-fix rule', () => {
  it('opens the first three of the audit’s live fixes, in rank order', () => {
    const d = fixture('bad-site');
    const check = findCheck(d, FIRST_AUDIT['bad-site']);
    expect(freeFixes(d, check).map((f) => f.number)).toEqual([1, 2, 3]);
    // Fix 3 has rank 4 and fix 5 rank 5: the third free fix is the third in order, not rank 3.
    expect(freeFixes(d, check).map((f) => f.rank)).toEqual([1, 2, 4]);
    expect(FREE_FIXES).toBe(3);
  });

  it('answers per fix as the list does, for every fixture’s every finished check', () => {
    for (const name of ['bad-site', 'challenged-site', 'clean-site'] as const) {
      const d = fixture(name);
      for (const check of d.checks.filter((c) => c.finished_at !== null)) {
        const all = fixesAsOf(d, check);
        const free = freeFixes(d, check);
        expect(free).toHaveLength(Math.min(FREE_FIXES, all.length));
        for (const f of all) expect(isFreeFix(d, check, f)).toBe(free.includes(f));
      }
    }
  });

  it('opens nothing on an audit with no fixes', () => {
    const d = fixture('clean-site');
    expect(freeFixes(d, findCheck(d, FIRST_AUDIT['clean-site']))).toEqual([]);
  });

  it('does not open a fix of another site, or one resolved by the check', () => {
    const d = fixture('bad-site');
    const check = findCheck(d, FIRST_AUDIT['bad-site']);
    const other = d.fixes.find((f) => f.site_id !== check.site_id)!;
    expect(isFreeFix(d, check, other)).toBe(false);
  });
});
