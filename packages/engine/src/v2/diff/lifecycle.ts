/**
 * The fix lifecycle: what one check's outcome for a fingerprint does to the fix that carries it.
 *
 * The table is data, so the spec (docs/specs/v2/19-diff-lifecycle.md) is rendered from it, and the
 * code below only reads it. A fix's status is the consequence of its last event, none meaning
 * `open` (the contract, fix-event.ts).
 */
import type { DetectionState, FixEvent, FixStatus } from '@crawlmouse/types/v2';

/** The outcome on this check: a detection state, or no outcome at all (`absent`). */
export type Outcome = DetectionState | 'absent';
/** The fix before this check: its status, or `none` when the site has no fix with the fingerprint. */
export type Prior = FixStatus | 'none';

/**
 * What a cell does.
 * - `untouched`: no change: the fix is left exactly as it was, or, when there is none, none is made.
 * - `insert`: a new fix, `open`.
 * - `refresh`: the measured fields are taken from the detector; no event.
 * - `remeasure`: the check is recorded as the fix's last measurement; nothing else changes.
 * - `reopen`: a `reopened` event, and the measured fields refreshed.
 * - `verify`: a `verified` event; the fix is `verified_resolved`.
 * - `unable_to_verify`: an `unable_to_verify` event.
 */
export type Action =
  | 'untouched'
  | 'insert'
  | 'refresh'
  | 'remeasure'
  | 'reopen'
  | 'verify'
  | 'unable_to_verify';

export const OUTCOMES: readonly Outcome[] = ['indeterminate', 'detected', 'not_detected', 'absent'];
export const PRIORS: readonly Prior[] = [
  'none',
  'open',
  'marked_done',
  'verified_resolved',
  'unable_to_verify',
  'reopened',
];

export const LIFECYCLE: Readonly<Record<Outcome, Readonly<Record<Prior, Action>>>> = {
  indeterminate: {
    none: 'untouched',
    open: 'untouched',
    marked_done: 'unable_to_verify',
    verified_resolved: 'untouched',
    unable_to_verify: 'untouched',
    reopened: 'untouched',
  },
  detected: {
    none: 'insert',
    open: 'refresh',
    marked_done: 'reopen',
    verified_resolved: 'reopen',
    unable_to_verify: 'reopen',
    reopened: 'refresh',
  },
  not_detected: {
    none: 'untouched',
    open: 'verify',
    marked_done: 'verify',
    verified_resolved: 'remeasure',
    unable_to_verify: 'verify',
    reopened: 'verify',
  },
  absent: {
    none: 'untouched',
    open: 'untouched',
    marked_done: 'untouched',
    verified_resolved: 'untouched',
    unable_to_verify: 'untouched',
    reopened: 'untouched',
  },
};

/** The change row an action writes, when the rules in diff.ts allow one. A fix never writes `changed`. */
export const ROW_OF: Readonly<Record<Action, 'opened' | 'resolved' | null>> = {
  untouched: null,
  insert: 'opened',
  refresh: null,
  remeasure: null,
  reopen: 'opened',
  verify: 'resolved',
  unable_to_verify: null,
};

/** The event an action appends. */
export const EVENT_OF: Readonly<Record<Action, Exclude<FixEvent['kind'], 'marked_done'> | null>> = {
  untouched: null,
  insert: null,
  refresh: null,
  remeasure: null,
  reopen: 'reopened',
  verify: 'verified',
  unable_to_verify: 'unable_to_verify',
};

const CONSEQUENCE: Readonly<Record<FixEvent['kind'], FixStatus>> = {
  marked_done: 'marked_done',
  verified: 'verified_resolved',
  unable_to_verify: 'unable_to_verify',
  reopened: 'reopened',
};

/** The status a fix's events give it: the last one's consequence, `open` when there are none. */
export function statusOf(events: readonly FixEvent[]): FixStatus {
  const last = events[events.length - 1];
  return last ? CONSEQUENCE[last.kind] : 'open';
}
