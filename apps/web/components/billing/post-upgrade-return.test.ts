import { describe, it, expect } from 'vitest';
import { safeReturnTo } from './post-upgrade-return';

describe('safeReturnTo (open-redirect guard)', () => {
  it('accepts an internal /audit/<id> path', () => {
    expect(safeReturnTo('/audit/abc-123')).toBe('/audit/abc-123');
    expect(safeReturnTo('/audit/9f1f79b0_AB')).toBe('/audit/9f1f79b0_AB');
  });

  it('rejects external, protocol-relative, and non-audit paths', () => {
    expect(safeReturnTo('https://evil.example')).toBeNull();
    expect(safeReturnTo('//evil.example')).toBeNull();
    expect(safeReturnTo('/dashboard')).toBeNull();
    expect(safeReturnTo('javascript:alert(1)')).toBeNull();
    expect(safeReturnTo('/audit/abc/../../evil')).toBeNull();
    expect(safeReturnTo(null)).toBeNull();
    expect(safeReturnTo('')).toBeNull();
  });
});
