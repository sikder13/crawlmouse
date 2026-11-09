/**
 * checkSteps(deps): the step bodies checkFn runs (inngest/check.ts CheckSteps), built from a store,
 * the evidence bucket, the worker client, the engine and a clock.
 */
import type { CheckSteps } from '../../../../../../inngest/check';
import { batchSteps } from './batches';
import type { StepDeps } from './deps';
import { finishSteps } from './finish';
import { lifecycleSteps } from './lifecycle';

export { NO_DAILY_BUDGET, type StepDeps } from './deps';
export { failCancelled, failCheck, reapCutoff, reapStalled } from './lifecycle';

export function checkSteps(deps: StepDeps): CheckSteps {
  return { ...lifecycleSteps(deps), ...batchSteps(deps), ...finishSteps(deps) };
}
