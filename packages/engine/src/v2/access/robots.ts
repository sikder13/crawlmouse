/**
 * robots_txt_blocks_crawler: robots.txt disallows a crawler on each page whose rules were read for it.
 *
 * A robots.txt disallow is the site's stated intent: until the site can state a per-crawler policy
 * of its own (`Site.crawler_policy`, CC-27), each one is respected intent. The record is `detected`
 * with intent `respected`, the fact the screen states, and `opens_fix` false (record.ts). A disallow
 * on some of the pages read and not others (a `/cart` rule, say) does not block the crawler from the
 * site: `not_detected`, with the disallowed share as `measured` and the disallowed pages as evidence.
 *
 * Which cells show robots.txt was read for the crawler is `robotsRead` (verdicts.ts); the detected
 * condition, `robotsHolds`, is the matrix's for `disallowed_by_robots` too.
 */
import type { CrawlerRegistryEntry } from '@crawlmouse/types/v2';
import { record } from './record.js';
import type { AccessDetection, Cell } from './types.js';
import { robotsHolds, robotsRead } from './verdicts.js';

export function detectRobots(entry: CrawlerRegistryEntry, cells: readonly Cell[]): AccessDetection {
  const read = robotsRead(cells);
  const disallowed = read.filter((c) => c.verdict === 'disallowed_by_robots');
  if (read.length === 0)
    return record('robots_txt_blocks_crawler', entry, {
      state: 'indeterminate',
      reason: 'robots_not_read',
      measured: null,
      confidence: 'inconclusive',
      affected: [],
      evidence: [],
    });
  const confidence = read.length === cells.length ? 'confirmed' : 'likely';
  const measured = disallowed.length / read.length;
  if (!robotsHolds(cells))
    return record('robots_txt_blocks_crawler', entry, {
      state: 'not_detected',
      measured,
      confidence,
      affected: [],
      evidence: disallowed,
    });
  return record('robots_txt_blocks_crawler', entry, {
    state: 'detected',
    measured,
    confidence,
    intent: 'respected',
    affected: disallowed,
    evidence: disallowed,
  });
}
