import { describe, it, expect } from 'vitest';
import { isUuid } from './uuid';

describe('isUuid', () => {
  it('accepts a canonical uuid (any case)', () => {
    expect(isUuid('3f8b1c2d-4e5f-6a7b-8c9d-0e1f2a3b4c5d')).toBe(true);
    expect(isUuid('3F8B1C2D-4E5F-6A7B-8C9D-0E1F2A3B4C5D')).toBe(true);
  });

  it('rejects the wrong shape', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('3f8b1c2d4e5f6a7b8c9d0e1f2a3b4c5d')).toBe(false); // no dashes
    expect(isUuid('3f8b1c2d-4e5f-6a7b-8c9d-0e1f2a3b4c5')).toBe(false); // too short
    expect(isUuid('')).toBe(false);
  });

  it('rejects injection-y input that merely contains a uuid', () => {
    expect(isUuid("3f8b1c2d-4e5f-6a7b-8c9d-0e1f2a3b4c5d' or 1=1")).toBe(false);
  });
});
