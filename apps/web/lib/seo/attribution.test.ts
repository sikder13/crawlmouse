import { describe, expect, it } from 'vitest';
import { attributeQueries, coverage, words } from './attribution';

describe('attribution', () => {
  it('words drops stop words and a plural s, keeps topic words', () => {
    expect(words('How to find the Orphan Pages vs Sitebulb')).toEqual([
      'find',
      'orphan',
      'page',
      'vs',
      'sitebulb',
    ]);
    expect(words('class')).toEqual(['class']);
  });
  it('coverage is the share of the query words the page holds', () => {
    expect(
      coverage('screaming frog alternative', { path: '/a', terms: ['screaming-frog-alternative'] }),
    ).toBe(1);
    expect(coverage('screaming frog vs sitebulb', { path: '/b', terms: ['screaming frog'] })).toBe(
      0.5,
    );
  });
  it('attributes to the best page, ties to both, and drops a query below the threshold', () => {
    const pages = [
      { path: '/sf', terms: ['screaming frog alternative'] },
      { path: '/sb', terms: ['sitebulb vs screaming frog'] },
      { path: '/sb2', terms: ['screaming frog vs sitebulb'] },
    ];
    const got = attributeQueries(
      [
        ['screaming frog alternative', 0, 10, 50],
        ['sitebulb vs screaming frog', 0, 20, 30],
        ['crawl depth', 0, 99, 9],
      ],
      pages,
    );
    expect(got.get('/sf')!.map((r) => r[0])).toEqual(['screaming frog alternative']);
    expect(got.get('/sb')!.map((r) => r[0])).toEqual(['sitebulb vs screaming frog']);
    expect(got.get('/sb2')!.map((r) => r[0])).toEqual(['sitebulb vs screaming frog']);
  });
});

describe('the Search Console data', () => {
  it('holds every query row whole: a string and three finite numbers', async () => {
    const { QUERIES } = await import('./search-console');
    for (const r of QUERIES) {
      expect(typeof r[0]).toBe('string');
      for (const n of r.slice(1)) expect(Number.isFinite(n), r[0]).toBe(true);
    }
    // The export's Queries tab, counted with a CSV parser, where a multi-line quoted cell is one row:
    // python3 -c "import csv;print(len(list(csv.reader(open('Queries.csv',newline='')))[1:]))" → 274.
    expect(QUERIES.length).toBe(274);
  });
});
