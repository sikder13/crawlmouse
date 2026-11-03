/**
 * One verdict per crawler for the site, from its cells.
 *
 * 1. No measured cell (the contract's UNMEASURED_VERDICTS): `edge_blocks_automation` when any cell
 *    carries it, otherwise `not_measured`. Never an allow.
 * 2. `disallowed_by_robots` when robots.txt disallows the crawler on each page whose rules were read
 *    (`robotsHolds`): the robots.txt record is detected on the same condition.
 * 3. Otherwise judged on the pages the site answered the crawler on (EDGE_ANSWERED): with none,
 *    rule 1 over the rest. `blocked_by_ua_rule` when no page served the crawler and the user-agent
 *    blocks hold (`uaBlockHolds`), the edge record's condition for detected. Otherwise the verdict
 *    most of those pages carry, the blocks set aside, a tie going to the earlier in TIE_ORDER: the
 *    weaker claim.
 *
 * How many pages each verdict covers is kept in `counts`, so the extent is never lost. The cells that
 * carry the site verdict decide the rest: the cause when they all name the same one, the evidence
 * class, and the status most of them answered with to the crawler's own request (the lower on a tie).
 */
import type { AccessCause, Confidence, CrawlerRegistryEntry, Verdict } from '@crawlmouse/types/v2';
import { byText, sorted } from '../detectors/scope.js';
import type { Cell, CrawlerAccess } from './types.js';
import {
  EDGE_ANSWERED,
  having,
  isMeasured,
  robotsHolds,
  SERVED,
  uaBlockHolds,
} from './verdicts.js';

/** The verdicts a plurality chooses among, the weaker claim first: a tie goes to the earlier. */
export const TIE_ORDER: readonly Verdict[] = [
  'allowed_thin',
  'allowed',
  'rate_limited',
  'redirected_away',
  'payment_required',
  'refused_unverified',
  'challenged_ua',
];

function plurality(verdicts: readonly Verdict[]): Verdict {
  const count = new Map<Verdict, number>();
  for (const v of verdicts) count.set(v, (count.get(v) ?? 0) + 1);
  const most = Math.max(...count.values());
  return TIE_ORDER.find((v) => count.get(v) === most)!;
}

const unmeasured = (cells: readonly Cell[]): Verdict =>
  cells.some((c) => c.verdict === 'edge_blocks_automation')
    ? 'edge_blocks_automation'
    : 'not_measured';

export function siteVerdict(cells: readonly Cell[]): Verdict {
  if (!cells.some((c) => isMeasured(c.verdict))) return unmeasured(cells);
  if (robotsHolds(cells)) return 'disallowed_by_robots';
  const answered = having(cells, EDGE_ANSWERED);
  if (answered.length === 0) return unmeasured(cells);
  if (having(answered, SERVED).length === 0 && uaBlockHolds(answered)) return 'blocked_by_ua_rule';
  // Not empty: with every answer a block and none served, the blocks hold.
  return plurality(
    answered.filter((c) => c.verdict !== 'blocked_by_ua_rule').map((c) => c.verdict),
  );
}

/**
 * `confirmed` only for a verdict robots.txt states, read the same on every page. A verdict that rests
 * on our own requests shows what the tagged request from our address got, not the real crawler,
 * so it is `likely` at most; an unmeasured one is `inconclusive`.
 */
function confidenceOf(verdict: Verdict, cells: readonly Cell[], declared: boolean): Confidence {
  if (!isMeasured(verdict)) return 'inconclusive';
  return declared && cells.every((c) => c.verdict === verdict) ? 'confirmed' : 'likely';
}

function causeOf(deciding: readonly Cell[]): AccessCause | null {
  const first = deciding[0]?.cause ?? null;
  return deciding.every((c) => c.cause === first) ? first : null;
}

/**
 * The status the crawler's own request got: a declared cell's status is the robots.txt read's, so it
 * is not counted, and a verdict robots.txt alone decides has none.
 */
function statusOf(deciding: readonly Cell[]): number | null {
  const count = new Map<number, number>();
  for (const c of deciding)
    if (c.evidence_class !== 'declared' && c.status !== null)
      count.set(c.status, (count.get(c.status) ?? 0) + 1);
  if (count.size === 0) return null;
  const most = Math.max(...count.values());
  return Math.min(...[...count].filter(([, n]) => n === most).map(([s]) => s));
}

function byTemplate(cells: readonly Cell[]): CrawlerAccess['by_template'] {
  const groups = new Map<string, Cell[]>();
  for (const c of cells)
    (groups.get(c.template_key) ?? groups.set(c.template_key, []).get(c.template_key)!).push(c);
  return [...groups.keys()].sort(byText).map((template_key) => {
    const group = groups.get(template_key)!;
    const verdict = siteVerdict(group);
    return { template_key, verdict, status: statusOf(group.filter((c) => c.verdict === verdict)) };
  });
}

export function crawlerAccess(entry: CrawlerRegistryEntry, cells: readonly Cell[]): CrawlerAccess {
  const verdict = siteVerdict(cells);
  const deciding = cells.filter((c) => c.verdict === verdict);
  // A crawler with no cell is read as its kind is: robots.txt for a search engine, requests otherwise.
  const declared =
    deciding.length > 0 ? deciding.every((c) => c.evidence_class === 'declared') : !entry.testable;
  const counts: CrawlerAccess['counts'] = {};
  for (const c of cells) counts[c.verdict] = (counts[c.verdict] ?? 0) + 1;
  return {
    ua: entry.token,
    group: entry.group,
    scored: entry.scored,
    verdict,
    evidence_class: declared ? 'declared' : 'simulated',
    status: statusOf(deciding),
    pages_measured: cells.filter((c) => isMeasured(c.verdict)).length,
    cause: causeOf(deciding),
    confidence: confidenceOf(verdict, cells, declared),
    by_template: byTemplate(cells),
    counts,
    supporting: {
      access_test_ids: sorted(deciding.flatMap((c) => (c.id === null ? [] : [c.id]))),
      pages: sorted(deciding.map((c) => c.page_url)),
    },
    intent: verdict === 'disallowed_by_robots' ? 'respected' : null,
  };
}
