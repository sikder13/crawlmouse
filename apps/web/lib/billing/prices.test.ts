import { describe, expect, it } from 'vitest';
import * as prices from './prices';

describe('prices', () => {
  it('holds the list prices of the 2026-11-03 decision', () => {
    expect({
      PRO_MONTHLY: prices.PRO_MONTHLY,
      PRO_YEARLY: prices.PRO_YEARLY,
      AGENCY_MONTHLY: prices.AGENCY_MONTHLY,
      AGENCY_YEARLY: prices.AGENCY_YEARLY,
      EXTRA_SEAT: prices.EXTRA_SEAT,
      EXTRA_SITE: prices.EXTRA_SITE,
    }).toEqual({
      PRO_MONTHLY: 19,
      PRO_YEARLY: 190,
      AGENCY_MONTHLY: 99,
      AGENCY_YEARLY: 990,
      EXTRA_SEAT: 12,
      EXTRA_SITE: 3,
    });
  });

  it('usd formats whole dollars and refuses anything else', () => {
    expect(prices.usd(19)).toBe('$19');
    expect(prices.usd(0)).toBe('$0');
    for (const v of [1.5, -1, Number.NaN]) expect(() => prices.usd(v)).toThrow(RangeError);
  });
});
