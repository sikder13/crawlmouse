/**
 * D3(d): the production worker. Two rows: `/healthz` at the production URL answers 200 `{"ok":true}`,
 * and the release the machines run is the worker build of `origin/main`.
 *
 * The worker's `/healthz` reports no release (questions.md Q1), so the release is read from the Fly
 * Machines API with a read-only token (`FLY_READ_TOKEN`): `worker-production.yml` deploys with
 * `--image-label <commit sha>`, so each machine's image tag is the commit it was built from. The
 * release is current when no worker-input path changed between that commit and `origin/main`; the
 * paths are the staging workflow's `on.push.paths`, the list that decides when a worker is rebuilt.
 *
 * The URL and the app come from the constant `WORKER_APP`, never from `CRAWL_WORKER_URL`, which in
 * `scripts/.env.local` names the staging worker (plan review B4).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { REPO_ROOT } from '../env-scan';
import { fail, httpFailed, noToken, pass, unknown, type Probe } from './types';

/** `app` in packages/worker/fly.production.toml (worker-files.test.ts holds the two equal). */
export const WORKER_APP = 'crawlmouse-worker';
export const WORKER_URL = `https://${WORKER_APP}.fly.dev`;
const MACHINES_API = 'https://api.machines.dev/v1';

export const healthzProbe: Probe = async (deps) => {
  let res: Response;
  try {
    res = await deps.fetch(`${WORKER_URL}/healthz`);
  } catch {
    return fail(`${WORKER_URL}/healthz did not answer`);
  }
  if (res.status !== 200) return fail(`${WORKER_URL}/healthz answered HTTP ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return fail(`${WORKER_URL}/healthz answered 200 with a body that is not JSON`);
  }
  const ok = (body as { ok?: unknown } | null)?.ok === true;
  return ok
    ? pass(`${WORKER_URL}/healthz answered 200 ok`)
    : fail(`${WORKER_URL}/healthz answered 200 without ok: true`);
};

/** The worker-input paths: `.github/workflows/worker-staging.yml` `on.push.paths`. */
export function workerInputPaths(root = REPO_ROOT): string[] {
  const wf = parse(readFileSync(join(root, '.github/workflows/worker-staging.yml'), 'utf8')) as {
    on?: { push?: { paths?: unknown } };
  };
  const paths = wf.on?.push?.paths;
  if (!Array.isArray(paths) || paths.length === 0 || !paths.every((p) => typeof p === 'string')) {
    throw new Error('worker-staging.yml has no on.push.paths list');
  }
  return paths as string[];
}

const SHA = /^[0-9a-f]{40}$/;

interface Machine {
  state?: unknown;
  image_ref?: { tag?: unknown };
}

export const releaseProbe =
  (paths: () => string[] = () => workerInputPaths()): Probe =>
  async (deps) => {
    const token = deps.env.FLY_READ_TOKEN;
    if (!token) return noToken('FLY_READ_TOKEN');
    const res = await deps.fetch(`${MACHINES_API}/apps/${WORKER_APP}/machines`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return httpFailed('Fly Machines API', res.status);
    const machines = (await res.json()) as Machine[];
    if (!Array.isArray(machines) || machines.length === 0)
      return fail(`${WORKER_APP} has no machines`);
    const started = machines.filter((m) => m.state === 'started');
    if (started.length === 0)
      return fail(`${WORKER_APP} has ${machines.length} machines, none started`);
    const tags = new Set(started.map((m) => m.image_ref?.tag));
    if (tags.size !== 1)
      return fail(`${started.length} started machines run ${tags.size} different images`);
    const tag = [...tags][0];
    if (typeof tag !== 'string' || !SHA.test(tag)) {
      return fail(
        'the running image is not labelled with a commit (deploy through worker-production.yml)',
      );
    }
    const short = tag.slice(0, 12);
    const head = await deps.git(['rev-parse', '--verify', '--quiet', 'origin/main']);
    if (head.code !== 0) return unknown('origin/main is not in the local clone (git fetch origin)');
    const known = await deps.git(['cat-file', '-e', `${tag}^{commit}`]);
    if (known.code !== 0)
      return unknown(`the running commit ${short} is not in the local clone (git fetch origin)`);
    const diff = await deps.git(['diff', '--quiet', tag, 'origin/main', '--', ...paths()]);
    const main = head.stdout.trim().slice(0, 12);
    if (diff.code === 0)
      return pass(`running ${short}; no worker input changed up to origin/main ${main}`);
    if (diff.code === 1)
      return fail(`running ${short}; worker inputs changed up to origin/main ${main}: redeploy`);
    return unknown(`git diff exited ${diff.code}`);
  };
