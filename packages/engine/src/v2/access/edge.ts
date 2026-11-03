/**
 * edge_rule_blocks_crawler: the site's edge refuses a crawler's user agent while robots.txt allows
 * that crawler and the untagged browser control is served.
 *
 * The worker's verdicts already carry both conditions: a refusal, a block or a challenge is decided
 * only after robots.txt allowed the crawler on the page and the control was served there
 * (`packages/worker/src/verdict/table.ts`). So a record here names the edge, with the responses as
 * evidence, and never robots.txt; a page robots.txt disallows is not one the edge was tested on.
 *
 * Judged on the pages where the edge answered the crawler: served, blocked by a user-agent rule,
 * challenged, or refused unverified. Only a user-agent block counts as blocked: a challenge or an
 * unverified refusal is what the real crawler, from its own addresses, may pass.
 */
import type { CrawlerRegistryEntry, Verdict } from '@crawlmouse/types/v2';
import { SERVED } from './matrix.js';
import { record } from './record.js';
import { EDGE_CLEAR_SHARE, EDGE_DETECT_SHARE } from './thresholds.js';
import type { AccessDetection, Cell } from './types.js';

/** The verdicts that say how the edge answered the crawler. */
export const EDGE_JUDGED: readonly Verdict[] = [
  ...SERVED,
  'blocked_by_ua_rule',
  'challenged_ua',
  'refused_unverified',
];

const having = (cells: readonly Cell[], v: Verdict) => cells.filter((c) => c.verdict === v);

export function detectEdge(entry: CrawlerRegistryEntry, cells: readonly Cell[]): AccessDetection {
  const judged = cells.filter((c) => EDGE_JUDGED.includes(c.verdict));
  if (judged.length === 0) {
    const automation = having(cells, 'edge_blocks_automation');
    const reason =
      automation.length > 0
        ? 'edge_blocks_automation'
        : cells.some((c) => c.verdict === 'disallowed_by_robots')
          ? 'robots_disallows'
          : 'not_measured';
    return record('edge_rule_blocks_crawler', entry, {
      state: 'indeterminate',
      reason,
      measured: null,
      confidence: 'inconclusive',
      affected: [],
      evidence: automation,
    });
  }
  const blocked = having(judged, 'blocked_by_ua_rule');
  const refused = judged.filter((c) => !SERVED.includes(c.verdict));
  const share = blocked.length / judged.length;
  const servedShare = (judged.length - refused.length) / judged.length;
  if (share >= EDGE_DETECT_SHARE)
    return record('edge_rule_blocks_crawler', entry, {
      state: 'detected',
      measured: share,
      confidence: share === 1 ? 'confirmed' : 'likely',
      affected: blocked,
      evidence: refused,
    });
  if (servedShare >= EDGE_CLEAR_SHARE)
    return record('edge_rule_blocks_crawler', entry, {
      state: 'not_detected',
      measured: share,
      confidence: servedShare === 1 ? 'confirmed' : 'likely',
      affected: [],
      evidence: refused,
    });
  const challenged = having(judged, 'challenged_ua').length;
  const unverified = having(judged, 'refused_unverified').length;
  return record('edge_rule_blocks_crawler', entry, {
    state: 'indeterminate',
    reason:
      challenged > 0 && challenged >= unverified
        ? 'challenge_real_crawler_may_pass'
        : unverified > 0
          ? 'refusal_unverified'
          : 'hysteresis_band',
    measured: share,
    confidence: 'inconclusive',
    affected: refused,
    evidence: refused,
  });
}
