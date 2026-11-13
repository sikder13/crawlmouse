/**
 * How many Inngest functions production registers after each switch-on step, from budget.ts's
 * `FUNCTIONS` and `registered`. The Inngest sync is a manual row (questions.md Q4): the owner compares
 * the count Inngest shows for the app with this one, after the step's redeploy and after a rollback.
 */
import { FUNCTIONS, registered, type Flag } from './budget';
import { STEPS, flagsAfter, type Step } from './steps';

export function functionCountAfter(step: Step): number {
  const on = new Set<Flag>(flagsAfter(step));
  return FUNCTIONS.filter((f) => registered(f, on)).length;
}

/** "1: 4, 2: 8, …": the expected count once each step is done. */
export const functionCountsByStep = (): string =>
  STEPS.map((s) => `after step ${s}: ${functionCountAfter(s)}`).join('; ');
