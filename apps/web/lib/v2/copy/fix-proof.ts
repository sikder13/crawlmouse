/**
 * "Fixed, and proven" (Goal 1 row 22): what a fix page says once a re-check has verified the fix.
 * Every number is a parameter, filled from the fix's records (OPERATING-RULES §10). Only the values
 * stored or measured at both checks are said: pages affected for every fix type, and the AI
 * crawlers that read the text for an edge rule, counted at each check alike. Nothing is estimated.
 */
import { count } from '../words';

export const FIX_PROOF_COPY = {
  title: 'Fixed, and proven',
  pages: (before: number) => `Affected pages: ${count(before)}, now 0`,
  crawlers: (before: number, beforeOf: number, after: number, afterOf: number) =>
    `AI crawlers that read the text: ${count(before)} of ${count(beforeOf)}, now ${count(after)} of ${count(afterOf)}`,
  checks: (before: string, after: string) => `Checked ${before}, re-checked ${after} · verified`,
  /** Where Free's one proven fix is spent: the counter in the card's place. */
  counter: (shown: number, of: number) =>
    `${count(shown)} of ${count(of)} proven fixes shown on Free · see every one with Pro`,
  upgrade: 'See plans',
} as const;
