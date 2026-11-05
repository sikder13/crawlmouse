import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_SHELL_BELOW,
  EMPTY_SHELL_LEAVES_ABOVE,
  jsTextState,
  READABLE_FROM,
  textShare,
} from './state.js';

describe('the thresholds', () => {
  it('are the rulings: empty shell below 0.30, left only above 0.45, readable from 0.80', () => {
    expect([EMPTY_SHELL_BELOW, EMPTY_SHELL_LEAVES_ABOVE, READABLE_FROM]).toEqual([0.3, 0.45, 0.8]);
  });
});

describe('text_share', () => {
  it('is static words over rendered words', () => {
    expect(textShare(50, 200)).toBe(0.25);
    expect(textShare(0, 120)).toBe(0);
    expect(textShare(120, 120)).toBe(1);
  });

  it('is clamped to 1 when the static side shows more words than the rendered side', () => {
    expect(textShare(130, 100)).toBe(1);
  });

  it('is null when the rendered side has no words: nothing to divide by, so nothing measured', () => {
    expect(textShare(0, 0)).toBeNull();
    expect(textShare(40, 0)).toBeNull();
  });
});

describe('the state without a previous check', () => {
  it.each([
    [0, 'empty_shell'],
    [0.2999, 'empty_shell'],
    [0.3, 'partial'],
    [0.45, 'partial'],
    [0.7999, 'partial'],
    [0.8, 'readable'],
    [1, 'readable'],
  ] as const)('is %s → %s', (share, state) => {
    expect(jsTextState(share, null)).toBe(state);
  });
});

describe('the state after an empty shell', () => {
  it.each([
    [0.1, 'empty_shell'],
    [0.3, 'empty_shell'],
    [0.45, 'empty_shell'],
    [0.4501, 'partial'],
    [0.8, 'readable'],
  ] as const)('is %s → %s: the shell is left only above 0.45', (share, state) => {
    expect(jsTextState(share, 'empty_shell')).toBe(state);
  });
});

describe('the state after partial or readable', () => {
  it.each([
    ['partial', 0.2999, 'empty_shell'],
    ['partial', 0.3, 'partial'],
    ['readable', 0.79, 'partial'],
    ['partial', 0.8, 'readable'],
  ] as const)('after %s, %s → %s: the readable line has no hysteresis', (prev, share, state) => {
    expect(jsTextState(share, prev)).toBe(state);
  });
});

describe('the state, over any share', () => {
  const share = fc.double({ min: 0, max: 1, noNaN: true });
  const previous = fc.constantFrom(null, 'readable', 'partial', 'empty_shell' as const);

  it('depends on the previous check only through whether it was an empty shell', () => {
    fc.assert(
      fc.property(share, (s) => {
        expect(jsTextState(s, 'readable')).toBe(jsTextState(s, null));
        expect(jsTextState(s, 'partial')).toBe(jsTextState(s, null));
      }),
    );
  });

  it('never moves to a worse state as the share rises', () => {
    const rank = { empty_shell: 0, partial: 1, readable: 2 } as const;
    fc.assert(
      fc.property(share, share, previous, (a, b, prev) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(rank[jsTextState(lo, prev)]).toBeLessThanOrEqual(rank[jsTextState(hi, prev)]);
      }),
    );
  });
});
