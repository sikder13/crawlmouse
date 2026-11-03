/**
 * robots_txt_blocks_crawler: robots.txt disallows a crawler on a page whose rules were read for it.
 *
 * A robots.txt disallow is the site's stated intent: until the site can state a per-crawler policy
 * of its own (`Site.crawler_policy`, CC-27), every one is respected intent. The record is `detected`
 * with intent `respected`: the fact the screen states, which never opens a fix on its own and never
 * counts against the site.
 *
 * Which cells show robots.txt was read for the crawler: a search engine's reading says so itself
 * (`not_measured` when it was not evaluated). A worker row says so by its verdict: the worker decides
 * a robots.txt disallow before anything else, so any verdict but `not_measured` is a page robots.txt
 * allowed the crawler on. A `not_measured` row may come before robots.txt was read (unreachable, too
 * large, a budget spent), so it is not counted either way.
 */
import type { CrawlerRegistryEntry } from '@crawlmouse/types/v2';
import { record } from './record.js';
import type { AccessDetection, Cell } from './types.js';

export function detectRobots(entry: CrawlerRegistryEntry, cells: readonly Cell[]): AccessDetection {
  const read = cells.filter((c) => c.verdict !== 'not_measured');
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
  if (disallowed.length === 0)
    return record('robots_txt_blocks_crawler', entry, {
      state: 'not_detected',
      measured: 0,
      confidence: 'confirmed',
      affected: [],
      evidence: [],
    });
  return record('robots_txt_blocks_crawler', entry, {
    state: 'detected',
    measured: disallowed.length / read.length,
    confidence: 'confirmed',
    intent: 'respected',
    affected: disallowed,
    evidence: disallowed,
  });
}
