import { describe, expect, it } from 'vitest';
import { GATES } from '../entitlement-v2';
import { SCHEDULE_HOUR_LOCAL, scheduleFor } from './schedule';

// A Thursday in UTC (2026-11-05), which is already Friday in Auckland.
const AT = new Date('2026-11-05T13:30:00.000Z');

describe('scheduleFor', () => {
  it('a paid tier re-checks weekly on the attach weekday at 06:00 in the account zone', () => {
    expect(GATES.pro.schedule).toBe('weekly');
    expect(scheduleFor('pro', false, AT, 'UTC')).toEqual({
      cadence: 'weekly',
      iso_weekday: 4,
      hour_local: 6,
    });
    expect(scheduleFor('agency', true, AT, 'Pacific/Auckland')).toEqual({
      cadence: 'weekly',
      iso_weekday: 5,
      hour_local: SCHEDULE_HOUR_LOCAL,
    });
  });

  it('Free re-checks its first site monthly and no other', () => {
    expect(GATES.free.schedule).toBe('monthly_first_site_only');
    expect(scheduleFor('free', true, AT, 'America/Los_Angeles')).toEqual({
      cadence: 'monthly',
      iso_weekday: 4,
      hour_local: 6,
    });
    expect(scheduleFor('free', false, AT, 'UTC')).toBeNull();
  });

  it('an unknown zone is read as UTC, as the database does', () => {
    expect(scheduleFor('pro', true, AT, 'Mars/Olympus')).toEqual(
      scheduleFor('pro', true, AT, 'UTC'),
    );
  });

  it('Sunday is 7', () => {
    expect(scheduleFor('pro', true, new Date('2026-11-08T12:00:00Z'), 'UTC')?.iso_weekday).toBe(7);
  });
});
