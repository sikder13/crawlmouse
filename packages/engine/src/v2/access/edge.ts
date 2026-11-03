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
 * Judged on the pages where the crawler's request got an answer (EDGE_ANSWERED). Only a user-agent
 * block counts as blocked; a challenge or an unverified refusal is what the real crawler, from its own
 * addresses, may pass, so a block is detected only when it outnumbers those together.
 */
import type { CrawlerRegistryEntry, Verdict } from '@crawlmouse/types/v2';
import { SERVED, UNCERTAIN } from './matrix.js';
import { record } from './record.js';
import { EDGE_CLEAR_SHARE, EDGE_DETECT_SHARE } from './thresholds.js';
import type { AccessDetection, AccessIndeterminateReason, Cell } from './types.js';

/** Answers that keep the crawler out without being a block or a refusal. */
export const OTHER_ANSWERS: readonly Verdict[] = [
  'rate_limited',
  'payment_required',
  'redirected_away',
];

/** The verdicts that say how the site answered the crawler's own request. */
export const EDGE_ANSWERED: readonly Verdict[] = [
  ...SERVED,
  'blocked_by_ua_rule',
  ...UNCERTAIN,
  ...OTHER_ANSWERS,
];

const having = (cells: readonly Cell[], vs: readonly Verdict[]) =>
  cells.filter((c) => vs.includes(c.verdict));

/**
 * Why neither threshold was met: what most of the pages that were not served got, if that is as
 * common as the blocks; ties go to the challenge, then the unverified refusal.
 */
function bandReason(judged: readonly Cell[]): AccessIndeterminateReason {
  const blocked = having(judged, ['blocked_by_ua_rule']).length;
  const kinds: [AccessIndeterminateReason, number][] = [
    ['challenge_real_crawler_may_pass', having(judged, ['challenged_ua']).length],
    ['refusal_unverified', having(judged, ['refused_unverified']).length],
    ['edge_answered_otherwise', having(judged, OTHER_ANSWERS).length],
  ];
  const most = Math.max(...kinds.map(([, n]) => n));
  const top = kinds.find(([, n]) => n === most)!;
  return most > 0 && most >= blocked ? top[0] : 'hysteresis_band';
}

export function detectEdge(entry: CrawlerRegistryEntry, cells: readonly Cell[]): AccessDetection {
  const judged = having(cells, EDGE_ANSWERED);
  if (judged.length === 0) {
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
  const blocked = having(judged, ['blocked_by_ua_rule']);
  const uncertain = having(judged, UNCERTAIN);
  const notServed = judged.filter((c) => !SERVED.includes(c.verdict));
  const share = blocked.length / judged.length;
  const served = (judged.length - notServed.length) / judged.length;
  // A tagged request from our address shows what it got, not what the real crawler gets: likely at most.
  if (share >= EDGE_DETECT_SHARE && blocked.length > uncertain.length)
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
    reason: bandReason(judged),
    measured: share,
    confidence: 'inconclusive',
    affected: [],
    evidence: notServed,
  });
}
