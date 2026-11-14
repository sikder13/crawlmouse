/**
 * D3(b): production's Vercel variables, by NAME. Lists the project's variables without `decrypt`,
 * keeps those that target Production on every branch, and compares their names with the names a step
 * requires (env-classes.ts). A deployment keeps the environment it was built with (brief F7), so a
 * required name updated after the live production deployment was created answers `fail` too.
 *
 * The listing answers values for plain-text variables; this probe reads `key`, `target`,
 * `gitBranch`, `updatedAt`, `createdAt` and `pagination.next` only, and the CLI's redactor holds every
 * string the response carried.
 *
 * `liveProject` reads `/v9/projects/<id>` once per run: the live production deployment's creation time
 * and commit (`targets.production.meta.githubCommitSha`), which live.ts gives the git probes.
 */
import { FORBIDDEN_ENV, REQUIRED_ENV } from '../env-classes';
import type { Step } from '../steps';
import { fail, httpFailed, noToken, pass, unknown, type Probe, type ProbeDeps } from './types';

/** Crawlmouse on Vercel (PROJECT_OVERVIEW §9). */
export const VERCEL_PROJECT_ID = 'prj_ZOVjZgG2kU6BzcXyAFutzNpQQXx5';
export const VERCEL_TEAM_ID = 'team_7JoIUGWqgJwobBinsyt2qRKH';
const API = 'https://api.vercel.com';

interface EnvEntry {
  key?: unknown;
  target?: unknown;
  gitBranch?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
}

export interface VercelSnapshot {
  /**
   * Production names, each with its last update in ms since the epoch: `updatedAt`, else `createdAt`,
   * else null (the name cannot be dated, so whether it is in the live deployment is unknown).
   */
  names: ReadonlyMap<string, number | null>;
  /** The live production deployment's creation time, or null when the project did not say. */
  liveCreatedAt: number | null;
}

type Loaded =
  | { ok: true; snapshot: VercelSnapshot }
  | { ok: false; result: ReturnType<typeof unknown> };

const targetsProduction = (t: unknown): boolean =>
  t === 'production' || (Array.isArray(t) && t.includes('production'));

async function load(deps: ProbeDeps): Promise<Loaded> {
  const token = deps.env.VERCEL_TOKEN;
  if (!token) return { ok: false, result: noToken('VERCEL_TOKEN') };
  const headers = { authorization: `Bearer ${token}` };
  const team = `teamId=${VERCEL_TEAM_ID}`;
  const envRes = await deps.fetch(`${API}/v10/projects/${VERCEL_PROJECT_ID}/env?${team}`, {
    headers,
  });
  if (!envRes.ok) return { ok: false, result: httpFailed('Vercel env list', envRes.status) };
  const envBody = (await envRes.json()) as {
    envs?: EnvEntry[];
    pagination?: { next?: unknown } | null;
  };
  if (!Array.isArray(envBody.envs))
    return { ok: false, result: unknown('Vercel env list had no envs array') };
  const next = envBody.pagination?.next;
  if (next !== undefined && next !== null) {
    // A name on a later page would read as missing, and a forbidden one as absent.
    return {
      ok: false,
      result: unknown('the Vercel env list has another page, which the check does not read'),
    };
  }
  const names = new Map<string, number | null>();
  for (const e of envBody.envs) {
    if (typeof e.key !== 'string' || !targetsProduction(e.target)) continue;
    if (typeof e.gitBranch === 'string' && e.gitBranch !== '') continue;
    const at =
      typeof e.updatedAt === 'number'
        ? e.updatedAt
        : typeof e.createdAt === 'number'
          ? e.createdAt
          : null;
    const seen = names.get(e.key);
    names.set(
      e.key,
      seen === undefined ? at : seen === null || at === null ? null : Math.max(at, seen),
    );
  }
  const project = await liveProject(deps);
  if (!project.ok) return project;
  return { ok: true, snapshot: { names, liveCreatedAt: project.live.createdAt } };
}

/** The live production deployment, as the project names it. */
export interface LiveDeployment {
  createdAt: number | null;
  /** `targets.production.meta.githubCommitSha`, or null when not given. */
  commit: string | null;
}

type LoadedProject =
  | { ok: true; live: LiveDeployment }
  | { ok: false; result: ReturnType<typeof unknown> };

async function loadProject(deps: ProbeDeps): Promise<LoadedProject> {
  const token = deps.env.VERCEL_TOKEN;
  if (!token) return { ok: false, result: noToken('VERCEL_TOKEN') };
  const res = await deps.fetch(`${API}/v9/projects/${VERCEL_PROJECT_ID}?teamId=${VERCEL_TEAM_ID}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { ok: false, result: httpFailed('Vercel project', res.status) };
  const project = (await res.json()) as {
    targets?: { production?: { createdAt?: unknown; meta?: { githubCommitSha?: unknown } } };
  };
  const prod = project.targets?.production;
  const created = prod?.createdAt;
  const commit = prod?.meta?.githubCommitSha;
  return {
    ok: true,
    live: {
      createdAt: typeof created === 'number' ? created : null,
      commit: typeof commit === 'string' ? commit : null,
    },
  };
}

const projects = new WeakMap<ProbeDeps, Promise<LoadedProject>>();
/** One project read per run of the check, shared by the env rows and live.ts. */
export const liveProject = (deps: ProbeDeps): Promise<LoadedProject> => {
  let p = projects.get(deps);
  if (!p) {
    p = loadProject(deps);
    projects.set(deps, p);
  }
  return p;
};

/** One listing per run of the check, shared by the five step rows. */
const loaded = new WeakMap<ProbeDeps, Promise<Loaded>>();
const snapshot = (deps: ProbeDeps): Promise<Loaded> => {
  let p = loaded.get(deps);
  if (!p) {
    p = load(deps);
    loaded.set(deps, p);
  }
  return p;
};

/** The names `step` adds to REQUIRED_ENV are set for Production, and none after the live deployment. */
export const vercelEnvProbe =
  (step: Step): Probe =>
  async (deps) => {
    const required = Object.keys(REQUIRED_ENV[step]).sort();
    const forbidden = step === 1 ? Object.keys(FORBIDDEN_ENV).sort() : [];
    if (required.length === 0 && forbidden.length === 0) {
      return pass(`step ${step} adds no required variable`);
    }
    const l = await snapshot(deps);
    if (!l.ok) return l.result;
    const { names, liveCreatedAt } = l.snapshot;
    const present = forbidden.filter((n) => names.has(n));
    if (present.length > 0) return fail(`must not be set for Production: ${present.join(', ')}`);
    const missing = required.filter((n) => !names.has(n));
    if (missing.length > 0) return fail(`not set for Production: ${missing.join(', ')}`);
    if (liveCreatedAt === null) {
      return unknown(
        `all ${required.length} set; the live deployment's creation time was not given`,
      );
    }
    const stale = required.filter((n) => {
      const at = names.get(n);
      return typeof at === 'number' && at > liveCreatedAt;
    });
    if (stale.length > 0) {
      return fail(`set after the live deployment: redeploy (${stale.join(', ')})`);
    }
    const undated = required.filter((n) => names.get(n) === null);
    if (undated.length > 0) return unknown(`no update time given for: ${undated.join(', ')}`);
    return pass(`all ${required.length} set for Production, none after the live deployment`);
  };
