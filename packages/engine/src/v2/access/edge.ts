/**
 * edge_rule_blocks_crawler: the site's edge refuses a crawler's user agent while robots.txt allows
 * that crawler and the untagged browser control is served.
 *
 * The worker decides a robots.txt disallow before anything else, and a refusal, a block or a challenge
 * only after the control was served on the page (`packages/worker/src/verdict/table.ts`). So a record
 * here names the edge, with the responses as evidence, and never robots.txt: a page robots.txt
 * disallows is not one the edge was tested on, and a robots.txt cause on any other verdict is refused
 * as input (cells.ts).
 *
 * Judged on the pages the site answered the crawler on (EDGE_ANSWERED). Only a user-agent block
 * counts as blocked; a challenge or an unverified refusal is what the real crawler, from its own
 * addresses, may pass, so the block must outnumber those together (`uaBlockHolds`).
 */
import type { CrawlerRegistryEntry } from '@crawlmouse/types/v2';
import { record } from './record.js';
import { EDGE_CLEAR_SHARE } from './thresholds.js';
import type { AccessDetection, AccessIndeterminateReason, Cell } from './types.js';
import { EDGE_ANSWERED, having, OTHER_ANSWERS, SERVED, uaBlockHolds } from './verdicts.js';

/**
 * Why a record is neither detected nor clear: the group of answers that was not a serve and is as
 * common as the blocks and as each other group, a tie going to the challenges and unverified
 * refusals, and among those to the challenge; otherwise the blocks outnumber both groups.
 */
function bandReason(answered: readonly Cell[]): AccessIndeterminateReason {
  const count = (vs: Parameters<typeof having>[1]) => having(answered, vs).length;
  const blocked = count(['blocked_by_ua_rule']);
  const challenged = count(['challenged_ua']);
  const unverified = count(['refused_unverified']);
  const uncertain = challenged + unverified;
  const other = count(OTHER_ANSWERS);
  if (uncertain > 0 && uncertain >= blocked && uncertain >= other)
    return challenged >= unverified ? 'challenge_real_crawler_may_pass' : 'refusal_unverified';
  if (other > 0 && other >= blocked) return 'edge_answered_otherwise';
  return 'hysteresis_band';
}

export function detectEdge(entry: CrawlerRegistryEntry, cells: readonly Cell[]): AccessDetection {
  const answered = having(cells, EDGE_ANSWERED);
  if (answered.length === 0) {
    const automation = having(cells, ['edge_blocks_automation']);
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
  const blocked = having(answered, ['blocked_by_ua_rule']);
  const notServed = answered.filter((c) => !SERVED.includes(c.verdict));
  const share = blocked.length / answered.length;
  const served = (answered.length - notServed.length) / answered.length;
  // A tagged request from our address shows what it got, not what the real crawler gets: likely at most.
  if (uaBlockHolds(answered))
    return record('edge_rule_blocks_crawler', entry, {
      state: 'detected',
      measured: share,
      confidence: 'likely',
      affected: blocked,
      evidence: blocked,
    });
  if (served >= EDGE_CLEAR_SHARE)
    return record('edge_rule_blocks_crawler', entry, {
      state: 'not_detected',
      measured: share,
      confidence: 'likely',
      affected: [],
      evidence: notServed,
    });
  return record('edge_rule_blocks_crawler', entry, {
    state: 'indeterminate',
    reason: bandReason(answered),
    measured: share,
    confidence: 'inconclusive',
    affected: [],
    evidence: notServed,
  });
}
