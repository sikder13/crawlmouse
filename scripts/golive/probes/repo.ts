/**
 * Preconditions decided by the code production runs: the commit of the live production deployment
 * (live.ts), read from the local clone with `git ls-tree`. The clone must hold that commit
 * (`git fetch origin`).
 */
import { liveCommit } from './live';
import { fail, pass, unknown, type Probe } from './types';

export const AGENCY_TRIAL_ROUTE = 'apps/web/app/api/billing/agency-trial/route.ts';

/** CC-35 D5: CC-03's direct agency-trial route is not in the code production runs. */
export const agencyTrialRemovedProbe: Probe = async (deps) => {
  const live = await liveCommit(deps);
  if (!live.ok) return live.result;
  const short = live.sha.slice(0, 12);
  const tree = await deps.git(['ls-tree', '--name-only', live.sha, '--', AGENCY_TRIAL_ROUTE]);
  if (tree.code !== 0)
    return unknown(`git ls-tree exited ${tree.code} at the live commit ${short}`);
  return tree.stdout.trim() === ''
    ? pass(`${AGENCY_TRIAL_ROUTE} is not at the live commit ${short}`)
    : fail(`${AGENCY_TRIAL_ROUTE} is still at the live commit ${short}`);
};
