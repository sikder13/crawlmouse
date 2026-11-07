import { describe, expect, it } from 'vitest';
import { FIXTURE_NAMES, fixture, type FixtureName } from './fixtures';
import {
  TEMPLATE_NOUNS,
  clock,
  dateTimeUtc,
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

  it('has a noun for every template in every fixture, and refuses one it does not know', () => {
    for (const name of FIXTURE_NAMES) {
      const labels = fixture(name).checks.flatMap((c) =>
        (c.coverage?.templates ?? []).map((t) => t.label),
      );
      const missing = labels.filter((l) => !Object.hasOwn(TEMPLATE_NOUNS, l));
      // A fixture listed with a reason still lacks a noun; when it gains them all, the entry goes.
      if (NOUNLESS[name] === null) expect(missing, name).toEqual([]);
      else expect(missing.length, `${name}: ${NOUNLESS[name]}`).toBeGreaterThan(0);
    }
    expect(() => templateNoun('toString')).toThrow(/No noun/);
  });
});
