/**
 * Tier B review B1: the problems a message counts (its subject and its opening line) are the rows it
 * labels `Problem`, for any list of changes, in the alert and in the weekly summary. The count and the
 * label are read back from the rendered text, so a second predicate in either place shows up here.
 *
 * Problems sort first, so when a list is longer than the cap the rows shown are problems up to the
 * count: `Problem` rows shown = min(problems, rows shown).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { alertTemplate, MAIL_ROWS_MAX, type AlertMailChange } from './alert';
import { SUMMARY_SITE_ROWS, weeklySummaryTemplate, type SummaryChange } from './weekly-summary';

const LETTERS = ['A', 'B', 'C', 'D', 'F'] as const;

const delta = fc.record({
  grade: fc.constantFrom('technical_seo' as const, 'ai_readability' as const),
  from_grade: fc.constantFrom(...LETTERS),
  to_grade: fc.constantFrom(...LETTERS),
  from_score: fc.integer({ min: 0, max: 100 }),
  to_score: fc.integer({ min: 0, max: 100 }),
});

const mailChange = fc.record({
  kind: fc.constantFrom(
    'opened' as const,
    'resolved' as const,
    'changed' as const,
    'baseline' as const,
  ),
  subject: fc.constant('content' as const),
  severity: fc.constantFrom(null, 'bad' as const, 'warn' as const, 'info' as const),
  summary: fc.constantFrom('copy edited', 'GPTBot: allowed → disallowed', 'grade moved'),
  where: fc.constantFrom('all pages', '/blog/*', 'robots.txt'),
  pages_affected: fc.integer({ min: 1, max: 500 }),
  ua: fc.constant(null),
  grade_deltas: fc.array(delta, { maxLength: 2 }),
});

const alertChange: fc.Arbitrary<AlertMailChange> = mailChange.map((c) => ({ ...c, fix_id: null }));
const summaryChange: fc.Arbitrary<SummaryChange> = mailChange.map((c) => ({
  ...c,
  detected_at: '2026-11-11T10:00:00Z',
}));

/** The number in "N problem(s)" in a line, 0 when the line names none. */
function counted(line: string): number {
  const m = /(\d[\d,]*) problems?\b/.exec(line);
  return m ? Number(m[1]!.replace(/,/g, '')) : 0;
}

const labelled = (text: string, label: string) =>
  text.split('\n').filter((l) => l.startsWith(`- ${label}: `)).length;
const rows = (text: string) => text.split('\n').filter((l) => l.startsWith('- ')).length;

describe('one predicate decides a row’s label and the problem count (B1)', () => {
  it('in the alert: the subject and the opening line count the rows labelled Problem', () => {
    fc.assert(
      fc.property(
        fc.array(alertChange, { minLength: 1, maxLength: MAIL_ROWS_MAX + 6 }),
        (changes) => {
          const m = alertTemplate({
            host: 'shop.example',
            checkId: 'c0000000-0000-4000-8000-000000000006',
            checkedAt: '2026-10-30T10:02:00Z',
            zone: 'America/New_York',
            unsubscribeUrl: 'https://crawlmouse.com/unsubscribe?t=x.y',
            changes,
          });
          const subject = counted(m.subject);
          const intro = counted(m.text.split('\n')[2]!);
          expect(intro).toBe(subject);
          expect(labelled(m.text, 'Problem')).toBe(Math.min(subject, rows(m.text)));
          if (changes.length <= MAIL_ROWS_MAX) expect(labelled(m.text, 'Problem')).toBe(subject);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('in the weekly summary: the subject counts the rows labelled Problem across the sites', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(summaryChange, { minLength: 1, maxLength: SUMMARY_SITE_ROWS }), {
          minLength: 1,
          maxLength: 3,
        }),
        (lists) => {
          const m = weeklySummaryTemplate({
            since: '2026-11-09T05:00:00Z',
            until: '2026-11-16T05:00:00Z',
            zone: 'America/New_York',
            unsubscribeUrl: 'https://crawlmouse.com/unsubscribe?t=x.y',
            sites: lists.map((changes, k) => ({
              siteId: `50000000-0000-4000-8000-00000000000${k}`,
              host: `s${k}.example`,
              changes,
            })),
          });
          expect(labelled(m.text, 'Problem')).toBe(counted(m.subject));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('labels a changed row whose grade fell a Problem, and counts it once', () => {
    const m = alertTemplate({
      host: 'shop.example',
      checkId: 'c0000000-0000-4000-8000-000000000006',
      checkedAt: '2026-10-30T10:02:00Z',
      zone: 'America/New_York',
      unsubscribeUrl: 'https://crawlmouse.com/unsubscribe?t=x.y',
      changes: [
        {
          kind: 'changed',
          subject: 'grade',
          severity: 'warn',
          summary: 'AI readability moved from B to C',
          where: 'all pages',
          pages_affected: 40,
          ua: null,
          fix_id: null,
          grade_deltas: [
            {
              grade: 'ai_readability',
              from_grade: 'B',
              to_grade: 'C',
              from_score: 81,
              to_score: 72,
            },
          ],
        },
      ],
    });
    expect(m.subject).toBe('shop.example: 1 change, 1 problem');
    expect(m.text.split('\n')[2]).toBe('The check on Fri 30 Oct at 06:02 EDT found 1 problem.');
    expect(m.text).toContain('- Problem: AI readability moved from B to C\n');
  });
});
