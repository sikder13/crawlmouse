/**
 * Every v2 preview page. The index page links these, the visual harness screenshots these, and a
 * test fails if a page exists that is not listed here or an entry has no page.
 */
export interface PreviewEntry {
  path: string;
  name: string;
  kind: 'primitive' | 'screen';
  /**
   * For a screen that changes as a recording plays: the moments the visual harness opens it at,
   * as query strings, each with the number of orange elements it shows then (rule 3).
   */
  moments?: { name: string; query: string; orange: 0 | 1 }[];
  /** A screen with no action for the reader shows no orange element; one otherwise. */
  orange?: 0 | 1;
}

export const PREVIEWS: PreviewEntry[] = [
  { path: '/v2-preview/button', name: 'Button', kind: 'primitive' },
  { path: '/v2-preview/status-pill', name: 'StatusPill', kind: 'primitive' },
  { path: '/v2-preview/grade', name: 'Grade', kind: 'primitive' },
  { path: '/v2-preview/verdict-cell', name: 'VerdictCell', kind: 'primitive' },
  { path: '/v2-preview/coverage-line', name: 'CoverageLine', kind: 'primitive' },
  { path: '/v2-preview/card', name: 'Card', kind: 'primitive' },
  { path: '/v2-preview/table', name: 'Table', kind: 'primitive' },
  { path: '/v2-preview/field', name: 'Field', kind: 'primitive' },
  { path: '/v2-preview/page-shell', name: 'PageShell', kind: 'primitive' },
  { path: '/v2-preview/screens/home', name: 'Final-Home', kind: 'screen' },
  {
    path: '/v2-preview/screens/crawl',
    name: 'Final-Crawl',
    kind: 'screen',
    moments: [
      { name: '0-47', query: '?at=47000', orange: 0 },
      { name: '2-08', query: '?at=128000', orange: 0 },
      { name: 'end', query: '?at=end', orange: 1 },
    ],
  },
  {
    path: '/v2-preview/screens/crawl/clean',
    name: 'Crawl, clean re-run',
    kind: 'screen',
    moments: [{ name: 'now', query: '?at=end', orange: 0 }],
  },
  {
    path: '/v2-preview/screens/crawl/challenged',
    name: 'Crawl, challenged',
    kind: 'screen',
    moments: [{ name: 'end', query: '?at=end', orange: 1 }],
  },
  { path: '/v2-preview/screens/result', name: 'Final-Result', kind: 'screen' },
  { path: '/v2-preview/screens/result/clean', name: 'Result, clean bill', kind: 'screen' },
  { path: '/v2-preview/screens/result/challenged', name: 'Result, withheld', kind: 'screen' },
  {
    path: '/v2-preview/screens/result/loading',
    name: 'Result, loading',
    kind: 'screen',
    orange: 0,
  },
  { path: '/v2-preview/screens/result/empty', name: 'Result, not started', kind: 'screen' },
  { path: '/v2-preview/screens/result/error', name: 'Result, failed', kind: 'screen' },
  { path: '/v2-preview/screens/result/expired', name: 'Result, expired', kind: 'screen' },
];
