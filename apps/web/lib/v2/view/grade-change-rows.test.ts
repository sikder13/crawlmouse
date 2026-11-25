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

describe('a grade row where one letter held and another moved (QA N1, CTO ruling)', () => {
  const MIXED = '90000000-0000-4000-8000-0000000000f3';
  function mixed() {
    const d = structuredClone(fixture('bad-site'));
    const moved = d.changes.find((c) => c.id === LETTER_MOVED)!;
    d.changes = d.changes.filter((c) => c.id !== LETTER_MOVED);
    d.changes.push({
      ...moved,
      id: MIXED,
      // Sent, so the Alerts page lists it among the alerts fired.
      notified: moved.notified ?? d.changes.find((c) => c.notified)!.notified,
      summary: 'Technical SEO A → A (90 → 91); AI readability D → F (41 → 22)',
      grade_deltas: [
        { grade: 'technical_seo', from_score: 90, to_score: 91, from_grade: 'A', to_grade: 'A' },
        { grade: 'ai_readability', from_score: 41, to_score: 22, from_grade: 'D', to_grade: 'F' },
      ],
    });
    return { d, check: moved.check_id };
  }

  it('the log and the tab print only the letter that moved', () => {
    const { d, check } = mixed();
    const viewer = { accountId: ACCOUNT, now: d.as_of };
    const log = changesLogView(d, viewer, {}, '/changes').rows.find((r) => r.key === MIXED)!;
    expect(log.summary).toBe('AI readability D → F (41 → 22)');
    const tab = changesView(d, check, {});
    if (tab.state !== 'changes') throw new Error(`segment state ${tab.state}`);
    expect(tab.rows.find((r) => r.key === MIXED)!.summary).toBe('AI readability D → F (41 → 22)');
  });

  it('an alert mail’s row and the Alerts page name only the letter that moved', async () => {
    const { rowText } = await import('../mail/templates/alert');
    const { onlyMoved } = await import('./listed-changes');
    const row = mixed().d.changes.find((c) => c.id === MIXED)!;
    expect(rowText(row).line).toBe('AI readability D → F (41 → 22)');
    expect(onlyMoved(row).grade_deltas.map((g) => g.grade)).toEqual(['ai_readability']);
    // The Alerts page reads `accountChanges`, which is `listedChanges`, so it names the moved letter.
    const { alertsView } = await import('./alerts');
    const { d } = mixed();
    const page = JSON.stringify(alertsView(d, { accountId: ACCOUNT, now: d.as_of }));
    expect(page).toContain('AI readability D 41 → F 22');
    expect(page).not.toContain('A 90 → A 91');
    // A row where every letter moved keeps the engine's own words.
    const both = { ...row, grade_deltas: [row.grade_deltas[1]!], summary: 'kept as written' };
    expect(onlyMoved(both).summary).toBe('kept as written');
  });

  it('the dashboard names no held letter', async () => {
    const { dashboardView } = await import('./dashboard');
    const { d } = mixed();
    const text = JSON.stringify(dashboardView(d, { accountId: ACCOUNT, now: d.as_of }));
    expect(text).not.toContain('A → A');
  });
});
