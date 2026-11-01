import { entry, type SegmentInventoryEntry } from './types';

/** What Content an answer engine can quote reads from the check. */
export const CONTENT_INVENTORY: SegmentInventoryEntry[] = [
  entry('content-score', ['content'], 'The content score, in the pill', ['checks[].content.score']),
  entry(
    'content-checks',
    ['content'],
    'Each check’s passing pages by section: the grid, the tiles and the sentences',
    ['checks[].content.checks[].by_template'],
  ),
  entry('content-failing', ['content'], 'The pages in the record that fail the selected check', [
    'page_results[].content_failures',
  ]),
  entry(
    'content-evidence',
    ['content'],
    'The first words a crawler reads of a failing page, rendered',
    ['access_tests[].body_excerpt'],
  ),
  entry('content-tested', ['content'], 'When the pages were measured', ['checks[].tested_at']),
  entry('content-fixes', ['content'], 'The Pro fixes: scope, and the effect still pending', [
    'fixes[].detail',
    'fixes[].effect',
  ]),
];
