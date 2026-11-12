import { describe, expect, it } from 'vitest';
import {
  docStrings,
  REPORT_FILES,
  reportPath,
  ReportRequestSchema,
  type ReportDoc,
} from './generate';

const A = '0b1f6c1e-5a55-4d6e-9d2c-3f1c1b7a9e10';
const B = '1c2f6c1e-5a55-4d6e-9d2c-3f1c1b7a9e11';

describe('ReportRequestSchema', () => {
  it('takes the four requests the route makes', () => {
    const ok = [
      { kind: 'audit_pdf', siteId: A, checkId: B },
      { kind: 'compare', siteId: A, checkId: B },
      { kind: 'compare', siteId: A, checkId: B, previousCheckId: A },
      { kind: 'compare', siteId: A, checkId: B, fixId: A },
      { kind: 'raw_export', siteId: A, checkId: B, format: 'csv' },
      { kind: 'raw_export', siteId: A, checkId: B, format: 'edge_list' },
      { kind: 'prospect_one_pager', url: 'example.com' },
    ];
    expect(ok.filter((r) => !ReportRequestSchema.safeParse(r).success)).toEqual([]);
  });

  it('refuses a kind nobody may ask for, a format a raw export has not, a stray key and a malformed id', () => {
    const bad = [
      { kind: 'public_link', siteId: A, checkId: B },
      { kind: 'client_report', siteId: A, checkId: B },
      { kind: 'raw_export', siteId: A, checkId: B, format: 'pdf' },
      { kind: 'raw_export', siteId: A, checkId: B },
      { kind: 'audit_pdf', siteId: A, checkId: B, accountId: A },
      { kind: 'audit_pdf', siteId: A.toUpperCase(), checkId: B },
      { kind: 'audit_pdf', siteId: `${A}/../x`, checkId: B },
      { kind: 'prospect_one_pager', url: '' },
      { kind: 'prospect_one_pager', url: 'x'.repeat(2049) },
    ];
    expect(bad.filter((r) => ReportRequestSchema.safeParse(r).success)).toEqual([]);
  });
});

describe('docStrings', () => {
  it('lists every string of every block kind, in reading order', () => {
    const doc: ReportDoc = {
      title: 't',
      lines: ['l1', 'l2'],
      sections: [
        {
          heading: 'h1',
          blocks: [
            { type: 'text', text: 'p' },
            { type: 'facts', rows: [{ label: 'fl', value: 'fv' }] },
            { type: 'table', caption: 'c', columns: ['c1', 'c2'], rows: [['a', 'b']] },
            {
              type: 'pair',
              title: 'pt',
              before: { label: 'bl', date: 'bd', value: 'bv', evidence: ['be'] },
              after: { label: 'al', date: 'ad', value: 'av', evidence: ['ae1', 'ae2'] },
            },
          ],
        },
      ],
      notMeasured: ['n'],
      footer: { text: 'f', href: 'https://crawlmouse.com/' },
    };
    expect(docStrings(doc)).toEqual([
      't',
      'l1',
      'l2',
      'h1',
      'p',
      'fl',
      'fv',
      'c',
      'c1',
      'c2',
      'a',
      'b',
      'pt',
      'bl',
      'bd',
      'bv',
      'be',
      'al',
      'ad',
      'av',
      'ae1',
      'ae2',
      'n',
      'f',
      'https://crawlmouse.com/',
    ]);
  });
});

describe('reportPath', () => {
  it('names the account’s folder and the report, with the format’s extension', () => {
    const paths = Object.fromEntries(
      (Object.keys(REPORT_FILES) as (keyof typeof REPORT_FILES)[]).map((f) => [
        f,
        reportPath(A, B, f),
      ]),
    );
    expect(paths).toEqual({
      pdf: `${A}/${B}.pdf`,
      csv: `${A}/${B}.csv`,
      json: `${A}/${B}.json`,
      edge_list: `${A}/${B}.edges.csv`,
      html: `${A}/${B}.doc.json`,
    });
  });

  it('refuses an id that is not one, so no path is built from a caller’s string', () => {
    expect(() => reportPath('../other', B, 'pdf')).toThrow();
    expect(() => reportPath(A, `${B}/x`, 'pdf')).toThrow();
  });
});
