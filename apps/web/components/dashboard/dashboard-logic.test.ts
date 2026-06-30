import { describe, it, expect } from 'vitest';
import {
  checklistRemaining,
  deltaArrow,
  deltaDirection,
  deltaSentence,
  historySpanLabel,
  reauditTargetId,
  sparklinePoints,
} from './dashboard-logic';

describe('dashboard-logic', () => {
  it('deltaDirection: positive up, negative down, zero flat', () => {
    expect(deltaDirection(6)).toBe('up');
    expect(deltaDirection(-4)).toBe('down');
    expect(deltaDirection(0)).toBe('flat');
  });

  it('deltaArrow maps direction to a glyph', () => {
    expect(deltaArrow('up')).toBe('▲');
    expect(deltaArrow('down')).toBe('▼');
    expect(deltaArrow('flat')).toBe('■');
  });

  it('sparklinePoints: empty → "", single → one point, multi → inverted-y points', () => {
    expect(sparklinePoints([], 100, 20)).toBe('');
    expect(sparklinePoints([100], 100, 20)).toBe('0,0.0'); // score 100 → top (y=0)
    const pts = sparklinePoints([0, 50, 100], 100, 20);
    expect(pts).toBe('0.0,20.0 50.0,10.0 100.0,0.0'); // 0→bottom, 50→middle, 100→top
  });

  it('checklistRemaining = total − done, never negative', () => {
    expect(checklistRemaining(3, 7)).toBe(4);
    expect(checklistRemaining(7, 7)).toBe(0);
    expect(checklistRemaining(9, 7)).toBe(0);
  });

  it('historySpanLabel: null under 2 points; days, then months', () => {
    expect(historySpanLabel([{ ranAt: '2026-06-01T00:00:00.000Z' }])).toBeNull();
    expect(
      historySpanLabel([{ ranAt: '2026-06-01T00:00:00.000Z' }, { ranAt: '2026-06-26T00:00:00.000Z' }]),
    ).toBe('over 25 days');
    expect(
      historySpanLabel([{ ranAt: '2026-01-01T00:00:00.000Z' }, { ranAt: '2026-04-01T00:00:00.000Z' }]),
    ).toBe('over 3 months');
  });

  it('deltaSentence: warm + feeling-known, direction-aware; rounds floats; sub-0.5 → steady', () => {
    expect(deltaSentence(12)).toContain('Your fixes are working');
    expect(deltaSentence(12)).toContain('up 12 points');
    expect(deltaSentence(-8)).toContain('worth a look');
    expect(deltaSentence(null)).toContain('Holding steady');
    // 2-decimal engine floats are rounded for display (regression-lock for the round-2 fix):
    expect(deltaSentence(12.43)).toContain('up 12 points');
    expect(deltaSentence(12.43)).not.toContain('12.43');
    expect(deltaSentence(1.4)).toContain('up 1 point'); // singular boundary
    expect(deltaSentence(-8.34)).toContain('Down 8 points');
    // sub-0.5 movement reads "Holding steady", never "up 0 points":
    expect(deltaSentence(0.3)).toContain('Holding steady');
    expect(deltaSentence(0.3)).not.toContain('up 0');
  });

  it('reauditTargetId reads ReauditResponse.newAuditId (v1.2), else null', () => {
    expect(reauditTargetId({ newAuditId: 'new-123' })).toBe('new-123');
    expect(reauditTargetId({})).toBeNull();
  });
});
