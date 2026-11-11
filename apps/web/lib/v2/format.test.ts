import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES, fixture, type FixtureName } from './fixtures';
import {
  TEMPLATE_NOUNS,
  calendarDays,
  clock,
  dateTimeUtc,
  dayDate,
  daysBefore,
  dayMonth,
  dayOfMonth,
  hourMinute,
  nextWeekly,
  sameDay,
  weekday,
  weekdayLong,
  dayTimeUtc,
  duration,
  listOf,
  templateNoun,
  testedAt,
  timeOfDay,
  weekdayTime,
} from './format';

/**
 * Fixtures whose template labels have no noun yet, and why; null for one whose labels all have one.
 * Listed in CC-20a's PR under "Found by the built fixture", for CC-20b.
 */
const NOUNLESS: Record<FixtureName, string | null> = {
  'bad-site': null,
  'clean-site': null,
  'challenged-site': null,
  'built-site':
    'no template labeller exists: the check builder labels a template by its key, and TEMPLATE_NOUNS is keyed by labels',
};

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

  it('has a listed noun for every template in every contract fixture', () => {
    for (const name of FIXTURE_NAMES) {
      const labels = fixture(name).checks.flatMap((c) =>
        (c.coverage?.templates ?? []).map((t) => t.label),
      );
      const missing = labels.filter((l) => !Object.hasOwn(TEMPLATE_NOUNS, l));
      // A fixture listed with a reason still lacks a noun; when it gains them all, the entry goes.
      if (NOUNLESS[name] === null) expect(missing, name).toEqual([]);
      else expect(missing.length, `${name}: ${NOUNLESS[name]}`).toBeGreaterThan(0);
    }
  });

  it('names a template whose label is its key, as a measured check labels it, from the key', () => {
    expect(templateNoun('/')).toEqual(TEMPLATE_NOUNS.Homepage);
    expect(templateNoun('/blog/{slug}')).toEqual(TEMPLATE_NOUNS.Blog);
    expect(templateNoun('/products/{slug}/reviews')).toEqual(TEMPLATE_NOUNS.Products);
    expect(templateNoun('/about')).toEqual({
      inList: '/about',
      adjective: '/about',
      pages: 'the /about page',
    });
    // A section's own index page is one page, not the section.
    expect(templateNoun('/blog').pages).toBe('the /blog page');
    expect(templateNoun('/docs/guide/{slug}')).toEqual({
      inList: '/docs/guide/{slug}',
      adjective: '/docs/guide/{slug}',
      pages: 'pages under /docs/',
    });
    expect(templateNoun('/{slug}').pages).toBe('pages like /{slug}');
  });

  it('uses a label that is neither listed nor a path as it is written, an inherited name included', () => {
    expect(templateNoun('Recipes')).toEqual({
      inList: 'Recipes',
      adjective: 'Recipes',
      pages: 'Recipes pages',
    });
    expect(templateNoun('toString')).toEqual({
      inList: 'toString',
      adjective: 'toString',
      pages: 'toString pages',
    });
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

  it('counts days before an instant on the zone’s calendar, keeping its clock time', () => {
    // Tue 3 Nov 23:30 EST is 04:30Z on the 4th; three calendar days before is Sat 31 Oct 23:30 EDT,
    // which is 03:30Z on 1 Nov. 72 hours before would be Sun 1 Nov 00:30 EDT.
    expect(daysBefore('2026-11-04T04:30:00Z', 3, IND)).toBe('2026-11-01T03:30:00.000Z');
    expect(dayDate(daysBefore('2026-11-04T04:30:00Z', 3, IND), IND)).toBe('Sat 31 Oct');
    // Sat 7 Nov 21:41 EST, three days before: Wed 4 Nov 21:41 EST, no change of offset between.
    expect(daysBefore('2026-11-08T02:41:00Z', 3, IND)).toBe('2026-11-05T02:41:00.000Z');
  });
});
