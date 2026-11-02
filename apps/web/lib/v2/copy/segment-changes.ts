/**
 * Final-Seg-Changes: where the rebuilt page's text differs from the locked HTML, and why. Applied
 * in order by the lock comparison (__tests__/v2/segment-changes.test.tsx).
 */
import type { Addition, CopyChange } from '../copy-registry';

export const CHANGES_CHANGES: CopyChange[] = [
  {
    screen: 'segment-changes',
    kind: 'facts',
    locked: 'AI visibility D · 41',
    rendered: 'AI readability D · 41',
    source: 'FACTS A1 (the audit history, FACTS-proposed line 94)',
  },
];

export const CHANGES_ADDITIONS: Addition[] = [
  {
    screen: 'segment-changes',
    what: 'The coverage line (what the page compares with), and the audit history’s column names once it holds two audits or more',
    source: 'CC-23 brief, scope 2',
  },
  {
    screen: 'segment-changes',
    what: 'After a re-check: the check’s own changes, with pages affected, the crawler’s verdict, the robots.txt lines and who was told',
    source: 'CC-23 brief, scope 6',
  },
];
