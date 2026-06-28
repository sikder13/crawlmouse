import { describe, it, expect } from 'vitest';
import { checklistRemaining, deltaArrow, deltaDirection, sparklinePoints } from './dashboard-logic';

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
});
