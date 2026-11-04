import type { AccessCause, EvidenceClass, Verdict } from '@crawlmouse/types/v2';
import type { ResponseClass, ResponseReading } from './response.js';

/**
 * The decision table: what one tested crawler's verdict is on one sampled page.
 *
 * Inputs are the page's robots reading, the browser control, the crawler's own request, and whether
 * a witness was served on the page. Rows are evaluated top to bottom and the first whose conditions
 * all hold wins. The table is data: the spec (docs/specs/v2/12-crawl-worker.md) is rendered from these
 * rows, and table.test.ts checks every cell reaches exactly one of them.
 *
 * The witness rule (ENGINE-GAP §3.5a). Every identity we send on a page leaves from the same address,
 * so a refusal explained by "this address is not a verified crawler's" hits all of them. A refusal is
 * `blocked_by_ua_rule` when a witness was served on the same page: another tested crawler, or the
 * tagged Googlebot canary. Otherwise it is `refused_unverified`. The browser control is not a
 * witness: it claims to be no crawler, so a site that verifies every crawler's address serves it.
 */

/** A request that was not made appears as `not_requested`. */
export type Observed = ResponseClass | 'not_requested';

export interface Cell {
  /** `blocks_site`: robots.txt keeps the whole batch from fetching (see batch/site-rules.ts). */
  robots: 'readable' | 'blocks_site';
  /** robots.txt allows this crawler's own group on the path. */
  crawlerAllowed: boolean;
  /** robots.txt allows Crawlmouse on the path; every request we make needs it. */
  oursAllowed: boolean;
  control: Observed;
  crawler: Observed;
  /** Another tested crawler, or the tagged Googlebot canary, was served on the page. */
  witnessed: boolean;
  /** Words in the crawler's response and the control's: 0 for a response that is not HTML, null when it could not be read. */
  words: number | null;
  controlWords: number | null;
  /** The crawler's response is of the same media type as the control's (false when either was not served). */
  sameType: boolean;
}

export const THIN_RATIO = 0.8;

export interface Condition {
  text: string;
  holds(c: Cell): boolean;
}

const is = (field: 'control' | 'crawler', label: string, ...values: Observed[]): Condition => ({
  text: `${label} ${values.map((v) => v.replace(/_/g, ' ')).join(' or ')}`,
  holds: (c) => values.includes(c[field]),
});

const robotsBlocksSite: Condition = {
  text: 'robots.txt blocks the site for the batch: unreachable, refused by the SSRF guard, or a Crawl-delay over the limit',
  holds: (c) => c.robots === 'blocks_site',
};
const crawlerDisallowed: Condition = {
  text: "robots.txt disallows the crawler's token on the path",
  holds: (c) => !c.crawlerAllowed,
};
const oursDisallowed: Condition = {
  text: 'robots.txt disallows Crawlmouse on the path',
  holds: (c) => !c.oursAllowed,
};
const controlNotServed: Condition = {
  text: 'control not served',
  holds: (c) => c.control !== 'served',
};
const uncounted: Condition = {
  text: "the crawler's or the control's words could not be counted, or the control had none and the crawler's response is of another type",
  holds: (c) =>
    c.words === null || c.controlWords === null || (c.controlWords === 0 && !c.sameType),
};
const witnessed: Condition = {
  text: 'another tested crawler or the tagged Googlebot canary served on the page',
  holds: (c) => c.witnessed,
};
const thin: Condition = {
  text: `crawler's words under ${THIN_RATIO * 100}% of the control's`,
  holds: (c) =>
    c.words !== null && c.controlWords !== null && c.words < THIN_RATIO * c.controlWords,
};

/** Per-row cause rule: the evidence that names a cause, if any. */
export interface CauseRule {
  text: string;
  of(r: { control: ResponseReading | null; crawler: ResponseReading | null }): AccessCause | null;
}

const fixed = (cause: AccessCause): CauseRule => ({ text: cause, of: () => cause });
const none: CauseRule = { text: '—', of: () => null };
const firewall1020 = (who: 'control' | 'crawler'): CauseRule => ({
  text: `cloudflare_1020 when the ${who}'s body carries error code 1020`,
  of: (r) => (r[who]?.cloudflare1020 ? 'cloudflare_1020' : null),
});

export interface Row {
  id: string;
  when: readonly Condition[];
  verdict: Verdict;
  /** `declared`: the verdict rests on robots.txt alone; `simulated`: on our own request. */
  evidence: EvidenceClass;
  cause: CauseRule;
}

export const DECISION_TABLE: readonly Row[] = [
  {
    id: 'robots_blocks_site',
    when: [robotsBlocksSite],
    verdict: 'not_measured',
    evidence: 'declared',
    cause: none,
  },
  {
    id: 'disallowed',
    when: [crawlerDisallowed],
    verdict: 'disallowed_by_robots',
    evidence: 'declared',
    cause: fixed('robots_txt_disallow'),
  },
  {
    id: 'ours_disallowed',
    when: [oursDisallowed],
    verdict: 'not_measured',
    evidence: 'declared',
    cause: none,
  },
  {
    id: 'control_not_requested',
    when: [is('control', 'control', 'not_requested')],
    verdict: 'not_measured',
    evidence: 'simulated',
    cause: none,
  },
  {
    id: 'control_blocked',
    when: [is('control', 'control', 'challenged', 'refused')],
    verdict: 'edge_blocks_automation',
    evidence: 'simulated',
    cause: {
      text: 'cloudflare_1020 when the control carries error code 1020; automation_challenge when it was challenged',
      of: (r) =>
        r.control?.cloudflare1020
          ? 'cloudflare_1020'
          : r.control?.class === 'challenged'
            ? 'automation_challenge'
            : null,
    },
  },
  {
    id: 'control_unusable',
    when: [controlNotServed],
    verdict: 'not_measured',
    evidence: 'simulated',
    cause: none,
  },
  {
    id: 'crawler_not_requested',
    when: [is('crawler', 'crawler', 'not_requested')],
    verdict: 'not_measured',
    evidence: 'simulated',
    cause: none,
  },
  {
    id: 'served_uncounted',
    when: [is('crawler', 'crawler', 'served'), uncounted],
    verdict: 'not_measured',
    evidence: 'simulated',
    cause: none,
  },
  {
    id: 'served_thin',
    when: [is('crawler', 'crawler', 'served'), thin],
    verdict: 'allowed_thin',
    evidence: 'simulated',
    cause: none,
  },
  {
    id: 'served',
    when: [is('crawler', 'crawler', 'served')],
    verdict: 'allowed',
    evidence: 'simulated',
    cause: none,
  },
  {
    id: 'rate_limited',
    when: [is('crawler', 'crawler', 'rate_limited')],
    verdict: 'rate_limited',
    evidence: 'simulated',
    cause: fixed('rate_limit_429'),
  },
  {
    id: 'payment',
    when: [is('crawler', 'crawler', 'payment')],
    verdict: 'payment_required',
    evidence: 'simulated',
    cause: fixed('pay_per_crawl_402'),
  },
  {
    id: 'redirected_away',
    when: [is('crawler', 'crawler', 'redirected_away')],
    verdict: 'redirected_away',
    evidence: 'simulated',
    cause: fixed('cross_host_redirect'),
  },
  {
    id: 'challenged',
    when: [is('crawler', 'crawler', 'challenged')],
    verdict: 'challenged_ua',
    evidence: 'simulated',
    cause: fixed('automation_challenge'),
  },
  {
    id: 'refused_witnessed',
    when: [is('crawler', 'crawler', 'refused', 'gone'), witnessed],
    verdict: 'blocked_by_ua_rule',
    evidence: 'simulated',
    cause: firewall1020('crawler'),
  },
  {
    id: 'refused',
    when: [is('crawler', 'crawler', 'refused', 'gone')],
    verdict: 'refused_unverified',
    evidence: 'simulated',
    cause: firewall1020('crawler'),
  },
  {
    id: 'crawler_error',
    when: [is('crawler', 'crawler', 'error')],
    verdict: 'not_measured',
    evidence: 'simulated',
    cause: none,
  },
];

/** The first row whose conditions all hold. Throws if none does; table.test.ts proves none is missed. */
export function decide(cell: Cell): Row {
  const row = DECISION_TABLE.find((r) => r.when.every((c) => c.holds(cell)));
  if (!row) throw new Error(`decision table: no row for ${JSON.stringify(cell)}`);
  return row;
}

/** Whether a crawler's response on a page is a refusal, which the witness decides. */
export const isRefusal = (o: Observed): boolean => o === 'refused' || o === 'gone';
