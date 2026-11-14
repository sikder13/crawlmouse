/**
 * The switch-on steps (CC-35 D4). Step 1 deploys the production worker and sets the app's worker
 * variables; steps 2–5 each set one flag. A precondition gates the earliest step that needs it; what
 * step 1 itself makes true gates step 2 (preconditions.ts).
 */
import { SWITCH_ON, type Flag } from './budget';

export type Step = 1 | 2 | 3 | 4 | 5;
export const STEPS: readonly Step[] = [1, 2, 3, 4, 5];

export const STEP_TITLE: Readonly<Record<Step, string>> = {
  1: 'deploy the production worker, record its egress, set the worker variables',
  2: 'V2_PIPELINE=1',
  3: 'V2_ACCOUNT_DOOR=1',
  4: 'V2_CHECKS_PUBLIC=1',
  5: 'V2_BILLING=1',
};

/** The flag a step sets, or null for step 1. */
export const flagOfStep = (step: Step): Flag | null => (step === 1 ? null : SWITCH_ON[step - 2]!);

/** The flags on once `step` is done: its own and every earlier step's. */
export const flagsAfter = (step: Step): readonly Flag[] => SWITCH_ON.slice(0, step - 1);

export function isStep(n: number): n is Step {
  return Number.isInteger(n) && n >= 1 && n <= 5;
}
