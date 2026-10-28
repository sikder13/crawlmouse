import type { PillState } from './pill-states';

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
   * true: FACTS-proposed.md sets this verdict's glyph (line 45 and the I2 vocabulary line). false:
   * FACTS leaves it to a later design item (R7 §4), and this glyph is proposed here.
   */
  glyphFromFacts: boolean;
  /** true: FACTS sets this wording. false: the wording is proposed here. */
  labelFromFacts: boolean;
}

/** FACTS: the word "blocked" is used only for disallowed_by_robots and blocked_by_ua_rule. */
export const VERDICTS: Record<Verdict, VerdictStyle> = {
  allowed: { state: 'ok', label: 'allowed', glyphFromFacts: true, labelFromFacts: false },
  allowed_thin: {
    state: 'warn',
    label: 'allowed, thin',
    glyphFromFacts: true,
    labelFromFacts: false,
  },
  disallowed_by_robots: {
    state: 'bad',
    label: 'blocked by robots.txt',
    glyphFromFacts: true,
    labelFromFacts: false,
  },
  blocked_by_ua_rule: {
    state: 'bad',
    label: 'blocked by a rule',
    glyphFromFacts: true,
    labelFromFacts: false,
  },
  challenged_ua: {
    state: 'unverified',
    label: 'challenged: the real crawler may pass',
    glyphFromFacts: true,
    labelFromFacts: true,
  },
  refused_unverified: {
    state: 'unverified',
    label: 'challenged: the real crawler may pass',
    glyphFromFacts: true,
    labelFromFacts: true,
  },
  rate_limited: {
    state: 'warn',
    label: 'rate limited',
    glyphFromFacts: false,
    labelFromFacts: false,
  },
  payment_required: {
    state: 'warn',
    label: 'payment required',
    glyphFromFacts: false,
    labelFromFacts: false,
  },
  edge_blocks_automation: {
    state: 'bad',
    label: 'refused at the edge',
    glyphFromFacts: false,
    labelFromFacts: false,
  },
  redirected_away: {
    state: 'warn',
    label: 'redirected away',
    glyphFromFacts: false,
    labelFromFacts: false,
  },
  not_measured: {
    state: 'neutral',
    label: 'not measured',
    glyphFromFacts: false,
    labelFromFacts: false,
  },
};

/** How a verdict is known. Owner ruling, CC-21 decision f. */
export type EvidenceClass = 'declared' | 'simulated' | 'observed';

export const EVIDENCE_CLASSES: Record<EvidenceClass, string> = {
  declared: 'what the site states (robots.txt and similar)',
  simulated: "our own requests sent with the crawler's identity",
  observed: "real crawler traffic from the owner's logs",
};
