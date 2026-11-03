/**
 * The independent truth: every expected value below is typed by hand from the rules in the spec
 * (docs/specs/v2/15-access-detectors.md), not computed. Each case gives one crawler's cells on a few
 * pages, the other crawlers being served everywhere, and states what the site verdict, the edge
 * detector and the robots detector must say.
 */
import type { AccessCause, Verdict } from '@crawlmouse/types/v2';
import { describe, expect, it } from 'vitest';
import { grid, type CellSpec } from '../../../fixtures/v2/access/builders.js';
import { detectAccess } from './index.js';

const CRAWLER = 'PerplexityBot';
const pages = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? '/' : `/p/${i}`));

function run(cells: readonly (CellSpec | Verdict)[]) {
  const out = detectAccess(grid({ pages: pages(cells.length), cells: { [CRAWLER]: cells } }));
  const row = out.crawlers.find((c) => c.ua === CRAWLER)!;
  const of = (type: string) =>
    out.detections.find((d) => d.type === type && d.crawler === CRAWLER)!;
  return { row, edge: of('edge_rule_blocks_crawler'), robots: of('robots_txt_blocks_crawler') };
}

const c = (
  verdict: Verdict,
  cause: AccessCause | null = null,
  status?: number | null,
): CellSpec => ({
  verdict,
  cause,
  ...(status === undefined ? {} : { status }),
});
const blocked1020 = c('blocked_by_ua_rule', 'cloudflare_1020');
const challenged = c('challenged_ua', 'automation_challenge');
const disallowed = c('disallowed_by_robots', 'robots_txt_disallow');
const edgeBlocked = c('edge_blocks_automation', 'automation_challenge');

interface SiteCase {
  name: string;
  cells: (CellSpec | Verdict)[];
  verdict: Verdict;
  cause: AccessCause | null;
  status: number | null;
  evidence: 'declared' | 'simulated';
  confidence: 'confirmed' | 'likely' | 'inconclusive';
  measured: number;
  intent?: 'respected';
}

// One case per line, so the table reads as a table.
// prettier-ignore
const SITE: SiteCase[] = [
  { name: 'served everywhere', cells: ['allowed', 'allowed', 'allowed'], verdict: 'allowed', cause: null, status: 200, evidence: 'simulated', confidence: 'confirmed', measured: 3 },
  { name: 'mostly thin', cells: ['allowed', 'allowed_thin', 'allowed_thin'], verdict: 'allowed_thin', cause: null, status: 200, evidence: 'simulated', confidence: 'likely', measured: 3 },
  { name: 'full and thin tied: thin', cells: ['allowed', 'allowed_thin'], verdict: 'allowed_thin', cause: null, status: 200, evidence: 'simulated', confidence: 'likely', measured: 2 },
  { name: 'a firewall rule everywhere', cells: [blocked1020, blocked1020, blocked1020], verdict: 'blocked_by_ua_rule', cause: 'cloudflare_1020', status: 403, evidence: 'simulated', confidence: 'confirmed', measured: 3 },
  { name: 'blocked everywhere, the cause on two of three', cells: [blocked1020, c('blocked_by_ua_rule'), blocked1020], verdict: 'blocked_by_ua_rule', cause: null, status: 403, evidence: 'simulated', confidence: 'confirmed', measured: 3 },
  { name: 'blocked on two, served on one: never blocked', cells: [blocked1020, blocked1020, 'allowed'], verdict: 'allowed', cause: null, status: 200, evidence: 'simulated', confidence: 'likely', measured: 3 },
  { name: 'disallowed on two, served on one: never blocked', cells: [disallowed, disallowed, 'allowed'], verdict: 'allowed', cause: null, status: 200, evidence: 'simulated', confidence: 'likely', measured: 3 },
  { name: 'robots.txt disallows everywhere', cells: [disallowed, disallowed, disallowed], verdict: 'disallowed_by_robots', cause: 'robots_txt_disallow', status: null, evidence: 'declared', confidence: 'confirmed', measured: 3, intent: 'respected' },
  { name: 'challenged on two, served on one', cells: [challenged, challenged, 'allowed'], verdict: 'challenged_ua', cause: 'automation_challenge', status: 403, evidence: 'simulated', confidence: 'likely', measured: 3 },
  { name: 'refused unverified everywhere', cells: ['refused_unverified', 'refused_unverified', 'refused_unverified'], verdict: 'refused_unverified', cause: null, status: 403, evidence: 'simulated', confidence: 'likely', measured: 3 },
  { name: 'rate limited everywhere', cells: [c('rate_limited', 'rate_limit_429'), c('rate_limited', 'rate_limit_429')], verdict: 'rate_limited', cause: 'rate_limit_429', status: 429, evidence: 'simulated', confidence: 'confirmed', measured: 2 },
  { name: 'pay per crawl everywhere', cells: [c('payment_required', 'pay_per_crawl_402'), c('payment_required', 'pay_per_crawl_402')], verdict: 'payment_required', cause: 'pay_per_crawl_402', status: 402, evidence: 'simulated', confidence: 'confirmed', measured: 2 },
  { name: 'redirected on two, rate limited on one', cells: [c('redirected_away', 'cross_host_redirect'), c('redirected_away', 'cross_host_redirect'), c('rate_limited', 'rate_limit_429')], verdict: 'redirected_away', cause: 'cross_host_redirect', status: 302, evidence: 'simulated', confidence: 'likely', measured: 3 },
  { name: 'nothing measured', cells: ['not_measured', 'not_measured'], verdict: 'not_measured', cause: null, status: null, evidence: 'simulated', confidence: 'inconclusive', measured: 0 },
  { name: 'the edge blocks automation on two, nothing measured on one', cells: [edgeBlocked, edgeBlocked, 'not_measured'], verdict: 'edge_blocks_automation', cause: 'automation_challenge', status: 403, evidence: 'simulated', confidence: 'inconclusive', measured: 0 },
  { name: 'blocked and challenged tied: the weaker claim', cells: [blocked1020, challenged], verdict: 'challenged_ua', cause: 'automation_challenge', status: 403, evidence: 'simulated', confidence: 'likely', measured: 2 },
  { name: 'blocked and disallowed tied: robots.txt', cells: [blocked1020, disallowed], verdict: 'disallowed_by_robots', cause: 'robots_txt_disallow', status: null, evidence: 'declared', confidence: 'likely', measured: 2, intent: 'respected' },
  { name: 'refused unverified and rate limited tied: rate limited', cells: ['refused_unverified', c('rate_limited', 'rate_limit_429')], verdict: 'rate_limited', cause: 'rate_limit_429', status: 429, evidence: 'simulated', confidence: 'likely', measured: 2 },
  { name: 'served on the one measured page', cells: ['not_measured', 'allowed'], verdict: 'allowed', cause: null, status: 200, evidence: 'simulated', confidence: 'confirmed', measured: 1 },
  { name: 'the deciding status is the commonest', cells: [c('refused_unverified', null, 403), c('refused_unverified', null, 401), c('refused_unverified', null, 401)], verdict: 'refused_unverified', cause: null, status: 401, evidence: 'simulated', confidence: 'likely', measured: 3 },
  { name: 'tied statuses: the lower', cells: [c('refused_unverified', null, 403), c('refused_unverified', null, 401)], verdict: 'refused_unverified', cause: null, status: 401, evidence: 'simulated', confidence: 'likely', measured: 2 },
];

describe('the site verdict, from one crawler’s cells', () => {
  it.each(SITE)('$name', (t) => {
    const { row } = run(t.cells);
    expect({
      verdict: row.verdict,
      cause: row.cause,
      status: row.status,
      evidence_class: row.evidence_class,
      confidence: row.confidence,
      pages_measured: row.pages_measured,
      intent: row.intent,
    }).toEqual({
      verdict: t.verdict,
      cause: t.cause,
      status: t.status,
      evidence_class: t.evidence,
      confidence: t.confidence,
      pages_measured: t.measured,
      intent: t.intent ?? null,
    });
  });
});

interface DetectorCase {
  name: string;
  cells: (CellSpec | Verdict)[];
  state: 'detected' | 'not_detected' | 'indeterminate';
  reason: string | null;
  measured: number | null;
  confidence: 'confirmed' | 'likely' | 'inconclusive';
  opens_fix?: boolean;
  affected?: number;
}

const n = (k: number, cell: CellSpec | Verdict) => Array.from({ length: k }, () => cell);

// prettier-ignore
const EDGE: DetectorCase[] = [
  { name: 'served everywhere', cells: n(3, 'allowed'), state: 'not_detected', reason: null, measured: 0, confidence: 'confirmed', affected: 0 },
  { name: 'blocked everywhere', cells: n(3, blocked1020), state: 'detected', reason: null, measured: 1, confidence: 'confirmed', opens_fix: true, affected: 3 },
  { name: 'blocked on two of three', cells: [blocked1020, blocked1020, 'allowed'], state: 'detected', reason: null, measured: 2 / 3, confidence: 'likely', opens_fix: true, affected: 2 },
  { name: 'blocked on half: detected (at the threshold)', cells: [blocked1020, 'allowed'], state: 'detected', reason: null, measured: 0.5, confidence: 'likely', opens_fix: true, affected: 1 },
  { name: 'blocked on one of three: between the thresholds', cells: [blocked1020, 'allowed', 'allowed'], state: 'indeterminate', reason: 'hysteresis_band', measured: 1 / 3, confidence: 'inconclusive', affected: 1 },
  { name: 'served on 19 of 20: clear (at the threshold)', cells: [blocked1020, ...n(19, 'allowed')], state: 'not_detected', reason: null, measured: 0.05, confidence: 'likely', affected: 0 },
  { name: 'served on 18 of 20, blocked on 2: between the thresholds', cells: [blocked1020, blocked1020, ...n(18, 'allowed')], state: 'indeterminate', reason: 'hysteresis_band', measured: 0.1, confidence: 'inconclusive', affected: 2 },
  { name: 'challenged on 2 of 20', cells: [challenged, challenged, ...n(18, 'allowed')], state: 'indeterminate', reason: 'challenge_real_crawler_may_pass', measured: 0, confidence: 'inconclusive', affected: 2 },
  { name: 'challenged everywhere: never blocked', cells: n(3, challenged), state: 'indeterminate', reason: 'challenge_real_crawler_may_pass', measured: 0, confidence: 'inconclusive', affected: 3 },
  { name: 'refused unverified everywhere: never blocked', cells: n(3, 'refused_unverified'), state: 'indeterminate', reason: 'refusal_unverified', measured: 0, confidence: 'inconclusive', affected: 3 },
  { name: 'challenged and refused tied: the challenge', cells: [challenged, 'refused_unverified', 'allowed'], state: 'indeterminate', reason: 'challenge_real_crawler_may_pass', measured: 0, confidence: 'inconclusive', affected: 2 },
  { name: 'refused on two, challenged on one', cells: ['refused_unverified', 'refused_unverified', challenged], state: 'indeterminate', reason: 'refusal_unverified', measured: 0, confidence: 'inconclusive', affected: 3 },
  { name: 'robots.txt disallows everywhere: the edge was not tested', cells: n(3, disallowed), state: 'indeterminate', reason: 'robots_disallows', measured: null, confidence: 'inconclusive', affected: 0 },
  { name: 'the edge blocks automation everywhere', cells: n(3, edgeBlocked), state: 'indeterminate', reason: 'edge_blocks_automation', measured: null, confidence: 'inconclusive', affected: 0 },
  { name: 'the edge blocks automation, robots.txt disallows elsewhere', cells: [edgeBlocked, disallowed], state: 'indeterminate', reason: 'edge_blocks_automation', measured: null, confidence: 'inconclusive', affected: 0 },
  { name: 'nothing measured', cells: n(3, 'not_measured'), state: 'indeterminate', reason: 'not_measured', measured: null, confidence: 'inconclusive', affected: 0 },
  { name: 'only rate limited and paid: not an answer about the edge rule', cells: [c('rate_limited', 'rate_limit_429'), c('payment_required', 'pay_per_crawl_402')], state: 'indeterminate', reason: 'not_measured', measured: null, confidence: 'inconclusive', affected: 0 },
  { name: 'blocked on two, disallowed on one: judged on the two', cells: [blocked1020, blocked1020, disallowed], state: 'detected', reason: null, measured: 1, confidence: 'confirmed', opens_fix: true, affected: 2 },
];

describe('edge_rule_blocks_crawler, from one crawler’s cells', () => {
  it.each(EDGE)('$name', (t) => {
    const { edge } = run(t.cells);
    expect({
      state: edge.state,
      reason: edge.reason,
      measured: edge.measured,
      confidence: edge.confidence,
      opens_fix: edge.opens_fix,
      affected: edge.affected_urls.length,
      recommendation_class: edge.recommendation_class,
      intent: edge.intent,
    }).toEqual({
      state: t.state,
      reason: t.reason,
      measured: t.measured === null ? null : expect.closeTo(t.measured, 12),
      confidence: t.confidence,
      opens_fix: t.opens_fix ?? false,
      affected: t.affected,
      recommendation_class: 'confirmed_defect',
      intent: null,
    });
  });
});

// prettier-ignore
const ROBOTS: DetectorCase[] = [
  { name: 'allowed everywhere', cells: n(3, 'allowed'), state: 'not_detected', reason: null, measured: 0, confidence: 'confirmed', affected: 0 },
  { name: 'disallowed everywhere: respected intent', cells: n(3, disallowed), state: 'detected', reason: null, measured: 1, confidence: 'confirmed', affected: 3 },
  { name: 'disallowed on one of three', cells: [disallowed, 'allowed', 'allowed'], state: 'detected', reason: null, measured: 1 / 3, confidence: 'confirmed', affected: 1 },
  { name: 'no rules read for it anywhere', cells: n(3, c('not_measured', null, null)), state: 'indeterminate', reason: 'robots_not_read', measured: null, confidence: 'inconclusive', affected: 0 },
  { name: 'disallowed on the one page read', cells: ['not_measured', 'not_measured', disallowed], state: 'detected', reason: null, measured: 1, confidence: 'confirmed', affected: 1 },
  { name: 'the edge blocked our requests: robots.txt was read and allows it', cells: n(3, edgeBlocked), state: 'not_detected', reason: null, measured: 0, confidence: 'confirmed', affected: 0 },
  { name: 'challenged: robots.txt was read and allows it', cells: n(3, challenged), state: 'not_detected', reason: null, measured: 0, confidence: 'confirmed', affected: 0 },
];

describe('robots_txt_blocks_crawler, from one crawler’s cells', () => {
  it.each(ROBOTS)('$name', (t) => {
    const { robots } = run(t.cells);
    expect({
      state: robots.state,
      reason: robots.reason,
      measured: robots.measured,
      confidence: robots.confidence,
      affected: robots.affected_urls.length,
      intent: robots.intent,
      opens_fix: robots.opens_fix,
      recommendation_class: robots.recommendation_class,
    }).toEqual({
      state: t.state,
      reason: t.reason,
      measured: t.measured === null ? null : expect.closeTo(t.measured, 12),
      confidence: t.confidence,
      affected: t.affected,
      intent: t.state === 'detected' ? 'respected' : null,
      opens_fix: false,
      recommendation_class: 'documented_requirement',
    });
  });
});
