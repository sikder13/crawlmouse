/**
 * The commit production runs (review r1 C-B1). The git probes compare against the commit of the live
 * production deployment, read from the Vercel project (`liveProject`), not against a local ref: a
 * clone fetched last week has an `origin/main` production has moved past. When `VERCEL_TOKEN` is
 * absent, Vercel does not name a commit, or the commit is not in the local clone, the answer is
 * `unknown`, never a comparison with something else.
 */
import { unknown, type ProbeDeps, type ProbeResult } from './types';
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
