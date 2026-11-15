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
