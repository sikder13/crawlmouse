import { describe, expect, it } from 'vitest';
import { openingScroll } from './SegmentTabs';

/**
 * The tab strip's opening position. A strip already scrolled when the page hydrates keeps its
 * position: on a slow page the visual harness scrolls every strip to its end before the effect runs,
 * and a centring that overwrote it left the last tab out of view for axe (a11y.spec.ts, "axe at
 * 390px dark › Link map, 2,000 pages").
 */
describe('openingScroll', () => {
  const at = (scrollLeft: number) => ({
    scrollLeft,
    scrollWidth: 900,
    clientWidth: 360,
    tabLeft: 500,
    tabWidth: 120,
  });

  it('centres the current tab in a strip that does not fit and has not been scrolled', () => {
    // 500 - (360 - 120) / 2 = 380, worked by hand.
    expect(openingScroll(at(0))).toBe(380);
  });

  it('leaves a strip that something has already scrolled where it is', () => {
    expect(openingScroll(at(540))).toBeNull();
    expect(openingScroll(at(1))).toBeNull();
  });

  it('leaves a strip that fits', () => {
    expect(openingScroll({ ...at(0), scrollWidth: 360 })).toBeNull();
  });
});
