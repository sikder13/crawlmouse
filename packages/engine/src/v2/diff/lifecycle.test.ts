/**
 * One named test per cell of the CC-19 lifecycle mapping (docs/specs/v2/19-diff-lifecycle.md). The
 * expectations are written out here by hand, not read from the code's table, so a change to any cell
 * of that table turns its own test red.
 *
 * Each test runs one check (check 2) after a graded check 1 that measured the fix, so every
 * row-writing cell is entitled to its row; the rules that withhold rows are tested in diff.test.ts.
 */
import type { Change, DetectionState, FixEvent, FixStatus } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import {
  checkId,
  draft,
  fingerprint,
  fixId,
  fixWithHistory,
  side,
} from '../../../fixtures/v2/diff/builders.js';
import { diffCheck } from './diff.js';
import { LIFECYCLE } from './lifecycle.js';
import type { DetectorOutcome } from './types.js';

type ChangeKind = Change['kind'];
type Prior = FixStatus | 'none';
type Seen = DetectionState | 'absent';

/** What the check must leave behind. `status: null` means no fix exists afterwards. */
interface Expected {
  /** Whether the fix appears in the result (created or changed). */
  changed: boolean;
  status: FixStatus | null;
  appended: FixEvent['kind'][];
  row: ChangeKind | null;
}

const NOTHING: Expected = { changed: false, status: null, appended: [], row: null };
const untouched = (status: FixStatus): Expected => ({
  changed: false,
  status,
  appended: [],
  row: null,
});

const CELLS: [Seen, Prior, Expected][] = [
  ['indeterminate', 'none', NOTHING],
  [
    'indeterminate',
    'marked_done',
    { changed: true, status: 'unable_to_verify', appended: ['unable_to_verify'], row: null },
  ],
  ['indeterminate', 'open', untouched('open')],
  ['indeterminate', 'reopened', untouched('reopened')],
  ['indeterminate', 'verified_resolved', untouched('verified_resolved')],
  ['indeterminate', 'unable_to_verify', untouched('unable_to_verify')],
  ['detected', 'none', { changed: true, status: 'open', appended: [], row: 'opened' }],
  ['detected', 'open', { changed: true, status: 'open', appended: [], row: null }],
  ['detected', 'reopened', { changed: true, status: 'reopened', appended: [], row: null }],
  [
    'detected',
    'marked_done',
    { changed: true, status: 'reopened', appended: ['reopened'], row: 'opened' },
  ],
  [
    'detected',
    'unable_to_verify',
    { changed: true, status: 'reopened', appended: ['reopened'], row: 'opened' },
  ],
  [
    'detected',
    'verified_resolved',
    { changed: true, status: 'reopened', appended: ['reopened'], row: 'opened' },
  ],
  [
    'not_detected',
    'open',
    { changed: true, status: 'verified_resolved', appended: ['verified'], row: 'resolved' },
  ],
  [
    'not_detected',
    'reopened',
    { changed: true, status: 'verified_resolved', appended: ['verified'], row: 'resolved' },
  ],
  [
    'not_detected',
    'marked_done',
    { changed: true, status: 'verified_resolved', appended: ['verified'], row: 'resolved' },
  ],
  [
    'not_detected',
    'unable_to_verify',
    { changed: true, status: 'verified_resolved', appended: ['verified'], row: 'resolved' },
  ],
  ['not_detected', 'none', NOTHING],
  // Measured again and still gone: the measurement is recorded, nothing else.
  [
    'not_detected',
    'verified_resolved',
    { changed: true, status: 'verified_resolved', appended: [], row: null },
  ],
  ['absent', 'none', NOTHING],
  ['absent', 'open', untouched('open')],
  ['absent', 'marked_done', untouched('marked_done')],
  ['absent', 'verified_resolved', untouched('verified_resolved')],
  ['absent', 'unable_to_verify', untouched('unable_to_verify')],
  ['absent', 'reopened', untouched('reopened')],
];

/** The detector's measurement on check 2: a different rank and page count from the stored fix. */
const DETECTED = draft('orphan_pages', { rank: 4, affected_pages: 30 });

function run(seen: Seen, prior: Prior) {
  const existing = prior === 'none' ? null : fixWithHistory(1, prior);
  const outcomes: DetectorOutcome[] =
    seen === 'absent'
      ? []
      : seen === 'detected'
        ? [{ fingerprint: fingerprint(1), state: 'detected', fix: DETECTED }]
        : [{ fingerprint: fingerprint(1), state: seen }];
  const result = diffCheck({
    previous: side(1),
    current: side(2, undefined, {
      indeterminate: seen === 'indeterminate' ? [fingerprint(1)] : [],
    }),
    fixes: existing ? [existing.fix] : [],
    events: existing?.events ?? [],
    outcomes,
  });
  return { existing, result };
}

describe('the lifecycle, one test per cell', () => {
  for (const [seen, prior, expected] of CELLS) {
    it(`${seen} on a fix that is ${prior}`, () => {
      const { existing, result } = run(seen, prior);
      const fix = result.fixes.find((f) => f.fingerprint === fingerprint(1));
      expect(fix !== undefined, 'the fix is in the result').toBe(expected.changed);
      expect(fix?.status ?? existing?.fix.status ?? null).toBe(expected.status);
      expect(result.events.map((e) => e.kind)).toEqual(expected.appended);
      expect(result.changes.map((c) => c.kind)).toEqual(expected.row ? [expected.row] : []);
      if (expected.row) expect(result.changes[0]!.fix_id).toBe(fix!.id);
      // A fingerprint with no fix and no outcome is not visited at all, so the diff never reads
      // this cell; the table itself is what the test can hold to the mapping.
      if (seen === 'absent' && prior === 'none') expect(LIFECYCLE.absent.none).toBe('untouched');
    });
  }
});

describe('what each transition writes on the fix', () => {
  it('a new fix: open, first seen and last measured on this check, numbered after the rest', () => {
    const { fix: other, events } = fixWithHistory(7, 'open');
    const result = diffCheck({
      previous: side(1),
      current: side(2),
      fixes: [other],
      events,
      outcomes: [{ fingerprint: fingerprint(1), state: 'detected', fix: DETECTED }],
    });
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0]).toMatchObject({
      fingerprint: fingerprint(1),
      number: 8,
      status: 'open',
      last_state: 'detected',
      first_seen_check_id: checkId(2),
      last_measured_check_id: checkId(2),
      // The detector ranked it 4th; the site's other live fix (rank 1) stays ahead of it.
      rank: 2,
      affected_pages: 30,
    });
  });

  it('a refresh takes the measured fields from the detector and keeps the label', () => {
    const { existing, result } = run('detected', 'open');
    expect(result.fixes[0]).toEqual({
      ...existing!.fix,
      rank: 1, // the only live fix
      affected_pages: 30,
      last_measured_check_id: checkId(2),
    });
  });

  it('a reopen keeps the fix: same id, number and first check, with the new measurement', () => {
    const { existing, result } = run('detected', 'verified_resolved');
    expect(result.fixes[0]).toEqual({
      ...existing!.fix,
      status: 'reopened',
      last_state: 'detected',
      rank: 1, // the only live fix
      affected_pages: 30,
      last_measured_check_id: checkId(2),
    });
    expect(result.fixes[0]!.id).toBe(fixId(1));
    expect(result.events[0]).toMatchObject({ kind: 'reopened', check_id: checkId(2) });
  });

  it('a verification records not_detected on this check and drops the rank', () => {
    const { existing, result } = run('not_detected', 'reopened');
    expect(result.fixes[0]).toEqual({
      ...existing!.fix,
      status: 'verified_resolved',
      last_state: 'not_detected',
      rank: null,
      last_measured_check_id: checkId(2),
    });
    expect(result.events[0]).toMatchObject({ kind: 'verified', check_id: checkId(2) });
  });

  it('a resolved fix measured still gone records this check as its last measurement', () => {
    const { existing, result } = run('not_detected', 'verified_resolved');
    expect(result.fixes[0]).toEqual({ ...existing!.fix, last_measured_check_id: checkId(2) });
  });

  it('unable to verify records indeterminate on this check and leaves the rest', () => {
    const { existing, result } = run('indeterminate', 'marked_done');
    expect(result.fixes[0]).toEqual({
      ...existing!.fix,
      status: 'unable_to_verify',
      last_state: 'indeterminate',
      last_measured_check_id: checkId(2),
    });
  });
});

describe('the note that a fix was reported done', () => {
  it('names the day it was marked done when it is found again', () => {
    const { result } = run('detected', 'marked_done');
    expect(result.changes[0]!.cause?.text).toBe(
      'Marked done on 2026-10-03, and found again on this check.',
    );
  });

  it('names the day it was marked done when an unverifiable fix is found again', () => {
    const { result } = run('detected', 'unable_to_verify');
    expect(result.changes[0]!.cause?.text).toBe(
      'Marked done on 2026-10-03, and found again on this check.',
    );
  });

  it('names the crawler on the row of a fix about one crawler, and none on a fix about none', () => {
    const one = fixWithHistory(1, 'open', { type: 'robots_txt_blocks_crawler' });
    const result = diffCheck({
      previous: side(1),
      current: side(2),
      fixes: [one.fix],
      events: one.events,
      outcomes: [{ fingerprint: fingerprint(1), state: 'not_detected' }],
    });
    expect(result.changes.map((c) => c.ua)).toEqual(['GPTBot']);
    expect(run('detected', 'none').result.changes[0]!.ua).toBeNull();
  });

  it('says a resolved fix was resolved before when it is found again', () => {
    const { result } = run('detected', 'verified_resolved');
    expect(result.changes[0]!.cause?.text).toBe(
      'Resolved on 2026-10-03, and found again on this check.',
    );
  });

  it('carries no note on a fix found for the first time', () => {
    const { result } = run('detected', 'none');
    expect(result.changes[0]!.cause).toBeNull();
  });
});
