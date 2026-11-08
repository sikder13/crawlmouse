import { describe, expect, it } from 'vitest';
import { normalizeEmail } from './normalize-email';

describe('normalizeEmail', () => {
  it.each([
    ['  Ada@Example.COM ', 'ada@example.com'],
    ['ada+news@example.com', 'ada@example.com'],
    ['a.d.a@example.com', 'a.d.a@example.com'],
    ['A.D.A+x@Gmail.com', 'ada@gmail.com'],
    ['a.da@googlemail.com', 'ada@gmail.com'],
    ['+only@example.com', '+only@example.com'],
  ])('%s → %s', (input, out) => {
    expect(normalizeEmail(input)).toBe(out);
  });

  it('refuses a string with no local part or no domain', () => {
    for (const v of ['@x.com', 'x@', 'nope']) expect(() => normalizeEmail(v)).toThrow(RangeError);
  });
});
