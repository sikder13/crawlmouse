import { describe, expect, it } from 'vitest';
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { findCheck, fixesAsOf, fixture } from './fixtures';

/** A bad-site check by the last three characters of its id. */
const CHECK = (n: string) => `c0000000-0000-4000-8000-000000000${n}`;
const numbers = (d: FixtureDataset, id: string) =>
  fixesAsOf(d, findCheck(d, CHECK(id))).map((f) => `${f.site_id.slice(-3)}#${f.number}`);

describe('fixesAsOf', () => {
  it('leaves out a fix verified resolved at or before the check, and keeps it before then', () => {
    // nahltech.com's fix 1 is verified at check 00c's finish, and by no earlier check.
    const d = fixture('bad-site');
    const fix = d.fixes.find((f) => f.status === 'verified_resolved')!;
    const tag = `${fix.site_id.slice(-3)}#${fix.number}`;
    const verified = d.fix_events.find((e) => e.fix_id === fix.id && e.kind === 'verified')!;
    expect(verified.at).toBe(findCheck(d, CHECK('00c')).finished_at);
    expect(numbers(d, '00b')).toContain(tag);
    expect(numbers(d, '00c')).not.toContain(tag);
  });

  it('reads the last verification or reopening at or before the check, not any verification', () => {
    // Fix 2 is reopened by check 004. Add a verification by check 003, before it.
    const d = structuredClone(fixture('bad-site'));
    const fix = d.fixes.find((f) => f.number === 2 && f.status === 'reopened')!;
    const tag = `${fix.site_id.slice(-3)}#2`;
    const c3 = findCheck(d, CHECK('003'));
    d.fix_events.unshift({
      id: 'e0000000-0000-4000-8000-0000000000fe',
      fix_id: fix.id,
      at: c3.finished_at!,
      kind: 'verified',
      check_id: c3.id,
    });
    expect(numbers(d, '002')).toContain(tag);
    expect(numbers(d, '003')).not.toContain(tag);
    // Reopened at 004's finish: open again as of 004 and every check after.
    expect(numbers(d, '004')).toContain(tag);
    expect(numbers(d, '005')).toContain(tag);
  });

  it('refuses a check that has not finished, which has no moment to resolve fixes by', () => {
    const d = fixture('bad-site');
    expect(() => fixesAsOf(d, findCheck(d, CHECK('021')))).toThrow(/has not finished/);
  });
});
