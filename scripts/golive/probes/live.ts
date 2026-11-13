/**
 * The commit production runs (review r1 C-B1). The git probes compare against the commit of the live
 * production deployment, read from the Vercel project (`liveProject`), not against a local ref: a
 * clone fetched last week has an `origin/main` production has moved past. When `VERCEL_TOKEN` is
 * absent, Vercel does not name a commit, or the commit is not in the local clone, the answer is
 * `unknown`, never a comparison with something else.
 *
 * The check's own tables come from this checkout (review r2 R2-B1): the variable names a step
 * requires, the price catalog, the worker-input list, the function rows the budget counts. Against a
 * stale checkout those rows would pass on stale requirements, so `checkoutMatchesLive` compares
 * `CHECK_INPUTS` in the working tree with the live commit, and `onLiveInputs` makes a probe answer
 * `unknown` unless they are equal. `CHECK_INPUTS` is held by check-inputs.test.ts to the files the
 * check loads (a walk of its runtime imports from check.ts) and the files those modules read.
 */
import { unknown, type Probe, type ProbeDeps, type ProbeResult } from './types';
import { liveProject } from './vercel-env';

export const LIVE_UNKNOWN_HINT = '(fetch origin / set VERCEL_TOKEN)';
const SHA = /^[0-9a-f]{40}$/;

export type LiveCommit = { ok: true; sha: string } | { ok: false; result: ProbeResult };

const no = (why: string): LiveCommit => ({
  ok: false,
  result: unknown(`${why} ${LIVE_UNKNOWN_HINT}`),
});

async function resolveLive(deps: ProbeDeps): Promise<LiveCommit> {
  if (!deps.env.VERCEL_TOKEN) return no('the live production commit is unknown');
  const project = await liveProject(deps);
  if (!project.ok) return no(`the live production commit is unknown: ${project.result.reason}`);
  const sha = project.live.commit;
  if (sha === null || !SHA.test(sha)) return no('Vercel named no live production commit');
  const known = await deps.git(['cat-file', '-e', `${sha}^{commit}`]);
  if (known.code !== 0)
    return no(`the live production commit ${sha.slice(0, 12)} is not in the local clone`);
  return { ok: true, sha };
}

const cache = new WeakMap<ProbeDeps, Promise<LiveCommit>>();
/** The live production commit, once per run of the check. */
export const liveCommit = (deps: ProbeDeps): Promise<LiveCommit> => {
  let p = cache.get(deps);
  if (!p) {
    p = resolveLive(deps);
    cache.set(deps, p);
  }
  return p;
};

/**
 * The repository paths the check's answers depend on: the modules it loads (scripts/golive and
 * scripts/db as directories, the rest file by file) and the files those modules read from the
 * checkout (the staging workflow's paths list, the migrations directory).
 */
export const CHECK_INPUTS = [
  'scripts/golive',
  'scripts/db',
  'apps/web/lib/billing/catalog.ts',
  'apps/web/lib/billing/prices.ts',
  'inngest/check.ts',
  'inngest/check-events.ts',
  'inngest/client.ts',
  'inngest/concurrency.ts',
  '.github/workflows/worker-staging.yml',
  'infra/supabase/migrations',
] as const;

/** How many differing paths a reason names before it says how many more there are. */
const NAMED = 3;

async function resolveInputs(deps: ProbeDeps): Promise<LiveCommit> {
  const live = await liveCommit(deps);
  if (!live.ok) return live;
  const short = live.sha.slice(0, 12);
  // The working tree against the commit, so an uncommitted edit counts too.
  const diff = await deps.git(['diff', '--name-only', live.sha, '--', ...CHECK_INPUTS]);
  if (diff.code !== 0) {
    return {
      ok: false,
      result: unknown(`git diff exited ${diff.code} comparing this checkout with ${short}`),
    };
  }
  const paths = diff.stdout.split('\n').filter((l) => l.trim() !== '');
  if (paths.length === 0) return live;
  const named = paths.slice(0, NAMED).join(', ');
  const more = paths.length > NAMED ? ` and ${paths.length - NAMED} more` : '';
  const verb = paths.length === 1 ? 'differs' : 'differ';
  return {
    ok: false,
    result: unknown(
      `this checkout's ${named}${more} ${verb} from production's ${short}: check out that commit`,
    ),
  };
}

const inputs = new WeakMap<ProbeDeps, Promise<LiveCommit>>();
/** The live commit when this checkout's `CHECK_INPUTS` equal it, once per run of the check. */
export const checkoutMatchesLive = (deps: ProbeDeps): Promise<LiveCommit> => {
  let p = inputs.get(deps);
  if (!p) {
    p = resolveInputs(deps);
    inputs.set(deps, p);
  }
  return p;
};

/** `probe`, run only when this checkout's inputs equal the live commit's; otherwise why not. */
export const onLiveInputs =
  (probe: Probe): Probe =>
  async (deps) => {
    const match = await checkoutMatchesLive(deps);
    return match.ok ? probe(deps) : match.result;
  };
