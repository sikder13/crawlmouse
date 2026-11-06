/**
 * Signals (max 10): SIGNAL_POINTS for each declaration that counts, when present. A declaration whose
 * presence could not be decided makes a range: its points counted and not.
 */
import type { DetectionState } from '@crawlmouse/types/v2';
import { ranged, scored, type Measure } from './numbers.js';
import { SIGNAL_POINTS } from './weights.js';

export type SignalStates = Readonly<Record<keyof typeof SIGNAL_POINTS, DetectionState>>;

export function signalsScore(states: SignalStates): Measure {
  let present = 0;
  let undecided = 0;
  for (const [signal, points] of Object.entries(SIGNAL_POINTS)) {
    const state = states[signal as keyof typeof SIGNAL_POINTS];
    if (state === 'detected') present += points;
    else if (state === 'indeterminate') undecided += points;
  }
  return undecided === 0 ? scored(present) : ranged(present, present + undecided);
}
