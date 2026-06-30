import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildFindingsCsv, buildPagesCsv, buildPrescriptionsCsv, buildAuditZip, csvCell, truncateDetail, type PrescriptionExport } from './csv';

describe('csvCell', () => {
  it('quotes and escapes commas, quotes, newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
  });
  it('neutralizes spreadsheet formula injection on leading = + - @', () => {
    expect(csvCell('=1+2')).toBe("'=1+2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('=a,b')).toBe('"\'=a,b"'); // neutralized, then quoted for the comma
  });
  it('neutralizes a formula hidden behind leading whitespace', () => {
    expect(csvCell(' =cmd')).toBe("' =cmd");
    expect(csvCell('\t=HYPERLINK(1)')).toBe("'\t=HYPERLINK(1)");
    expect(csvCell('  plain text')).toBe('  plain text'); // leading spaces, no formula → untouched
  });
  it('quotes a value containing a bare carriage return', () => {
    expect(csvCell('a\rb')).toBe('"a\rb"');
  });
});

describe('truncateDetail', () => {
  it('truncates a >max string to exactly max+1 chars ending in an ellipsis', () => {
    const out = truncateDetail('x'.repeat(5000), 4000);
    expect(out).toHaveLength(4001);
    expect(out.endsWith('…')).toBe(true);
  });
  it('leaves an exactly-max string unchanged (no ellipsis)', () => {
    const s = 'y'.repeat(4000);
    expect(truncateDetail(s, 4000)).toBe(s);
  });
  it('leaves a short string unchanged', () => {
    expect(truncateDetail('hello', 4000)).toBe('hello');
  });
});

describe('buildFindingsCsv', () => {
  it('has a header row and one row per finding', () => {
    const csv = buildFindingsCsv([
      { category: 'orphan', severity: 'critical', pageUrl: 'https://x.com/a', detail: 'no inbound links' },
    ]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('category,severity,page_url,detail');
    expect(lines[1]).toBe('orphan,critical,https://x.com/a,no inbound links');
  });
});

describe('buildPagesCsv', () => {
  it('emits page metrics', () => {
    const csv = buildPagesCsv([
      { url: 'https://x.com/a', title: 'A', status_code: 200, depth: 1, in_degree: 0, out_degree: 3, is_orphan: true },
    ]);
    expect(csv.split('\n')[0]).toBe('url,title,status_code,depth,in_degree,out_degree,is_orphan');
    expect(csv.split('\n')[1]).toBe('https://x.com/a,A,200,1,0,3,true');
  });
});

const RX: PrescriptionExport[] = [{
  rank: 1, fixId: 'orphan:https://x.com/o', isFreeFix: true, category: 'orphan', targetUrl: 'https://x.com/o',
  targetTitle: 'Orphan', marginalDelta: 5, effort: 'low', rationale: 'no inbound', suggestedLinks: 'https://x.com/ → "the orphan"', actionPacket: 'PASTE INTO AI',
}];

describe('buildPrescriptionsCsv (SPEC 02 Pro cure export)', () => {
  it('emits the cure header + one row per fix incl. the action packet', () => {
    const csv = buildPrescriptionsCsv(RX);
    expect(csv.split('\n')[0]).toBe('rank,fix_id,is_free_fix,category,target_url,target_title,marginal_delta,effort,rationale,suggested_links,action_packet');
    const dataRow = csv.split('\n')[1]!;
    expect(dataRow).toContain('orphan:https://x.com/o');
    expect(dataRow).toContain('PASTE INTO AI');
    expect(dataRow).toContain('true'); // is_free_fix
  });

  it('neutralizes spreadsheet formula injection in crawled-derived prescription cells', () => {
    // target_title / rationale / action_packet are crawled-derived → must route through csvCell.
    const csv = buildPrescriptionsCsv([{ ...RX[0]!, targetTitle: '=cmd()', rationale: ' =danger()', actionPacket: '@SUM(A1)' }]);
    const dataRow = csv.split('\n')[1]!;
    expect(dataRow).toContain("'=cmd()"); // leading = neutralized
    expect(dataRow).toContain("' =danger()"); // leading-whitespace formula neutralized
    expect(dataRow).toContain("'@SUM(A1)"); // leading @ neutralized
  });
});

describe('buildAuditZip', () => {
  it('includes prescriptions.csv ONLY when there are prescriptions (v1 export unchanged)', async () => {
    const withRx = await JSZip.loadAsync(await buildAuditZip([], [], RX));
    expect(Object.keys(withRx.files).sort()).toEqual(['findings.csv', 'pages.csv', 'prescriptions.csv']);
    const withoutRx = await JSZip.loadAsync(await buildAuditZip([], []));
    expect(Object.keys(withoutRx.files).sort()).toEqual(['findings.csv', 'pages.csv']); // no cure file on v1
  });
});
