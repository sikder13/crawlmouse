import type { CrawlerResult, Verdict } from '@crawlmouse/types/v2';
import type { CheckGlyphCell } from '../../CheckGlyphRow';
import { VERDICTS } from '../../verdicts';
import { readRuns } from '../../../../lib/v2/view/checks';

/**
 * A verdict as a crawler cell names it (FACTS I2): the shared VERDICTS words, and for Google and
 * Bing, which are read from robots.txt and never fetched, "allowed by robots.txt" (FACTS B2).
 */
export function verdictCell(
  verdict: Verdict | null,
  group: CrawlerResult['group'],
): CheckGlyphCell {
  if (verdict === null) return { state: 'neutral', label: 'not tested', verdict: null };
  const v = VERDICTS[verdict];
  const label =
    group === 'search_engine' && verdict === 'allowed' ? 'allowed by robots.txt' : v.label;
  return { state: v.state, label, verdict };
}

/** "allowed, thin at checks 1 to 5, then blocked by robots.txt at check 6". */
export const spokenRun = (cells: readonly CheckGlyphCell[]) => readRuns(cells.map((c) => c.label));
