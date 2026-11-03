/**
 * robots_txt_blocks_crawler: robots.txt disallows a crawler on a page whose rules were read for it.
 *
 * A robots.txt disallow is the site's stated intent: until the site can state a per-crawler policy
 * of its own (`Site.crawler_policy`, CC-27), each one is respected intent. The record is `detected`
 * when robots.txt disallows the crawler on one page read or more, with intent `respected`, the share
 * as `measured` and the counts as `extent` ("19 of 20 pages"): the fact the screen states. It opens no
 * fix on its own (record.ts). `not_detected` only when no page read is disallowed. Which cells show
 * robots.txt was read is `robotsRead` (verdicts.ts).
 */
import type { CrawlerRegistryEntry } from '@crawlmouse/types/v2';
import { record } from './record.js';
import type { AccessDetection, Cell } from './types.js';
import { robotsRead } from './verdicts.js';

export function detectRobots(entry: CrawlerRegistryEntry, cells: readonly Cell[]): AccessDetection {
  const read = robotsRead(cells);
  const disallowed = read.filter((c) => c.verdict === 'disallowed_by_robots');
  if (read.length === 0)
    return record('robots_txt_blocks_crawler', entry, {
      state: 'indeterminate',
      reason: 'robots_not_read',
      measured: null,
      extent: null,
      confidence: 'inconclusive',
      affected: [],
      evidence: [],
    });
  const confidence = read.length === cells.length ? 'confirmed' : 'likely';
  const measured = disallowed.length / read.length;
  const extent = { matching: disallowed.length, of: read.length };
  if (disallowed.length === 0)
    return record('robots_txt_blocks_crawler', entry, {
      state: 'not_detected',
      measured,
      extent,
      confidence,
      affected: [],
      evidence: [],
    });
  return record('robots_txt_blocks_crawler', entry, {
    state: 'detected',
    measured,
    extent,
    confidence,
    intent: 'respected',
    affected: disallowed,
    evidence: disallowed,
  });
}
