import { describe, expect, it } from 'vitest';
import { buildOutgoing } from '../headers';
import {
  alertTemplate,
  BOUNDS,
  MAIL_ROWS_MAX,
  pageUrl,
  wherePhrase,
  type AlertMailChange,
} from './alert';
import { htmlTargets } from './inspect';

const CHECK = 'c0000000-0000-4000-8000-000000000006';
const UNSUB = 'https://crawlmouse.com/unsubscribe?t=abc.def';
const HOSTILE = '<img src=x onerror=alert(1)> "q" & \'s\' https://evil.example/x\r\nBcc: a@b.c';

const FIX = 'f0000000-0000-4000-8000-000000000000';

function change(o: Partial<AlertMailChange> = {}): AlertMailChange {
  return {
    kind: 'changed',
    subject: 'content',
    severity: null,
    summary: '17 pages changed content',
    where: '/products/*',
    pages_affected: 17,
    ua: null,
    grade_deltas: [],
    fix_id: null,
    ...o,
  };
}

const base = {
  host: 'example-outfitter.com',
  checkId: CHECK,
  checkedAt: '2026-10-30T10:02:00Z',
  zone: 'America/Indiana/Indianapolis',
  unsubscribeUrl: UNSUB,
};

// Every target in any spelling (inspect.ts), so a crawled string linked with `href='…'` is caught.
const hrefs = htmlTargets;

describe('the alert email (D5, D3)', () => {
  const mail = alertTemplate({
    ...base,
    changes: [
      change(),
      change({
        kind: 'resolved',
        subject: 'orphans',
        severity: 'info',
        summary: '3 orphan pages now linked',
        fix_id: 'f0000000-0000-4000-8000-000000000014',
      }),
      change({
        kind: 'changed',
        subject: 'grade',
        summary: 'AI readability D → F (41 → 22)',
        where: 'all pages',
        pages_affected: 214,
        grade_deltas: [
          { grade: 'ai_readability', from_score: 41, to_score: 22, from_grade: 'D', to_grade: 'F' },
        ],
      }),
      change({
        kind: 'opened',
        subject: 'crawler_access',
        severity: 'bad',
        ua: 'GPTBot',
        summary: 'GPTBot: allowed → disallowed by robots.txt',
        where: 'robots.txt',
        pages_affected: 214,
        fix_id: FIX,
      }),
    ],
  });

  it('names the host, the count and the problems in the subject', () => {
    expect(mail.subject).toBe('example-outfitter.com: 4 changes, 2 problems');
  });

  it('lists problems first: the opened block, the falling grade, then the change, then the resolution', () => {
    const lines = mail.text.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toEqual([
      '- Problem: GPTBot: allowed → disallowed by robots.txt',
      '- Problem: AI readability D → F (41 → 22)',
      '- Changed: 17 pages changed content',
      '- Resolved: 3 orphan pages now linked',
    ]);
    expect(mail.text).toContain('  across the site · 214 pages · AI readability D 41 → F 22');
    expect(mail.text).toContain('  in robots.txt · 214 pages');
    expect(mail.text).toContain('  on /products/* · 17 pages');
  });

  it('opens with when the check ran, in the account’s zone by its short name, and what it found', () => {
    expect(mail.text.split('\n')[2]).toBe(
      'The check on Fri 30 Oct at 06:02 EDT found 2 problems and 2 other changes.',
    );
    expect(mail.html).toContain(
      'The check on Fri 30 Oct at 06:02 EDT found 2 problems and 2 other changes.',
    );
    expect(mail.text).not.toContain('America/');
  });

  it('says where a grade moved, once, above the list', () => {
    const lines = mail.text.split('\n');
    expect(lines[4]).toBe('AI readability D → F');
    expect(lines.indexOf('AI readability D → F')).toBeLessThan(
      lines.findIndex((l) => l.startsWith('- ')),
    );
    expect(mail.html).toContain(
      '<p style="margin:0 0 16px"><strong>AI readability D → F</strong></p>',
    );
  });

  it('leads an opened change with a fix to the fix’s page; a resolved one keeps the check', () => {
    const fixUrl = `https://crawlmouse.com/audit/${CHECK}/fix/${FIX}`;
    expect(mail.text).toContain(
      `- Problem: GPTBot: allowed → disallowed by robots.txt\n  in robots.txt · 214 pages\n  Open the fix: ${fixUrl}\n`,
    );
    expect(mail.text.match(/Open the fix/g)).toHaveLength(1);
    expect(mail.html).toContain(`<a href="${fixUrl}">Open the fix</a>`);
  });

  it('links only to the fix, the check’s page, the alert rules and the unsubscribe URL', () => {
    expect(hrefs(mail.html)).toEqual([
      `https://crawlmouse.com/audit/${CHECK}/fix/${FIX}`,
      `https://crawlmouse.com/audit/${CHECK}`,
      'https://crawlmouse.com/alerts',
      'https://crawlmouse.com/unsubscribe?t=abc.def',
    ]);
    expect(mail.text).toContain(`Unsubscribe: ${UNSUB}`);
  });
});

describe('outside strings (D3)', () => {
  const mail = alertTemplate({
    ...base,
    host: HOSTILE,
    changes: [
      change({ summary: HOSTILE, where: HOSTILE, ua: HOSTILE, kind: 'opened', severity: 'warn' }),
    ],
  });

  it('escapes every outside string in the HTML and never makes one a link', () => {
    expect(mail.html).not.toContain('<img');
    expect(mail.html).not.toContain('"q"');
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(hrefs(mail.html).every((h) => h!.startsWith('https://crawlmouse.com/'))).toBe(true);
  });

  it('keeps line breaks out of the subject, so the header is accepted, and out of each row', () => {
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(() => buildOutgoing({ to: 'a@example.com', mail, idempotencyKey: 'k' })).not.toThrow();
    expect(mail.text).not.toContain('\r');
    expect(mail.text).not.toMatch(/\nBcc:/);
  });

  it('bounds each outside string, with an ellipsis', () => {
    const long = 'x'.repeat(5000);
    const m = alertTemplate({
      ...base,
      changes: [change({ summary: long, where: 'y'.repeat(5000) })],
    });
    expect(m.text).toContain(`- Changed: ${'x'.repeat(BOUNDS.summary - 1)}…\n`);
    expect(m.text).toContain(`  on ${'y'.repeat(BOUNDS.where - 1)}… · 17 pages`);
    const h = alertTemplate({ ...base, host: long, changes: [change()] });
    expect(h.subject).toBe(`${'x'.repeat(BOUNDS.subjectHost - 1)}…: 1 change`);
    expect(h.text).toContain(`Changes on ${'x'.repeat(BOUNDS.host - 1)}…\n`);
    expect(h.text).not.toContain('x'.repeat(BOUNDS.host));
  });

  it('refuses a fix id that is not an id, rather than linking it', () => {
    expect(() =>
      alertTemplate({
        ...base,
        changes: [change({ kind: 'opened', severity: 'bad', fix_id: 'https://evil.example' })],
      }),
    ).toThrow(RangeError);
  });

  it('refuses a check id that is not an id, rather than linking it', () => {
    expect(() => pageUrl('/audit/', 'https://evil.example')).toThrow(RangeError);
    expect(() => alertTemplate({ ...base, checkId: '../x', changes: [change()] })).toThrow(
      RangeError,
    );
  });

  it('does not carry the recipient: the template is never given one', () => {
    expect(Object.keys(base)).not.toContain('to');
    const plain = alertTemplate({ ...base, changes: [change()] });
    expect(plain.text).not.toMatch(/[\w.+-]+@[\w-]+\.\w/);
    expect(plain.html).not.toMatch(/[\w.+-]+@[\w-]+\.\w/);
  });
});

describe('a long list', () => {
  it('shows the first rows and says how many more there are', () => {
    const many = Array.from({ length: MAIL_ROWS_MAX + 3 }, (_, k) =>
      change({ summary: `row ${k}` }),
    );
    const m = alertTemplate({ ...base, changes: many });
    expect(m.text.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(MAIL_ROWS_MAX);
    expect(m.text).toContain('And 3 more on the check’s page.');
    expect(m.subject).toBe(`example-outfitter.com: ${MAIL_ROWS_MAX + 3} changes`);
  });
});

describe('where and how many, as one phrase (rulings-3 item 1)', () => {
  it.each([
    ['all pages', 'across the site'],
    ['robots.txt', 'in robots.txt'],
    ['stack', 'in the site’s stack'],
    ['/collections/*', 'on /collections/*'],
    ['collection pages', 'on collection pages'],
    // A key of Object.prototype is a where like any other, not a phrase (§10, Object.hasOwn).
    ['__proto__', 'on __proto__'],
    ['constructor', 'on constructor'],
    ['toString', 'on toString'],
  ])('%s reads “%s”', (where, phrase) => {
    expect(wherePhrase(where)).toBe(phrase);
  });

  it('says one page at one', () => {
    const m = alertTemplate({
      ...base,
      changes: [change({ where: 'all pages', pages_affected: 1 })],
    });
    expect(m.text).toContain('  across the site · 1 page\n');
  });
});

describe('the opening line’s counts (rulings-3 item 3)', () => {
  const intro = (changes: AlertMailChange[]) =>
    alertTemplate({ ...base, changes }).text.split('\n')[2];
  const opened = (o: Partial<AlertMailChange> = {}) =>
    change({ kind: 'opened', severity: 'warn', ...o });

  it.each<[string, AlertMailChange[], string]>([
    ['one problem', [opened()], 'found 1 problem.'],
    ['two problems', [opened(), opened()], 'found 2 problems.'],
    ['one change, no problem', [change()], 'found 1 change.'],
    ['three changes', [change(), change(), change()], 'found 3 changes.'],
    ['a problem and another change', [opened(), change()], 'found 1 problem and 1 other change.'],
  ])('%s', (_, changes, end) => {
    expect(intro(changes)).toBe(`The check on Fri 30 Oct at 06:02 EDT ${end}`);
  });

  it('reads the time in a zone Intl names only by offset as “your time”', () => {
    const m = alertTemplate({ ...base, zone: 'Asia/Tokyo', changes: [opened()] });
    expect(m.text.split('\n')[2]).toBe(
      'The check on Fri 30 Oct at 19:02 your time found 1 problem.',
    );
  });
});

describe('the grade line (rulings-3 item 2)', () => {
  const seo = (from: string, fromScore: number, to: string, toScore: number) => ({
    grade: 'technical_seo' as const,
    from_grade: from as never,
    from_score: fromScore,
    to_grade: to as never,
    to_score: toScore,
  });

  it('is absent when no grade moved', () => {
    const m = alertTemplate({ ...base, changes: [change()] });
    expect(m.text).not.toMatch(/→/);
    expect(m.text.split('\n')[4]).toMatch(/^- /);
  });

  it('names each grade whose letter moved, in grade order, from the first delta to the last', () => {
    const m = alertTemplate({
      ...base,
      changes: [
        change({
          grade_deltas: [
            {
              grade: 'ai_readability',
              from_score: 41,
              to_score: 22,
              from_grade: 'D',
              to_grade: 'F',
            },
          ],
        }),
        change({ grade_deltas: [seo('B+', 86, 'B', 81)] }),
        change({ grade_deltas: [seo('B', 81, 'C', 70)] }),
      ],
    });
    expect(m.text.split('\n')[4]).toBe('Technical SEO B+ → C · AI readability D → F');
  });

  it('leaves out a grade whose letter held', () => {
    const m = alertTemplate({
      ...base,
      changes: [change({ grade_deltas: [seo('B', 81, 'B', 79)] })],
    });
    expect(m.text.split('\n')[4]).toMatch(/^- /);
  });
});

describe('a crawler’s name before its summary', () => {
  const line = (ua: string, summary: string) =>
    alertTemplate({ ...base, changes: [change({ ua, summary })] })
      .text.split('\n')
      .find((l) => l.startsWith('- '));

  it('is added when the summary does not start with it', () => {
    expect(line('GPTBot', 'allowed → disallowed')).toBe('- Changed: GPTBot: allowed → disallowed');
  });

  it('is not repeated when the summary already starts with the name', () => {
    expect(line('ClaudeBot', 'ClaudeBot is now blocked on a.example')).toBe(
      '- Changed: ClaudeBot is now blocked on a.example',
    );
    expect(line('GPTBot', 'GPTBot: allowed → disallowed')).toBe(
      '- Changed: GPTBot: allowed → disallowed',
    );
  });

  it('is added when the summary starts with a longer name that begins with it', () => {
    expect(line('Claude', 'Claude-SearchBot is now blocked')).toBe(
      '- Changed: Claude: Claude-SearchBot is now blocked',
    );
  });
});
