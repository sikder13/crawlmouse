/**
 * F-296 (D-33 b): a change row for a fix that was done and is found again is labelled "found again",
 * not "opened". What marks it is the record's own: a `reopened` fix event for that fix at the check
 * that wrote the row. A fix opened for the first time keeps "opened".
 */
import type { Change, FixtureDataset } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { changesLogView } from './changes-log';

const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const BASE = '/changes';

/** The bad site with one of its `opened` change rows made a regression: a reopened event beside it. */
function regressed(): { d: FixtureDataset; row: Change; plain: Change } {
  const d = structuredClone(fixture('bad-site'));
  const opened = d.changes.filter(
    (c) => c.kind === 'opened' && c.fix_id !== null && c.previous_check_id !== null,
  );
  // Rows that already have a reopened event are regressions in the fixture itself.
  const isReopened = (c: Change) =>
    d.fix_events.some(
      (e) => e.kind === 'reopened' && e.fix_id === c.fix_id && e.check_id === c.check_id,
    );
  const plain = opened.find((c) => !isReopened(c))!;
  const row = opened.find((c) => c !== plain && !isReopened(c)) ?? plain;
  d.fix_events.push({
    id: 'e0000000-0000-4000-8000-0000000000f1',
    fix_id: row.fix_id!,
    at: row.detected_at,
    kind: 'reopened',
    check_id: row.check_id,
  } as FixtureDataset['fix_events'][number]);
  return { d, row, plain };
}

describe('a fix found again, on the Changes log', () => {
  it('reads "found again"; a fix opened for the first time still reads "opened"', () => {
    const { d, row, plain } = regressed();
    const v = changesLogView(d, { accountId: ACCOUNT, now: d.as_of }, {}, BASE);
    const pill = (c: Change) => v.rows.find((r) => r.key === c.id)?.pill.label;
    expect(pill(row)).toBe('found again');
    if (plain !== row) expect(pill(plain)).toBe('opened');
  });

  it('keys on the event at that row’s check, not on any reopened event of the fix', () => {
    const { d, row } = regressed();
    const event = d.fix_events.at(-1)! as { check_id: string };
    event.check_id = 'c0000000-0000-4000-8000-00000000dead';
    const v = changesLogView(d, { accountId: ACCOUNT, now: d.as_of }, {}, BASE);
    expect(v.rows.find((r) => r.key === row.id)?.pill.label).toBe('opened');
  });
});

describe('a fix found again, on the audit’s Changes segment', () => {
  it('reads "found again" there too', async () => {
    const { changesView } = await import('./segment/changes');
    const { d, row } = regressed();
    const v = changesView(d, row.check_id, {});
    if (v.state !== 'changes') throw new Error(`segment state ${v.state}`);
    expect(v.rows.find((r) => r.key === row.id)?.pill.label).toBe('found again');
  });
});

describe('a fix found again, on the dashboard (QA N2)', () => {
  it('its change row reads "found again"; no other row does', async () => {
    const { dashboardView } = await import('./dashboard');
    const { d, row } = regressed();
    // The dashboard lists a site's latest check's opened rows; this one is not a crawler block.
    const latestOpened = d.changes.filter(
      (c) => c.check_id === row.check_id && c.kind === 'opened' && c.subject !== 'crawler_access',
    );
    const target = latestOpened[0] ?? row;
    d.fix_events.at(-1)!.fix_id = target.fix_id!;
    (d.fix_events.at(-1)! as { check_id: string }).check_id = target.check_id;
    const v = dashboardView(d, { accountId: ACCOUNT, now: d.as_of });
    const shown = v.changed.find((r) => r.key === target.id);
    expect(shown, 'the dashboard lists the row').toBeDefined();
    expect(shown!.pill.label).toBe('found again');
    for (const r of v.changed.filter((x) => x.key !== target.id)) {
      expect(r.pill.label).not.toBe('found again');
    }
  });
});
