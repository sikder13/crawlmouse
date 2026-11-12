import { describe, expect, it } from 'vitest';
import { buildOutgoing } from '../headers';
import { alertTemplate, BOUNDS, MAIL_ROWS_MAX, pageUrl, type MailChange } from './alert';
import { htmlTargets } from './inspect';

const CHECK = 'c0000000-0000-4000-8000-000000000006';
const UNSUB = 'https://crawlmouse.com/unsubscribe?t=abc.def';
const HOSTILE = '<img src=x onerror=alert(1)> "q" & \'s\' https://evil.example/x\r\nBcc: a@b.c';

function change(o: Partial<MailChange> = {}): MailChange {
  return {
    kind: 'changed',
    subject: 'content',
    severity: null,
    summary: '17 pages changed content',
    where: '/products/*',
    pages_affected: 17,
    ua: null,
    grade_deltas: [],
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
      '- Changed: AI readability D → F (41 → 22)',
      '- Changed: 17 pages changed content',
      '- Resolved: 3 orphan pages now linked',
    ]);
    expect(mail.text).toContain('all pages, 214 pages · AI readability D 41 → F 22');
    expect(mail.text).toContain('The check that finished Fri 30 Oct 06:02');
  });

  it('links only to the check’s page, the alert rules and the unsubscribe URL', () => {
    expect(hrefs(mail.html)).toEqual([
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
    expect(m.text).toContain(`  ${'y'.repeat(BOUNDS.where - 1)}…, 17 pages`);
    const h = alertTemplate({ ...base, host: long, changes: [change()] });
    expect(h.subject).toBe(`${'x'.repeat(BOUNDS.subjectHost - 1)}…: 1 change`);
    expect(h.text).toContain(`Changes on ${'x'.repeat(BOUNDS.host - 1)}…\n`);
    expect(h.text).not.toContain('x'.repeat(BOUNDS.host));
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
