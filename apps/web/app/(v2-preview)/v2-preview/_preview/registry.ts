/**
 * Every v2 preview page. The index page links these, the visual harness screenshots these, and a
 * test fails if a page exists that is not listed here or an entry has no page.
 */
export interface PreviewEntry {
  path: string;
  name: string;
  kind: 'primitive' | 'screen';
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
  { path: '/v2-preview/screens/result', name: 'Final-Result', kind: 'screen' },
];
