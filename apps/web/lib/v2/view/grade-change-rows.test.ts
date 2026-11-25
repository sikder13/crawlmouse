/**
 * F-302 (D-39).
 * (a) A grade row whose letters did not move ("Technical SEO A → A") is not listed as a change, on
 *     the Changes log or the audit's Changes segment. A row where a letter moved stays.
 * (b) The site page's "since <day>" names the date when a weekday could be read as another day:
 *     the earlier check a week or more back. On Thu 5 Nov, "since Thu" would read as today; the
 *     card says "since Thu 29 Oct".
 */
import type { Change } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { changesLogView } from './changes-log';
import { changesView } from './segment/changes';
import { siteView } from './site';

const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const OUTFITTER = '50000000-0000-4000-8000-000000000001';
const LETTER_MOVED = '90000000-0000-4000-8000-000000000003';
const SAME_LETTER = '90000000-0000-4000-8000-0000000000f2';

function withSameLetterRow() {
  const d = structuredClone(fixture('bad-site'));
  const moved = d.changes.find((c) => c.id === LETTER_MOVED)!;
  const same: Change = {
    ...moved,
    id: SAME_LETTER,
    summary: 'Technical SEO A → A (90 → 91)',
    grade_deltas: [
      { grade: 'technical_seo', from_score: 90, to_score: 91, from_grade: 'A', to_grade: 'A' },
    ],
  };
  d.changes.push(same);
  return { d, check: moved.check_id };
}

describe('a grade row whose letters did not move', () => {
  it('is not on the Changes log; the D → F row is', () => {
    const { d } = withSameLetterRow();
    const keys = changesLogView(d, { accountId: ACCOUNT, now: d.as_of }, {}, '/changes').rows.map(
      (r) => r.key,
    );
    expect(keys).toContain(LETTER_MOVED);
    expect(keys).not.toContain(SAME_LETTER);
  });

  it('is not on the audit’s Changes segment; the D → F row is', () => {
    const { d, check } = withSameLetterRow();
    const v = changesView(d, check, {});
    if (v.state !== 'changes') throw new Error(`segment state ${v.state}`);
    const keys = v.rows.map((r) => r.key);
    expect(keys).toContain(LETTER_MOVED);
    expect(keys).not.toContain(SAME_LETTER);
  });
});

describe('the site page’s grade cards, a week after the earlier check', () => {
  const bad = fixture('bad-site');
  const card = (now: string) =>
    siteView(bad, { accountId: ACCOUNT, now }, OUTFITTER).grades.cards[0]!.move;

  it('on Thu 5 Nov, names the date of Thu 29 Oct’s check', () => {
    expect(card('2026-11-05T16:00:00Z')).toBe('−1 since Thu 29 Oct');
  });

  it('at the fixture’s own time, the day after it, names the weekday alone', () => {
    expect(card(bad.as_of)).toBe('−1 since Thu');
  });
});

describe('a re-check whose only change is a letter-held grade row (review #1)', () => {
  /** The bad site's latest check with its own rows replaced by "Technical SEO A → A (90 → 91)". */
  function onlyHeld(withRow: boolean) {
    const d = structuredClone(fixture('bad-site'));
    const moved = d.changes.find((c) => c.id === LETTER_MOVED)!;
    const check = moved.check_id;
    d.changes = d.changes.filter((c) => c.check_id !== check);
    if (withRow) {
      d.changes.push({
        ...moved,
        id: SAME_LETTER,
        summary: 'Technical SEO A → A (90 → 91)',
        grade_deltas: [
          { grade: 'technical_seo', from_score: 90, to_score: 91, from_grade: 'A', to_grade: 'A' },
        ],
      });
    }
    return { d, check };
  }

  it('is counted nowhere it is not listed: dashboard strip, overview door, the tab and the log', async () => {
    const { dashboardView } = await import('./dashboard');
    const { resultView } = await import('./result');
    const viewer = { accountId: ACCOUNT, now: fixture('bad-site').as_of };
    const read = (withRow: boolean) => {
      const { d, check } = onlyHeld(withRow);
      const tab = changesView(d, check, {});
      if (tab.state !== 'changes') throw new Error(`segment state ${tab.state}`);
      const door = resultView(d, check, { map: null }).doors.find(
        (x) => x.title === 'What changed since last time',
      )!;
      const log = changesLogView(d, viewer, {}, '/changes').rows.filter(
        (r) => r.key === SAME_LETTER,
      );
      const dash = dashboardView(d, viewer);
      return {
        tab: tab.rows.length,
        door: door.pill.label,
        log: log.length,
        other: dash.strip!.other.count,
      };
    };
    const without = read(false);
    // Beside the check's other rows, the dashboard's change rows do not name it either.
    const { dashboardView: dash } = await import('./dashboard');
    const kept = structuredClone(fixture('bad-site'));
    const moved = kept.changes.find((c) => c.id === LETTER_MOVED)!;
    kept.changes.push({
      ...moved,
      id: SAME_LETTER,
      summary: 'Technical SEO A → A (90 → 91)',
      grade_deltas: [
        { grade: 'technical_seo', from_score: 90, to_score: 91, from_grade: 'A', to_grade: 'A' },
      ],
    });
    expect(JSON.stringify(dash(kept, viewer))).not.toContain('Technical SEO A → A');
    expect(without).toMatchObject({ tab: 0, door: 'no changes', log: 0 });
    expect(read(true)).toEqual(without);
  });
});
