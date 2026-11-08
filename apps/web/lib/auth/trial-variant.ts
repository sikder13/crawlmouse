import type { TrialVariant } from '../billing/state-machine';

/**
 * The Pro trial a new sign-up gets. Every trial is `no_card` until CC-03 ships card collection; then
 * this reads the PostHog flag `pro-trial-variant` (DECISION-LOG U3, a 50/50 split) and nothing else
 * in the flow changes.
 */
export function trialVariantFor(_email: string): Extract<TrialVariant, 'no_card'> {
  return 'no_card';
}
