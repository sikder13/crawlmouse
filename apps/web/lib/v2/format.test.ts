import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES, fixture } from './fixtures';
import {
  TEMPLATE_NOUNS,
  calendarDays,
  clock,
  dateTimeUtc,
  dayDate,
  dayMonth,
  dayOfMonth,
  hourMinute,
  nextWeekly,
  sameDay,
  weekday,
  weekdayLong,
  zoneName,
  dayTimeUtc,
  duration,
  listOf,
  templateNoun,
  testedAt,
  timeOfDay,
  weekdayTime,
} from './format';

describe('formatting', () => {
  it('prints timestamps as the locked screens do', () => {
    expect(dateTimeUtc('2026-10-25T02:34:00Z')).toBe('25 Oct 2026, 02:34 UTC');
    expect(dayTimeUtc('2026-10-26T02:34:00Z')).toBe('26 Oct, 02:34 UTC');
    expect(dayTimeUtc('2026-10-26T00:05:00Z')).toBe('26 Oct, 00:05 UTC');
    expect(testedAt('2026-10-25T02:33:00Z')).toBe('25 Oct 2026 at 02:33 UTC');
    expect(timeOfDay('2026-10-25T02:33:07Z')).toBe('02:33:07 UTC');
    expect(timeOfDay('2026-10-25T00:00:09Z')).toBe('00:00:09 UTC');
  });

  it('prints a moment on the account’s own clock', () => {
    expect(weekdayTime('2026-10-30T10:02:00Z', 'America/Indiana/Indianapolis')).toBe('Fri 06:02');
    expect(weekdayTime('2026-10-29T23:40:00Z', 'America/Indiana/Indianapolis')).toBe('Thu 19:40');
  });

  it('prints durations and the elapsed clock', () => {
    expect(duration(131_000)).toBe('2 min 11 s');
    expect(duration(54_000)).toBe('54 s');
    expect(clock(47_000)).toBe('0:47');
    expect(clock(131_999)).toBe('2:11');
  });

  it('joins lists with commas and a final “and”', () => {
    expect(listOf([])).toBe('');
    expect(listOf(['a'])).toBe('a');
    expect(listOf(['a', 'b'])).toBe('a and b');
    expect(listOf(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('has a noun for every template in every fixture, and refuses one it does not know', () => {
    for (const name of FIXTURE_NAMES) {
      for (const c of fixture(name).checks) {
        for (const t of c.coverage?.templates ?? []) {
          expect(Object.hasOwn(TEMPLATE_NOUNS, t.label), `${name}: ${t.label}`).toBe(true);
        }
      }
    }
    expect(() => templateNoun('toString')).toThrow(/No noun/);
  });
});

/**
 * The account's clock. Every vector is worked by hand from the zone's rules, not from Intl: Indiana
 * (America/Indiana/Indianapolis) is UTC−4 until 2026-11-01 06:00Z and UTC−5 after it.
 */
describe('the account zone', () => {
  const IND = 'America/Indiana/Indianapolis';

  it('names a day, a date and a time as the account reads them', () => {
    // 02:41Z on the 25th is 22:41 on Saturday the 24th in Indiana.
    expect(dayDate('2026-10-25T02:41:00Z', IND)).toBe('Sat 24 Oct');
    expect(dayMonth('2026-10-25T02:34:00Z', IND)).toBe('24 Oct');
    expect(dayOfMonth('2026-10-25T02:34:00Z', IND)).toBe('24');
    expect(dayDate('2026-10-25T02:41:00Z', 'UTC')).toBe('Sun 25 Oct');
    expect(hourMinute('2026-10-30T10:02:00Z', IND)).toBe('06:02');
    expect(hourMinute('2026-11-08T02:41:00Z', IND)).toBe('21:41');
    expect(weekday('2026-10-29T23:40:00Z', IND)).toBe('Thu');
    expect(weekdayLong('2026-10-29T12:42:15Z', IND)).toBe('Thursday');
  });

  it('counts calendar days in the zone, not 24-hour spans', () => {
    // Fri 30 Oct 06:05 to Sat 7 Nov 21:41: eight dates apart, though 8 days 16 hours.
    expect(calendarDays('2026-10-30T10:05:00Z', '2026-11-08T02:41:00Z', IND)).toBe(8);
    // In UTC the same two instants are Fri 30 Oct and Sun 8 Nov: nine.
    expect(calendarDays('2026-10-30T10:05:00Z', '2026-11-08T02:41:00Z', 'UTC')).toBe(9);
    expect(calendarDays('2026-10-25T02:41:00Z', '2026-11-08T02:41:00Z', IND)).toBe(14);
    // 23:59 and 00:01 local are one date apart, two minutes in time.
    expect(calendarDays('2026-10-28T03:59:00Z', '2026-10-28T04:01:00Z', IND)).toBe(1);
    expect(calendarDays('2026-10-28T04:01:00Z', '2026-10-28T03:59:00Z', IND)).toBe(-1);
  });

  it('says whether two instants fall on the same date in the zone', () => {
    expect(sameDay('2026-10-30T10:02:00Z', '2026-10-30T10:05:00Z', IND)).toBe(true);
    expect(sameDay('2026-10-28T03:59:00Z', '2026-10-28T04:01:00Z', IND)).toBe(false);
  });

  it('finds the next weekly check at its local hour, across the change of offset', () => {
    const fri6 = { iso_weekday: 5, hour_local: 6 };
    // Saturday night → the coming Friday, 06:00 EDT = 10:00Z.
    expect(nextWeekly(fri6, '2026-10-25T02:41:00Z', IND)).toBe('2026-10-30T10:00:00.000Z');
    // Friday 05:00 local, before the hour → that same morning.
    expect(nextWeekly(fri6, '2026-10-30T09:00:00Z', IND)).toBe('2026-10-30T10:00:00.000Z');
    // Exactly at the hour, and after it → a week later, now 06:00 EST = 11:00Z.
    expect(nextWeekly(fri6, '2026-10-30T10:00:00Z', IND)).toBe('2026-11-06T11:00:00.000Z');
    expect(nextWeekly(fri6, '2026-10-30T10:05:00Z', IND)).toBe('2026-11-06T11:00:00.000Z');
    // Sunday (7) at 23:00 UTC.
    expect(nextWeekly({ iso_weekday: 7, hour_local: 23 }, '2026-10-30T10:05:00Z', 'UTC')).toBe(
      '2026-11-01T23:00:00.000Z',
    );
  });

  it('names the zone for a reader', () => {
    expect(zoneName(IND)).toBe('Indianapolis time');
    expect(zoneName('America/New_York')).toBe('New York time');
    expect(zoneName('UTC')).toBe('UTC');
  });
});
