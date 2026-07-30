import type { AiAccessMatrix, AiBotAccess } from '@crawlmouse/types';
import type { ParsedRobots } from '../../robots.js';
import { isAllowedByRobots } from '../../robots.js';
import { AI_BOT_REGISTRY } from './constants.js';

/**
 * §3 — the whole-site access move. For each AI bot, evaluate the SITE's already-parsed robots.txt against
 * every eligible (200) page's path (zero new fetches) → `allowedPageRatio`. The component subscore is the
 * mean ratio over the RETRIEVAL class only (blocking a search/citation bot costs visibility); training +
 * opt-out tokens are reported in the matrix but NOT scored (blocking them is a legitimate owner policy).
 * No robots.txt ⇒ all ratios 1.0, noted. WAF detection is disclosure-only (§2), never scored.
 */
export function buildAccessMatrix(
  robots: ParsedRobots | null,
  paths: string[],
  wafDetected: boolean,
  wafNote: string | null,
): { matrix: AiAccessMatrix; accessSubscore: number } {
  const bots: AiBotAccess[] = AI_BOT_REGISTRY.map((def) => {
    let ratio = 1;
    if (robots && paths.length > 0) {
      let allowed = 0;
      for (const p of paths) if (isAllowedByRobots(robots, def.token, p)) allowed += 1;
      ratio = allowed / paths.length;
    }
    return {
      token: def.token,
      operator: def.operator,
      botClass: def.botClass,
      allowedPageRatio: ratio,
      fullyBlocked: robots ? ratio === 0 : false,
      note: def.note,
    };
  });

  const retrieval = bots.filter((b) => b.botClass === 'retrieval');
  const accessSubscore =
    retrieval.length === 0 ? 1 : retrieval.reduce((sum, b) => sum + b.allowedPageRatio, 0) / retrieval.length;

  return {
    matrix: { bots, robotsTxtFound: robots !== null, wafDetected, wafNote },
    accessSubscore,
  };
}
