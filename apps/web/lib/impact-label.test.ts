import { describe, it, expect } from 'vitest';
import { impactLabel } from './impact-label';
import { SUB_ONE_DELTAS } from './__fixtures__/spec041-fixtures';

// U8 — one honest impact representation across the result surface AND the /r/ report. The report
// already renders `.toFixed(1)` ("+1.3" / "+0.5"); the result surface used Math.round → "+0 pts" for
// sub-0.5 deltas. Both must read identically and NEVER show a nonzero delta as "+0".
describe('impactLabel', () => {
  it('renders one decimal place so a sub-1 delta never collapses to +0', () => {
    expect(impactLabel(0.4)).toBe('+0.4 pts');
    expect(impactLabel(0.5)).toBe('+0.5 pts');
  });

  it('keeps whole-number and fractional deltas honest', () => {
    expect(impactLabel(8)).toBe('+8.0 pts');
    expect(impactLabel(1.3)).toBe('+1.3 pts');
  });

  it('never renders a nonzero delta as "+0 pts"', () => {
    for (const d of SUB_ONE_DELTAS) expect(impactLabel(d)).not.toBe('+0 pts');
  });
});
