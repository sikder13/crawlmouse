import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { REPO_ROOT } from './files';

// The `yaml` package parses YAML 1.2 (core schema) by default, where the key `on` is the string "on",
// as GitHub reads it. A YAML 1.1 parser reads an unquoted `on` as the boolean true, so a check that looked
// for the key "on" would find nothing there and could pass a workflow it never read.

export const WORKFLOWS_DIR = join(REPO_ROOT, '.github', 'workflows');

export const GUARD_NAME = 'Only the owner, dispatching from main';

export type Step = {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, unknown>;
  [key: string]: unknown;
};
export type Job = {
  needs?: string | string[];
  if?: string;
  environment?: string | { name?: string };
  permissions?: unknown;
  uses?: string;
  steps?: Step[];
  [key: string]: unknown;
};
export type Workflow = {
  on?: unknown;
  env?: unknown;
  jobs: Record<string, Job>;
  [key: string]: unknown;
};

export function parseWorkflow(text: string): Workflow {
  return parse(text) as Workflow;
}

export function readWorkflow(file: string): Workflow {
  return parseWorkflow(readFileSync(join(WORKFLOWS_DIR, file), 'utf8'));
}

export function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();
}

/** The events a workflow's `on:` names, in any spelling GitHub accepts: a string, a list or a map. */
export function triggerEvents(on: unknown): string[] {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  if (on !== null && typeof on === 'object') return Object.keys(on);
  return [];
}

/**
 * Problems with a workflow that must start only from a manual dispatch; empty when there are none.
 * Reads every top-level key, so a second spelling of `on` (a YAML 1.1 `true:` key) is not missed.
 */
export function dispatchOnlyProblems(workflow: Workflow): string[] {
  const problems: string[] = [];
  const keys = Object.keys(workflow);
  const triggerKeys = keys.filter((k) => k === 'on' || k === 'true');
  if (triggerKeys.length !== 1 || triggerKeys[0] !== 'on') {
    problems.push(`the trigger keys are [${triggerKeys.join(', ')}], not exactly [on]`);
  }
  const events = triggerEvents(workflow.on);
  if (events.length !== 1 || events[0] !== 'workflow_dispatch') {
    problems.push(`the events are [${events.join(', ')}], not exactly [workflow_dispatch]`);
  }
  return problems;
}

export function needsOf(job: Job): string[] {
  if (job.needs === undefined) return [];
  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

export function environmentName(job: Job): string | undefined {
  const env = job.environment;
  if (env === undefined) return undefined;
  return typeof env === 'string' ? env : env.name;
}

/** True when anything in the value, at any depth, mentions the `secrets` context. */
export function mentionsSecrets(value: unknown): boolean {
  return /\bsecrets\b/.test(JSON.stringify(value ?? null));
}

/** The guard step's env mapping. Every copy must pass exactly these values, and nothing else. */
export const GUARD_ENV = {
  EVENT: '${{ github.event_name }}',
  ACTOR: '${{ github.actor }}',
  TRIGGERING_ACTOR: '${{ github.triggering_actor }}',
  OWNER: '${{ github.repository_owner }}',
  REF: '${{ github.ref }}',
};

/** The only keys a guard step may have: no `if`, `continue-on-error`, `shell`, `id` or anything else. */
export const GUARD_KEYS = ['env', 'name', 'run'];

/** Jobs that can read a secret: bound to an environment, or naming `secrets` anywhere in the job. */
export function secretJobNames(workflow: Workflow): string[] {
  return Object.entries(workflow.jobs ?? {})
    .filter(
      ([name, job]) =>
        name !== 'authorize' && (environmentName(job) !== undefined || mentionsSecrets(job)),
    )
    .map(([name]) => name);
}

function guardStepProblems(where: string, step: Step | undefined): string[] {
  if (step?.name !== GUARD_NAME) return [`${where}: step 0 is not the guard`];
  const problems: string[] = [];
  const keys = Object.keys(step).sort();
  if (JSON.stringify(keys) !== JSON.stringify(GUARD_KEYS)) {
    problems.push(`${where}: the guard step's keys are [${keys.join(', ')}], not [env, name, run]`);
  }
  if (JSON.stringify(step.env) !== JSON.stringify(GUARD_ENV)) {
    problems.push(`${where}: the guard step's env is not the pinned mapping`);
  }
  if (typeof step.run !== 'string' || step.run.includes('${{')) {
    problems.push(`${where}: the guard's run is missing or holds an expression`);
  }
  return problems;
}

/** Any status function in an `if:` lets a job run, or not, regardless of how its needs ended. */
function hasStatusFunction(job: Job): boolean {
  return /\b(?:success|failure|always|cancelled)\s*\(/.test(String(job.if ?? ''));
}

/** The one runner the guarded jobs may use: a GitHub-hosted image, no container, no services. */
export const GUARD_RUNNER = 'ubuntu-24.04';

/** Checks shared by `authorize` and every secret-holding job: what reaches the guard step. */
function guardedJobProblems(name: string, job: Job): string[] {
  const problems: string[] = [];
  // A job-level env reaches every step's process: BASH_ENV, or an exported BASH_FUNC_*, runs code
  // or replaces a builtin before the guard's first line.
  if ('env' in job) problems.push(`${name}: has a job-level env`);
  if ('defaults' in job) problems.push(`${name}: has defaults`);
  if ('continue-on-error' in job) problems.push(`${name}: has continue-on-error`);
  if (job['runs-on'] !== GUARD_RUNNER) problems.push(`${name}: runs-on is not ${GUARD_RUNNER}`);
  if ('container' in job) problems.push(`${name}: has a container`);
  if ('services' in job) problems.push(`${name}: has services`);
  const steps = job.steps ?? [];
  problems.push(...guardStepProblems(name, steps[0]));
  steps.forEach((step, i) => {
    if ('continue-on-error' in step) problems.push(`${name}: step ${i} has continue-on-error`);
  });
  return problems;
}

/**
 * Problems with a production workflow's guard; empty when there are none. Each problem below has a
 * fixture in production-workflows.test.ts. The workflow must:
 * - start only from workflow_dispatch (dispatchOnlyProblems);
 * - have no workflow-level `defaults` or `env`, and no job-level `uses:`;
 * - have an `authorize` job with no environment, no `secrets` mention, `permissions: {}`, no `needs`,
 *   no `if`, and exactly one step;
 * - have at least one secret-holding job, each needing `authorize`, with no status function
 *   (`success(`, `failure(`, `always(`, `cancelled(`) in its `if:`, and no `secrets` mention
 *   outside its steps;
 * - for `authorize` and each secret-holding job: no job-level `env`, `defaults`,
 *   `continue-on-error`, `container` or `services`; `runs-on: ubuntu-24.04`; step 0 the guard with
 *   exactly the keys name, env and run, the pinned env, and a run holding no expression; no
 *   `continue-on-error` on any step;
 * - carry the same guard script in every copy.
 */
export function guardProblems(workflow: Workflow): string[] {
  const problems = [...dispatchOnlyProblems(workflow)];
  if ('defaults' in workflow) problems.push('workflow: has defaults');
  // Workflow-level env reaches every step, the guard included (see guardedJobProblems).
  if ('env' in workflow) problems.push('workflow: has env');

  const jobs = workflow.jobs ?? {};
  for (const [name, job] of Object.entries(jobs)) {
    if (job.uses !== undefined) problems.push(`${name}: calls a reusable workflow`);
  }

  const authorize = jobs.authorize;
  if (!authorize) {
    problems.push('authorize: missing');
  } else {
    if (authorize.environment !== undefined) problems.push('authorize: has an environment');
    if (mentionsSecrets(authorize)) problems.push('authorize: mentions secrets');
    if (JSON.stringify(authorize.permissions) !== '{}')
      problems.push('authorize: permissions are not {}');
    if (needsOf(authorize).length > 0) problems.push('authorize: needs another job');
    if ('if' in authorize) problems.push('authorize: has an if');
    const steps = authorize.steps ?? [];
    if (steps.length !== 1)
      problems.push(`authorize: has ${steps.length} steps, not the guard alone`);
    problems.push(...guardedJobProblems('authorize', authorize));
  }

  const secretJobs = secretJobNames(workflow);
  if (secretJobs.length === 0) problems.push('no job can read a secret (nothing was checked)');
  for (const name of secretJobs) {
    const job = jobs[name]!;
    if (!needsOf(job).includes('authorize')) problems.push(`${name}: does not need authorize`);
    if (hasStatusFunction(job)) problems.push(`${name}: its if calls a status function`);
    problems.push(...guardedJobProblems(name, job));
    const { steps: _steps, ...rest } = job;
    if (mentionsSecrets(rest)) problems.push(`${name}: mentions secrets outside its steps`);
  }

  const scripts = new Set(
    [authorize, ...secretJobs.map((n) => jobs[n])]
      .map((job) => job?.steps?.[0])
      .filter((step) => step?.name === GUARD_NAME)
      .map((step) => step?.run),
  );
  if (scripts.size > 1) problems.push('the guard script differs between copies');
  return problems;
}

/** The environment a job names, lower-cased (GitHub's environment names are case-insensitive). */
export function environmentKey(job: Job): string | undefined {
  return environmentName(job)?.toLowerCase();
}

/**
 * Problems with how a workflow uses environments and permissions; empty when there are none.
 * `production` is bound only by the production workflows, and nowhere else may compute an
 * environment name; `spike` (unused, and without a reviewer once the repository is private) is
 * bound by none. Every workflow declares its top-level permissions.
 */
export function environmentProblems(
  file: string,
  workflow: Workflow,
  productionFiles: readonly string[],
): string[] {
  const problems: string[] = [];
  if (!('permissions' in workflow)) problems.push(`${file}: no top-level permissions`);
  for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
    const env = environmentName(job);
    const key = environmentKey(job);
    if (env === undefined) continue;
    if (!productionFiles.includes(file)) {
      if (key === 'production') problems.push(`${file} ${name}: binds production`);
      if (env.includes('${{')) problems.push(`${file} ${name}: computes its environment name`);
    }
    if (key === 'spike') problems.push(`${file} ${name}: binds spike`);
  }
  return problems;
}
