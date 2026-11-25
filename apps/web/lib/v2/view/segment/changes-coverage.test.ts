/**
 * D-08 (QA's production walk): a large site's grade moved twice between checks that read 350, 250
 * and 300 of its pages, and each row said "we found no cause". When the two checks read different
 * numbers of pages, the row says so.
 */
import { describe, expect, it } from 'vitest';
import { fixture } from '../../fixtures';
import { changesLogView } from '../changes-log';

const bad = fixture('bad-site');
const viewer = { accountId: 'a0000000-0000-4000-8000-000000000001', now: bad.as_of };
// A `changed` row with a grade delta and no cause, between two checks that each read 214 pages.
const CHANGE = bad.changes.find((c) => c.id.endsWith('0003'))!;

function causeWith(pagesNow: number) {
  const d = structuredClone(bad);
  d.checks.find((c) => c.id === CHANGE.check_id)!.coverage!.pages_crawled = pagesNow;
  const row = changesLogView(d, viewer, {}, '/changes').rows.find((r) => r.key === CHANGE.id)!;
  return row.cause;
}

describe('a grade change with no cause, between checks that read different numbers of pages (D-08)', () => {
  it('the fixture’s row has a grade delta, no cause, and two checks of 214 pages', () => {
    expect(CHANGE.grade_deltas.length).toBeGreaterThan(0);
    expect(CHANGE.cause).toBeNull();
    const pages = [CHANGE.previous_check_id, CHANGE.check_id].map(
      (id) => bad.checks.find((c) => c.id === id)!.coverage!.pages_crawled,
    );
    expect(pages).toEqual([214, 214]);
  });

  it('says how many pages each check read, in place of “we found no cause”', () => {
    expect(causeWith(250)).toBe(
      'First observed at this check, which read 250 pages; the check before read 214. The grade moved with the pages read, and we found no other cause.',
    );
  });

  it('keeps “we found no cause” when both checks read the same number of pages', () => {
    expect(causeWith(214)).toBe('First observed at this check; we found no cause.');
  });
});
