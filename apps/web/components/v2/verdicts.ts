import type { PillState } from './StatusPill';

/**
 * The verdict vocabulary: what one crawler got back from one site (FACTS-proposed.md, I2).
 * The order matches the FACTS line; a test pins it there.
 */
export type Verdict =
  | 'allowed'
  | 'allowed_thin'
  | 'disallowed_by_robots'
  | 'blocked_by_ua_rule'
  | 'challenged_ua'
  | 'refused_unverified'
  | 'rate_limited'
  | 'payment_required'
  | 'edge_blocks_automation'
  | 'redirected_away'
  | 'not_measured';

export interface VerdictStyle {
  state: PillState;
  label: string;
  /**
   * true: the glyph and wording are set by FACTS-proposed.md. false: FACTS leaves them to a later
   * design item (R7 §4); this mapping is proposed and changes here, in one line, on a ruling.
   */
  locked: boolean;
}

/** FACTS: the word "blocked" is used only for disallowed_by_robots and blocked_by_ua_rule. */
export const VERDICTS: Record<Verdict, VerdictStyle> = {
  allowed: { state: 'ok', label: 'allowed', locked: true },
  allowed_thin: { state: 'warn', label: 'allowed, thin', locked: true },
  disallowed_by_robots: { state: 'bad', label: 'blocked by robots.txt', locked: true },
  blocked_by_ua_rule: { state: 'bad', label: 'blocked by a rule', locked: true },
  challenged_ua: {
    state: 'unverified',
    label: 'challenged: the real crawler may pass',
    locked: true,
  },
  refused_unverified: {
    state: 'unverified',
    label: 'challenged: the real crawler may pass',
    locked: true,
  },
  rate_limited: { state: 'warn', label: 'rate limited', locked: false },
  payment_required: { state: 'warn', label: 'payment required', locked: false },
  edge_blocks_automation: { state: 'bad', label: 'refused at the edge', locked: false },
  redirected_away: { state: 'warn', label: 'redirected away', locked: false },
  not_measured: { state: 'neutral', label: 'not measured', locked: false },
};

/** How a verdict is known. Owner ruling, CC-21 decision f. */
export type EvidenceClass = 'declared' | 'simulated' | 'observed';

export const EVIDENCE_CLASSES: Record<EvidenceClass, string> = {
  declared: 'what the site states (robots.txt and similar)',
  simulated: "our own requests sent with the crawler's identity",
  observed: "real crawler traffic from the owner's logs",
};
