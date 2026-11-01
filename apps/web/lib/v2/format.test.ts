import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES, fixture } from './fixtures';
import {
  TEMPLATE_NOUNS,
  clock,
  dateTimeUtc,
  dayTimeUtc,
  duration,
  listOf,
  templateNoun,
  weekdayTime,
} from './format';

describe('formatting', () => {
  it('prints timestamps as the locked screens do', () => {
    expect(dateTimeUtc('2026-10-25T02:34:00Z')).toBe('25 Oct 2026, 02:34 UTC');
    expect(dayTimeUtc('2026-10-26T02:34:00Z')).toBe('26 Oct, 02:34 UTC');
    expect(dayTimeUtc('2026-10-26T00:05:00Z')).toBe('26 Oct, 00:05 UTC');
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
