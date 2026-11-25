/**
 * "Fixed, and proven" (Goal 1 row 22): what a fix page says once a re-check has verified the fix.
 * Every number is a parameter, filled from the fix's records (OPERATING-RULES §10). Only stored or
 * measured values are said: pages affected for every fix type, and for an edge rule the AI crawlers
 * that read the text, the engine's stored count before and the verifying check's after. Nothing is
 * estimated.
 */
import { count } from '../words';

export const FIX_PROOF_COPY = {
  title: 'Fixed, and proven',
  pages: (before: number) => `Affected pages: ${count(before)}, now 0`,
  crawlers: (before: number, after: number, of: number) =>
    `AI crawlers that read the text: ${count(before)}, now ${count(after)} of ${count(of)}`,
  rechecked: (date: string) => `Re-checked ${date} · verified`,
  /** Where Free's one proven fix is spent: the counter in the card's place. */
  counter: (shown: number, of: number) =>
    `${count(shown)} of ${count(of)} proven fixes shown on Free · see every one with Pro`,
  upgrade: 'See plans',
} as const;
