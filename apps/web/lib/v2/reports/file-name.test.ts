import { describe, expect, it } from 'vitest';
import { reportFileName } from './file-name';

const AT = '2026-11-23T22:41:07.123Z';

describe('the name a report file downloads under (F-125)', () => {
  it.each([
    ['audit_pdf', 'pdf', 'crawlmouse-example.com-2026-11-23-audit.pdf'],
    ['compare', 'html', 'crawlmouse-example.com-2026-11-23-compare.doc.json'],
    ['client_report', 'pdf', 'crawlmouse-example.com-2026-11-23-report.pdf'],
    ['raw_export', 'csv', 'crawlmouse-example.com-2026-11-23-export.csv'],
    ['raw_export', 'json', 'crawlmouse-example.com-2026-11-23-export.json'],
    ['raw_export', 'edge_list', 'crawlmouse-example.com-2026-11-23-export.edges.csv'],
  ] as const)('%s as %s: %s', (kind, format, name) => {
    expect(reportFileName({ host: 'example.com', createdAt: AT, kind, format })).toBe(name);
  });

  it('dates the file by UTC, as stored', () => {
    expect(
      reportFileName({
        host: 'a.test',
        createdAt: '2026-11-24T03:30:00Z',
        kind: 'audit_pdf',
        format: 'pdf',
      }),
    ).toBe('crawlmouse-a.test-2026-11-24-audit.pdf');
  });

  it.each([
    ['Shop.Example.COM', 'shop.example.com'],
    ['bücher.de', 'b-cher.de'],
    ['a"b;c\\d/e', 'a-b-c-d-e'],
    ['../../etc', '..-..-etc'],
  ])('keeps only letters, digits, dots and hyphens of the host: %j', (host, kept) => {
    const name = reportFileName({ host, createdAt: AT, kind: 'audit_pdf', format: 'pdf' });
    expect(name).toBe(`crawlmouse-${kept}-2026-11-23-audit.pdf`);
    expect(name).toMatch(/^[a-z0-9.-]+$/);
  });

  it('keeps a long host to 100 characters', () => {
    const name = reportFileName({
      host: `${'a'.repeat(240)}.com`,
      createdAt: AT,
      kind: 'audit_pdf',
      format: 'pdf',
    });
    expect(name).toBe(`crawlmouse-${'a'.repeat(100)}-2026-11-23-audit.pdf`);
  });

  it('an unreadable date leaves the date out rather than writing a wrong one', () => {
    expect(
      reportFileName({ host: 'a.test', createdAt: 'not a date', kind: 'audit_pdf', format: 'pdf' }),
    ).toBe('crawlmouse-a.test-audit.pdf');
  });
});
