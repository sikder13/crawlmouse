/**
 * How many functions Inngest lists for production after each switch-on step, from budget.ts's
 * `FUNCTIONS` and `registered`: one per createFunction, and one more for each that declares
 * `onFailure`, which Inngest syncs as a function of its own (`<id>-failure`). The sync is a manual row
 * (questions.md Q4): the owner compares the count Inngest shows for the app with this one, after the
 * step's redeploy and after a rollback.
 */
import { FUNCTIONS, registered, type Flag } from './budget';
import { STEPS, flagsAfter, type Step } from './steps';

/** The functions Inngest lists once `step` is done, failure handlers included. */
export function syncedFunctionCount(step: Step): number {
  const on = new Set<Flag>(flagsAfter(step));
  return FUNCTIONS.filter((f) => registered(f, on)).reduce((n, f) => n + (f.onFailure ? 2 : 1), 0);
}

/** "after step 1: 5; after step 2: 10; …": the expected count once each step is done. */
export const functionCountsByStep = (): string =>
  STEPS.map((s) => `after step ${s}: ${syncedFunctionCount(s)}`).join('; ');
