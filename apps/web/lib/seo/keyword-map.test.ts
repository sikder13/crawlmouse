import { describe, expect, it } from 'vitest';
import { cannibalPairs, keywordRows, renderKeywordMap, type KeywordMapInput } from './keyword-map';

const input: KeywordMapInput = {
  exportedAt: '2026-11-15',
  pages: [
    { path: '/', title: 'Crawlmouse — Grade your site' },
    { path: '/blog/sf-alt', title: 'Screaming Frog Alternatives' },
    { path: '/blog/sb-vs-sf', title: 'Sitebulb vs Screaming Frog' },
    { path: '/blog/sf-vs-sb', title: 'Screaming Frog vs Sitebulb' },
    { path: '/blog/quiet', title: 'A quiet post' },
    { path: '/bot', title: null },
  ],
  posts: [
    {
      slug: 'sf-alt',
      title: 'Screaming Frog Alternatives',
      keywords: ['screaming frog alternative'],
    },
    { slug: 'sb-vs-sf', title: 'Sitebulb vs Screaming Frog', keywords: [] },
    { slug: 'sf-vs-sb', title: 'Screaming Frog vs Sitebulb', keywords: [] },
    { slug: 'quiet', title: 'A quiet post', keywords: ['orphan page finder', 'second keyword'] },
  ],
  queries: [
    ['crawlmouse', 12, 17, 1],
    ['screaming frog alternative', 0, 828, 67.16],
    ['free screaming frog alternative', 0, 10, 47.7],
    ['sitebulb vs screaming frog', 0, 289, 19.5],
    ['unrelated words entirely', 0, 50, 30],
  ],
  pageRows: [
    ['/', 25, 86, 2.02],
    ['/blog/sf-alt', 3, 1658, 56.96],
    ['/blog/sb-vs-sf', 0, 466, 31.25],
  ],
  pairs: [['/blog/sf-alt', '/blog/sb-vs-sf']],
};

describe('keywordRows', () => {
  const rows = keywordRows(input);
  const row = (p: string) => rows.find((r) => r.path === p)!;

  it('takes the primary query from the attributed queries, most impressions first', () => {
    expect(row('/blog/sf-alt').primary).toEqual({
      query: 'screaming frog alternative',
      impressions: 828,
      source: 'attributed',
    });
    expect(row('/blog/sf-alt').secondary).toEqual(['free screaming frog alternative (10)']);
    expect(row('/').primary?.query).toBe('crawlmouse');
  });

  it('prefers a query the page holds alone to one it shares with another page', () => {
    const shared = keywordRows({
      ...input,
      queries: [...input.queries, ['sitebulb vs screaming frog pricing', 0, 5, 40]],
    });
    expect(shared.find((r) => r.path === '/blog/sb-vs-sf')!.primary?.query).toBe(
      'sitebulb vs screaming frog',
    );
    const own = keywordRows({
      ...input,
      posts: input.posts.map((p) => (p.slug === 'sb-vs-sf' ? { ...p, keywords: ['pricing'] } : p)),
      queries: [...input.queries, ['sitebulb vs screaming frog pricing', 0, 5, 40]],
    });
    expect(own.find((r) => r.path === '/blog/sb-vs-sf')!.primary).toEqual({
      query: 'sitebulb vs screaming frog pricing',
      impressions: 5,
      source: 'attributed',
    });
    expect(own.find((r) => r.path === '/blog/sb-vs-sf')!.secondary).toEqual([
      'sitebulb vs screaming frog (289)',
    ]);
  });

  it('falls back to the post’s first keyword, and its other keywords as secondaries', () => {
    expect(row('/blog/quiet').primary).toEqual({
      query: 'orphan page finder',
      impressions: null,
      source: 'post keyword',
    });
    expect(row('/blog/quiet').secondary).toEqual(['second keyword']);
  });

  it('has no primary for a page that is not a post and has no attributed query', () => {
    expect(row('/bot').primary).toBeNull();
  });

  it('carries each page’s own impressions and position from the export, or none', () => {
    expect([row('/blog/sb-vs-sf').impressions, row('/blog/sb-vs-sf').position]).toEqual([
      466, 31.25,
    ]);
    expect([row('/blog/quiet').impressions, row('/blog/quiet').position]).toEqual([0, null]);
  });
});

describe('cannibalPairs', () => {
  it('lists a query attributed to two pages, with both', () => {
    expect(cannibalPairs(input)).toEqual([
      {
        query: 'sitebulb vs screaming frog',
        impressions: 289,
        position: 19.5,
        pages: ['/blog/sb-vs-sf', '/blog/sf-vs-sb'],
      },
    ]);
  });
});

describe('renderKeywordMap', () => {
  const md = renderKeywordMap(input);
  it('renders a row per page, the pairs, the unattributed count and the named pair check', () => {
    expect(md).toContain(
      '| `/blog/sf-alt` | 1658 | 56.96 | screaming frog alternative (828, attributed) | free screaming frog alternative (10) |',
    );
    expect(md).toContain('| `/bot` | 0 | — | — | — |');
    expect(md).toContain(
      '| sitebulb vs screaming frog | 289 | 19.5 | `/blog/sb-vs-sf`, `/blog/sf-vs-sb` |',
    );
    expect(md).toMatch(/1 of 5 queries .* attributed to no page/);
    expect(md).toContain('### `/blog/sf-alt` and `/blog/sb-vs-sf`');
    expect(md).toContain('Queries attributed to both: none.');
  });
  it('lists for the owner each pair of pages sharing at least the threshold of impressions', () => {
    expect(md).toContain(
      '- `/blog/sb-vs-sf` and `/blog/sf-vs-sb` share 289 impressions over 1 query.',
    );
    // "screaming frog" ties all three posts: 7 more for that pair, 7 for each other pair (below 100).
    const tied = renderKeywordMap({
      ...input,
      queries: [...input.queries, ['screaming frog', 0, 7, 50]],
    });
    expect(tied).toContain(
      '- `/blog/sb-vs-sf` and `/blog/sf-vs-sb` share 296 impressions over 2 queries.',
    );
    expect(tied).not.toContain('share 7 impressions');
    expect(
      renderKeywordMap({ ...input, queries: input.queries.filter((q) => q[2] !== 289) }),
    ).toContain('No two pages share');
  });
  it('names no page and no query the data does not hold', () => {
    for (const path of ['/pricing', '/blog/orphan-pages']) expect(md).not.toContain(path);
  });
});
