/**
 * D3(g), the budget half: whether the plan holds the floor plus 1,000 checks a month under the D2
 * line (`planVerdict`, budget.ts). The check cannot read which plan the account is on: budget.ts states
 * it, and `--ticked inngest-paid-plan` still lets the owner accept a total over the line. The sync is a manual row (questions.md Q4).
 */
import { PLAN_HEADROOM_LINE, planVerdict } from '../budget';
import { fail, pass, type Probe } from './types';

export const PAID_PLAN_TICK = 'inngest-paid-plan';

export const inngestBudgetProbe: Probe = async (deps) => {
  const { total, passes } = await planVerdict();
  const figures = `${total.toLocaleString('en-US')} a month against the ${PLAN_HEADROOM_LINE.toLocaleString('en-US')} line (docs/ops/inngest-budget.md)`;
  if (passes) return pass(`Pro holds: ${figures}`);
  if (deps.ticked.has(PAID_PLAN_TICK))
    return pass(`Pro would not hold (${figures}); the owner has accepted it`);
  return fail(
    `Pro does not hold: ${figures}; the owner decides, then pass --ticked ${PAID_PLAN_TICK}`,
  );
};
