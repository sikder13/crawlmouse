/**
 * `rowOf(c, check, at, seen, previous, events)` (the merge of #195 and #207): each caller passes
 * where the reopened fix was first seen 4th, the check before 5th and the fix events 6th. Passing
 * `null` type-checks in either of the first two places, so this renders rows that need all three,
 * through both callers, the Changes log and the audit's Changes tab:
 * - a fix that came back, first seen at the first audit: "reopened" (the events) and "First seen at
 *   the Sat 24 Oct … check" (the first-seen note);
 * - a grade row with no cause, between checks that read 214 and 200 pages: the pages-read cause
 *   (the check before).
 */
import type { FixtureDataset } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { changesLogView } from './changes-log';
import { changesView } from './segment/changes';

const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const LATEST = 'c0000000-0000-4000-8000-000000000006';
const BEFORE = 'c0000000-0000-4000-8000-000000000005';
const FIRST = 'c0000000-0000-4000-8000-000000000001';
const GRADE_ROW = '90000000-0000-4000-8000-000000000003';

function vector(): { d: FixtureDataset; reopened: string } {
  const d = structuredClone(fixture('bad-site'));
  const row = d.changes.find(
    (c) => c.check_id === LATEST && c.kind === 'opened' && c.fix_id !== null,
  )!;
  d.fixes.find((f) => f.id === row.fix_id)!.first_seen_check_id = FIRST;
  d.fix_events.push({
    id: 'e0000000-0000-4000-8000-0000000000f9',
    fix_id: row.fix_id!,
    at: row.detected_at,
    kind: 'reopened',
    check_id: LATEST,
  } as FixtureDataset['fix_events'][number]);
  const grade = d.changes.find((c) => c.id === GRADE_ROW)!;
  grade.cause = null;
  d.checks.find((c) => c.id === LATEST)!.coverage!.pages_crawled = 214;
  d.checks.find((c) => c.id === BEFORE)!.coverage!.pages_crawled = 200;
  return { d, reopened: row.id };
}

const PAGES_READ =
  'First observed at this check, which read 214 pages; the check before read 200. The grade moved with the pages read, and we found no other cause.';

describe('rowOf’s three trailing arguments, from both callers', () => {
  it('the Changes log', () => {
    const { d, reopened } = vector();
    const rows = changesLogView(d, { accountId: ACCOUNT, now: d.as_of }, {}, '/changes').rows;
    const found = rows.find((r) => r.key === reopened)!;
    expect(found.pill.label).toBe('reopened');
    expect(found.cause).toMatch(/^First seen at the Sat 24 Oct /);
    expect(rows.find((r) => r.key === GRADE_ROW)!.cause).toBe(PAGES_READ);
  });

  it('the audit’s Changes tab', () => {
    const { d, reopened } = vector();
    const v = changesView(d, LATEST, {});
    if (v.state !== 'changes') throw new Error(`segment state ${v.state}`);
    const found = v.rows.find((r) => r.key === reopened)!;
    expect(found.pill.label).toBe('reopened');
    expect(found.cause).toMatch(/^First seen at the Sat 24 Oct /);
    expect(v.rows.find((r) => r.key === GRADE_ROW)!.cause).toBe(PAGES_READ);
  });
});
