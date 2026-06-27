import { describe, it, expect } from 'vitest';
import { BRAND } from '../../lib/brand';
import { contrastRatio, meetsAA } from './contrast';

// SPEC 03 §9 — verify the palette meets WCAG AA; adjust TOKENS (not ad-hoc) if any fail.
// This is the recorded contrast contract; docs/design-system.md mirrors the numbers.

describe('contrast helper', () => {
  it('matches known WCAG reference ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('is symmetric (order-independent)', () => {
    expect(contrastRatio(BRAND.ink, BRAND.cream)).toBeCloseTo(contrastRatio(BRAND.cream, BRAND.ink), 10);
  });
});

describe('design tokens meet WCAG AA (§9)', () => {
  it('primary + secondary text on cream pass AA-normal', () => {
    expect(meetsAA(BRAND.ink, BRAND.cream)).toBe(true);
    expect(meetsAA(BRAND.inkMuted, BRAND.cream)).toBe(true);
  });

  it('on-fill text rule: ink passes AA on every brand fill; white-on-peach does NOT', () => {
    expect(meetsAA(BRAND.ink, BRAND.peach)).toBe(true);
    expect(meetsAA(BRAND.ink, BRAND.sage)).toBe(true);
    expect(meetsAA(BRAND.ink, BRAND.warning)).toBe(true);
    expect(meetsAA(BRAND.ink, BRAND.oat)).toBe(true);
    // ~2.6:1 — white never sits on raw peach; solid orange uses the darkened accent-fill below.
    expect(meetsAA(BRAND.white, BRAND.peach)).toBe(false);
    expect(meetsAA(BRAND.white, BRAND.peach, true)).toBe(false);
  });

  it('every solid fill carries WHITE text at AA (accent/sage/warning darkened fills)', () => {
    for (const fill of [BRAND.accentFill, BRAND.sageFill, BRAND.warningFill]) {
      expect(meetsAA(BRAND.white, fill), fill).toBe(true); // >= 4.5
      expect(contrastRatio(BRAND.white, fill)).toBeGreaterThan(4.5);
    }
  });

  it('accent-text (peachText) on cream is AA-large only — large/emphasis, never body', () => {
    expect(meetsAA(BRAND.peachText, BRAND.cream)).toBe(false); // < 4.5 (normal text)
    expect(meetsAA(BRAND.peachText, BRAND.cream, true)).toBe(true); // >= 3.0 (large text / UI)
  });
});
