/**
 * The lifecycle over generated sequences of checks. One fingerprint is followed through a run of
 * checks; before each, the owner may mark it done, and the page cap may change. Each step's result
 * is fed into the next, as the pipeline will, and checked against the rules below, which are stated
 * here independently of the code's table.
 */
import {
  ChangeSchema,
  FixEventSchema,
  FixSchema,
  type DetectionState,
  type Fix,
  type FixEvent,
  type FixStatus,
  type FixType,
} from '@crawlmouse/types/v2';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { draft, fingerprint, finishedAt, side } from '../../../fixtures/v2/diff/builders.js';
import { diffCheck } from './diff.js';
import type { CheckSide, DetectorOutcome } from './types.js';

type Seen = DetectionState | 'absent';
interface Step {
  seen: Seen;
  /** The owner marks the fix done before this check, if it is open, reopened or unverifiable. */
  markDone: boolean;
  /** The mark is dated a minute after the check finished: made after it, before its diff ran. */
  markLate: boolean;
  /** This check runs under a different page cap from the one before. */
  capChanged: boolean;
}

/** A fix's status from its events, by the contract's rule: the last event decides; none is open. */
const CONSEQUENCE: Record<FixEvent['kind'], FixStatus> = {
  marked_done: 'marked_done',
  verified: 'verified_resolved',
  unable_to_verify: 'unable_to_verify',
  reopened: 'reopened',
};
const statusOf = (events: readonly FixEvent[]): FixStatus =>
  events.length ? CONSEQUENCE[events[events.length - 1]!.kind] : 'open';

const step = fc.record({
  seen: fc.constantFrom<Seen>('detected', 'not_detected', 'indeterminate', 'absent'),
  markDone: fc.boolean(),
  markLate: fc.boolean(),
  capChanged: fc.boolean(),
});

/** orphan_pages depends on the page cap; robots_txt_blocks_crawler does not. */
const TYPES: FixType[] = ['orphan_pages', 'robots_txt_blocks_crawler'];

interface Observed {
  step: Step;
  before: { fix: Fix | null; events: FixEvent[] };
  after: { fix: Fix | null; events: FixEvent[] };
  appended: FixEvent[];
  rows: { kind: string }[];
}

/** Runs the sequence and returns what each check saw and did. */
function simulate(type: FixType, steps: Step[]): Observed[] {
  let fix: Fix | null = null;
  let events: FixEvent[] = [];
  let previous: CheckSide | null = null;
  let cap = 500;
  const observed: Observed[] = [];
  steps.forEach((s, k) => {
    const n = k + 1;
    if (s.markDone && fix && ['open', 'reopened', 'unable_to_verify'].includes(fix.status)) {
      const at = new Date(Date.parse(finishedAt(n)) + (s.markLate ? 60_000 : -3_600_000))
        .toISOString()
        .replace('.000Z', 'Z');
      events = [
        ...events,
        {
          id: `d0000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
          fix_id: fix.id,
          at,
          kind: 'marked_done',
          by_seat_id: null,
        },
      ];
      fix = { ...fix, status: 'marked_done' };
    }
    // A first check has nothing to compare its cap with, so a change only counts from the second.
    const capChanged = s.capChanged && previous !== null;
    if (capChanged) cap = cap === 500 ? 100 : 500;
    const current: CheckSide = { ...side(n), page_cap: cap };
    const outcomes: DetectorOutcome[] =
      s.seen === 'absent'
        ? []
        : s.seen === 'detected'
          ? [
              {
                fingerprint: fingerprint(1),
                state: 'detected',
                fix: draft(type, { rank: 1 + (k % 3) }),
              },
            ]
          : [{ fingerprint: fingerprint(1), state: s.seen }];
    const before = { fix, events };
    const result = diffCheck({ previous, current, fixes: fix ? [fix] : [], events, outcomes });
    for (const f of result.fixes) FixSchema.parse(f);
    for (const e of result.events) FixEventSchema.parse(e);
    for (const c of result.changes) ChangeSchema.parse(c);
    fix = result.fixes[0] ?? fix;
    events = [...events, ...result.events];
    observed.push({
      step: { ...s, capChanged },
      before,
      after: { fix, events },
      appended: result.events,
      rows: result.changes,
    });
    previous = current;
  });
  return observed;
}

const runs = fc.tuple(fc.constantFrom(...TYPES), fc.array(step, { minLength: 1, maxLength: 14 }));
const property = (check: (o: Observed, type: FixType) => void) =>
  fc.assert(
    fc.property(runs, ([type, steps]) => {
      for (const o of simulate(type, steps)) check(o, type);
    }),
    { numRuns: 250 },
  );

describe('the lifecycle over generated sequences of checks (property)', () => {
  it('never closes a fix on an indeterminate or missing outcome', () => {
    property((o) => {
      if (o.step.seen !== 'not_detected') {
        expect(o.appended.map((e) => e.kind)).not.toContain('verified');
        expect(o.rows.map((r) => r.kind)).not.toContain('resolved');
      }
    });
  });

  it('reaches verified_resolved only on a not_detected outcome', () => {
    property((o) => {
      const was = o.before.fix?.status;
      if (o.after.fix?.status === 'verified_resolved' && was !== 'verified_resolved') {
        expect(o.step.seen).toBe('not_detected');
      }
    });
  });

  it('after a reopen, writes no further row on repeated detection until the fix resolves', () => {
    property((o) => {
      const was = o.before.fix?.status;
      if (o.step.seen === 'detected' && (was === 'reopened' || was === 'open')) {
        expect(o.rows).toEqual([]);
      }
    });
  });

  it('only ever appends events: none is removed or edited', () => {
    property((o) => {
      expect(o.after.events.slice(0, o.before.events.length)).toEqual(o.before.events);
      expect(o.after.events.slice(o.before.events.length)).toEqual(o.appended);
    });
  });

  it('keeps every status equal to the consequence of the last event', () => {
    property((o) => {
      if (o.after.fix) expect(o.after.fix.status).toBe(statusOf(o.after.events));
    });
  });

  it('never resolves a coverage-dependent fix on a check whose coverage changed', () => {
    property((o, type) => {
      if (type === 'orphan_pages' && o.step.capChanged) {
        expect(o.appended.map((e) => e.kind)).not.toContain('verified');
        expect(o.rows).toEqual([]);
      }
    });
  });
});
