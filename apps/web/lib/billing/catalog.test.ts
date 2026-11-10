import { describe, expect, it } from 'vitest';
import { CATALOG, lookupKey, type Interval, type PriceKind } from './catalog';

describe('CATALOG', () => {
  it('holds the eight lookup keys of the Crawlmouse sandbox, at the amounts its prices carry', () => {
    // The sandbox's own unit_amount values, read from GET /v1/prices on 2026-11-08.
    expect(
      Object.fromEntries(Object.entries(CATALOG).map(([key, e]) => [key, e.unitAmount])),
    ).toEqual({
      crawlmouse_pro_monthly: 1900,
      crawlmouse_pro_yearly: 19000,
      crawlmouse_agency_monthly: 9900,
      crawlmouse_agency_yearly: 99000,
      crawlmouse_seat_monthly: 1200,
      crawlmouse_seat_yearly: 12000,
      crawlmouse_site_monthly: 300,
      crawlmouse_site_yearly: 3000,
    });
  });

  it('sells seats and sites on Agency only', () => {
    for (const e of Object.values(CATALOG)) {
      if (e.kind !== 'base') expect(e.plan).toBe('agency');
    }
  });
});

describe('lookupKey', () => {
  const intervals: Interval[] = ['month', 'year'];
  const kinds: PriceKind[] = ['base', 'seat', 'site'];

  it('names one key for every price Agency sells, and the two Pro bases', () => {
    const keys = intervals.flatMap((i) => [
      lookupKey('pro', i, 'base'),
      ...kinds.map((k) => lookupKey('agency', i, k)),
    ]);
    expect(new Set(keys)).toEqual(new Set(Object.keys(CATALOG)));
  });

  it.each(intervals.flatMap((i) => (['seat', 'site'] as const).map((k) => [i, k] as const)))(
    'refuses a Pro %s %s price',
    (interval, kind) => {
      expect(() => lookupKey('pro', interval, kind)).toThrow(RangeError);
    },
  );
});
