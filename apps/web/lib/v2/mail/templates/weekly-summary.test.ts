import { describe, expect, it } from 'vitest';
import { buildOutgoing } from '../headers';
import { BOUNDS } from './alert';
import { htmlTargets } from './inspect';
import {
  gradeMovement,
  SUMMARY_SITE_ROWS,
  weeklySummaryTemplate,
  type SummaryChange,
  type WeeklySummaryInput,
} from './weekly-summary';

const A = '50000000-0000-4000-8000-000000000001';
const B = '50000000-0000-4000-8000-000000000002';
const UNSUB = 'https://crawlmouse.com/unsubscribe?t=abc.def';
const HOSTILE = '<script>x</script> "q" https://evil.example/\r\nBcc: a@b.c';

function change(o: Partial<SummaryChange> = {}): SummaryChange {
  return {
    kind: 'changed',
    subject: 'content',
    severity: null,
    summary: '5 pages changed content',
    where: '/blog/*',
    pages_affected: 5,
    ua: null,
    grade_deltas: [],
    detected_at: '2026-11-11T10:00:00Z',
    ...o,
  };
}

const seo = (from: [string, number], to: [string, number]) => [
  {
    grade: 'technical_seo' as const,
    from_grade: from[0] as never,
    from_score: from[1],
    to_grade: to[0] as never,
    to_score: to[1],
  },
];

const input = (sites: WeeklySummaryInput['sites']): WeeklySummaryInput => ({
  since: '2026-11-09T05:00:00Z',
  until: '2026-11-16T05:00:00Z',
  zone: 'America/New_York',
  sites,
  unsubscribeUrl: UNSUB,
});

// Every target in any spelling (inspect.ts), so a crawled string linked with `href='…'` is caught.
const hrefs = htmlTargets;

describe('the weekly summary (D6)', () => {
  const mail = weeklySummaryTemplate(
    input([
      { siteId: A, host: 'calm.example', changes: [change()] },
      {
        siteId: B,
        host: 'busy.example',
        changes: [
          change({
            kind: 'resolved',
            subject: 'orphans',
            severity: 'info',
            summary: 'Orphans linked',
          }),
          change({
            kind: 'opened',
            subject: 'crawler_access',
            severity: 'bad',
            ua: 'GPTBot',
            summary: 'GPTBot: allowed → blocked by a user-agent rule',
            where: 'all pages',
          }),
        ],
      },
    ]),
  );

  it('counts changes, sites and problems in the subject', () => {
    expect(mail.subject).toBe('Your week on Crawlmouse: 3 changes on 2 sites, 1 problem');
  });

  it('puts the site with a problem first, and its problem first within it', () => {
    const lines = mail.text.split('\n');
    expect(lines.indexOf('busy.example: 2 changes')).toBeLessThan(
      lines.indexOf('calm.example: 1 change'),
    );
    const busy = lines.indexOf('busy.example: 2 changes');
    expect(lines[busy + 2]).toBe('- Problem: GPTBot: allowed → blocked by a user-agent rule');
    expect(lines[busy + 4]).toBe('- Resolved: Orphans linked');
  });

  it('names the week in the account’s zone, Monday to Sunday', () => {
    expect(mail.text).toContain('What your checks found from 9 Nov to 15 Nov.');
  });

  it('links only to each site’s page, the changes log and the unsubscribe URL', () => {
    expect(hrefs(mail.html)).toEqual([
      `https://crawlmouse.com/sites/${B}`,
      `https://crawlmouse.com/sites/${A}`,
      'https://crawlmouse.com/changes',
      UNSUB,
    ]);
  });

  it('is never rendered empty', () => {
    expect(() => weeklySummaryTemplate(input([]))).toThrow(RangeError);
    expect(() =>
      weeklySummaryTemplate(input([{ siteId: A, host: 'a.example', changes: [] }])),
    ).toThrow(RangeError);
  });
});

describe('the grades’ movement over the week', () => {
  it('runs from the first delta’s start to the last one’s end, by time', () => {
    const moves = gradeMovement([
      change({ detected_at: '2026-11-14T00:00:00Z', grade_deltas: seo(['B', 80], ['C', 72]) }),
      change({ detected_at: '2026-11-10T00:00:00Z', grade_deltas: seo(['B+', 86], ['B', 80]) }),
    ]);
    expect(moves).toEqual([
      { grade: 'technical_seo', from: 'B+', fromScore: 86, to: 'C', toScore: 72 },
    ]);
    const m = weeklySummaryTemplate(
      input([
        {
          siteId: A,
          host: 'a.example',
          changes: [change({ subject: 'grade', grade_deltas: seo(['B+', 86], ['B', 80]) })],
        },
      ]),
    );
    expect(m.text).toContain('Grades: Technical SEO B+ 86 → B 80');
  });

  it('says so when no grade moved', () => {
    expect(
      weeklySummaryTemplate(input([{ siteId: A, host: 'a.example', changes: [change()] }])).text,
    ).toContain('No grade moved.');
  });
});

describe('outside strings and bounds (D3)', () => {
  it('escapes the host and every row, makes none a link, and keeps the subject one line', () => {
    const m = weeklySummaryTemplate(
      input([
        { siteId: A, host: HOSTILE, changes: [change({ summary: HOSTILE, where: HOSTILE })] },
      ]),
    );
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(hrefs(m.html).every((h) => h!.startsWith('https://crawlmouse.com/'))).toBe(true);
    expect(() =>
      buildOutgoing({ to: 'a@example.com', mail: m, idempotencyKey: 'k' }),
    ).not.toThrow();
    expect(m.text).not.toMatch(/\nBcc:/);
  });

  it('bounds a host, and lists a site’s first rows with a count of the rest', () => {
    const long = 'h'.repeat(1000);
    const many = Array.from({ length: SUMMARY_SITE_ROWS + 4 }, (_, k) =>
      change({ summary: `row ${k}` }),
    );
    const m = weeklySummaryTemplate(input([{ siteId: A, host: long, changes: many }]));
    expect(m.text).toContain(`${'h'.repeat(BOUNDS.host - 1)}…: ${SUMMARY_SITE_ROWS + 4} changes`);
    expect(m.text.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(SUMMARY_SITE_ROWS);
    expect(m.text).toContain('And 4 more on the site’s page.');
  });

  it('refuses a site id that is not an id', () => {
    expect(() =>
      weeklySummaryTemplate(
        input([{ siteId: 'javascript:x', host: 'a.example', changes: [change()] }]),
      ),
    ).toThrow(RangeError);
  });
});
