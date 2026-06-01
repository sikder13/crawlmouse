import { describe, it, expect } from 'vitest';
import { buildFindingsCsv, buildPagesCsv, csvCell } from './csv';

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
