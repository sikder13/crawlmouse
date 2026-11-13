/**
 * Preconditions decided by the code on `origin/main`, which the git-linked Vercel project deploys to
 * production (PROJECT_OVERVIEW §4). Read from the local clone, so run `git fetch origin` first.
 */
import { fail, pass, unknown, type Probe } from './types';

export const AGENCY_TRIAL_ROUTE = 'apps/web/app/api/billing/agency-trial/route.ts';

/** CC-35 D5: CC-03's direct agency-trial route is not on main. */
export const agencyTrialRemovedProbe: Probe = async (deps) => {
  const head = await deps.git(['rev-parse', '--verify', '--quiet', 'origin/main']);
  if (head.code !== 0) return unknown('origin/main is not in the local clone (git fetch origin)');
  const main = head.stdout.trim().slice(0, 12);
  const found = await deps.git(['cat-file', '-e', `origin/main:${AGENCY_TRIAL_ROUTE}`]);
  return found.code === 0
    ? fail(`${AGENCY_TRIAL_ROUTE} is still on origin/main ${main}`)
    : pass(`${AGENCY_TRIAL_ROUTE} is not on origin/main ${main}`);
};
