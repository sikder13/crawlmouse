/**
 * D3(g), the budget half: whether the Hobby plan holds the floor plus 1,000 checks a month under the
 * D2 line (`hobbyVerdict`, budget.ts). The check cannot read which plan the account is on, so once the
 * owner has upgraded, `--ticked inngest-paid-plan` says so. The sync is a manual row (questions.md Q4).
 */
import { HOBBY_HEADROOM_LINE, hobbyVerdict } from '../budget';
import { fail, pass, type Probe } from './types';

export const PAID_PLAN_TICK = 'inngest-paid-plan';

export const inngestBudgetProbe: Probe = async (deps) => {
  const { total, passes } = await hobbyVerdict();
  const figures = `${total.toLocaleString('en-US')} a month against the ${HOBBY_HEADROOM_LINE.toLocaleString('en-US')} line (docs/ops/inngest-budget.md)`;
  if (passes) return pass(`Hobby holds: ${figures}`);
  if (deps.ticked.has(PAID_PLAN_TICK))
    return pass(`Hobby would not hold (${figures}); the paid plan is ticked`);
  return fail(`Hobby does not hold: ${figures}; upgrade, then pass --ticked ${PAID_PLAN_TICK}`);
};
