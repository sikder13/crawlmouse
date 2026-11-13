import { describe, expect, it } from 'vitest';
import { digestDue } from './digest-clock';

/**
 * The founder digest's clock (D3, plan-review m19): America/New_York's wall clock from the injected
 * instant. The expected instants below are written out from New York's offsets (EDT −4, EST −5), not
 * computed by the code under test.
 */
const HOUR = 3_600_000;
const span = (w: { from: string; to: string }) => (Date.parse(w.to) - Date.parse(w.from)) / HOUR;

describe('digestDue', () => {
  it('on the day DST ends (2026-11-01, 25 hours), the next morning sends that day from NY midnight to NY midnight', () => {
    // 2026-11-02 08:07 EST, a Monday.
    const due = digestDue(new Date('2026-11-02T13:07:00.000Z'));
    expect(due.daily).toEqual({
      key: 'founder_digest:daily:2026-11-01',
      date: '2026-11-01',
      from: '2026-11-01T04:00:00.000Z',
      to: '2026-11-02T05:00:00.000Z',
    });
    expect(span(due.daily!)).toBe(25);
  });

  it('on the day DST starts (2027-03-14, 23 hours), the next morning sends that day', () => {
    // 2027-03-15 08:07 EDT, a Monday.
    const due = digestDue(new Date('2027-03-15T12:07:00.000Z'));
    expect(due.daily).toEqual({
      key: 'founder_digest:daily:2027-03-14',
      date: '2027-03-14',
      from: '2027-03-14T05:00:00.000Z',
      to: '2027-03-15T04:00:00.000Z',
    });
    expect(span(due.daily!)).toBe(23);
  });

  it('on a Monday also sends the week before, Monday to Sunday, and the week before that to compare', () => {
    const due = digestDue(new Date('2026-11-02T13:07:00.000Z'));
    expect(due.weekly).toEqual({
      key: 'founder_digest:weekly:2026-10-26',
      monday: '2026-10-26',
      week: { from: '2026-10-26T04:00:00.000Z', to: '2026-11-02T05:00:00.000Z' },
      previous: { from: '2026-10-19T04:00:00.000Z', to: '2026-10-26T04:00:00.000Z' },
    });
  });

  it('sends nothing before 08:00 New York, and the same keys at any later hour of the day', () => {
    // 07:59 EST on 2026-11-02 is 12:59 UTC: past 08:00 in UTC, before it in New York.
    const early = digestDue(new Date('2026-11-02T12:59:59.999Z'));
    expect(early.daily).toBeNull();
    expect(early.weekly).toBeNull();
    // 23:07 EST the same Monday: a tick that missed the morning catches up under the same keys.
    const late = digestDue(new Date('2026-11-03T04:07:00.000Z'));
    expect(late.daily!.key).toBe('founder_digest:daily:2026-11-01');
    expect(late.weekly!.key).toBe('founder_digest:weekly:2026-10-26');
  });

  it('sends no weekly on another day', () => {
    // 2026-11-03 08:07 EST, a Tuesday.
    const due = digestDue(new Date('2026-11-03T13:07:00.000Z'));
    expect(due.daily!.key).toBe('founder_digest:daily:2026-11-02');
    expect(due.weekly).toBeNull();
  });

  it('names each tick’s overflow notice by its UTC hour', () => {
    expect(digestDue(new Date('2026-11-02T13:07:00.000Z')).overflowKey).toBe(
      'overflow:2026-11-02T13',
    );
    expect(digestDue(new Date('2026-11-02T03:59:59.999Z')).overflowKey).toBe(
      'overflow:2026-11-02T03',
    );
  });

  it('crosses a month and a year from New York’s date, not UTC’s', () => {
    // 2027-01-01 08:30 EST: yesterday is 2026-12-31 in New York.
    const due = digestDue(new Date('2027-01-01T13:30:00.000Z'));
    expect(due.daily).toEqual({
      key: 'founder_digest:daily:2026-12-31',
      date: '2026-12-31',
      from: '2026-12-31T05:00:00.000Z',
      to: '2027-01-01T05:00:00.000Z',
    });
  });
});
