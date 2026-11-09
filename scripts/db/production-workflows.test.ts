import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  GUARD_NAME,
  dispatchOnlyProblems,
  environmentName,
  mentionsSecrets,
  needsOf,
  parseWorkflow,
  readWorkflow,
  triggerEvents,
  workflowFiles,
  type Job,
  type Step,
} from './workflow-file';

// The two workflows that can reach production. On a private repository under a personal GitHub Pro
// account the `production` environment's required reviewer is not enforced, so what stands between
// a run and the production secrets is: dispatch-only triggers, an `authorize` job every secret-holding
// job needs, and the same guard as the first step of each of those jobs (a re-run of a failed job does
// not re-run a passed `authorize`). These tests read the parsed files and execute the guard's script.
const PRODUCTION_WORKFLOWS = ['db-apply-prod.yml', 'db-rollback-prod.yml'] as const;

const GUARD_ENV = {
  EVENT: '${{ github.event_name }}',
  ACTOR: '${{ github.actor }}',
  TRIGGERING_ACTOR: '${{ github.triggering_actor }}',
  OWNER: '${{ github.repository_owner }}',
  REF: '${{ github.ref }}',
};

function jobsOf(file: string): [string, Job][] {
  return Object.entries(readWorkflow(file).jobs);
}

/** Jobs that can read a secret: bound to an environment, or naming `secrets` anywhere in the job. */
function secretJobs(file: string): [string, Job][] {
  return jobsOf(file).filter(
    ([name, job]) =>
      name !== 'authorize' && (environmentName(job) !== undefined || mentionsSecrets(job)),
  );
}

function guardSteps(): { where: string; step: Step }[] {
  const out: { where: string; step: Step }[] = [];
  for (const file of PRODUCTION_WORKFLOWS) {
    for (const [name, job] of jobsOf(file)) {
      for (const step of job.steps ?? []) {
        if (step.name === GUARD_NAME) out.push({ where: `${file} ${name}`, step });
      }
    }
  }
  return out;
}

function runGuard(script: string, env: Record<string, string | undefined>) {
  const defined = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
  return spawnSync('bash', ['-c', script], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...defined },
    encoding: 'utf8',
  });
}

const PASSING = {
  EVENT: 'workflow_dispatch',
  ACTOR: 'sikder13',
  TRIGGERING_ACTOR: 'sikder13',
  OWNER: 'sikder13',
  REF: 'refs/heads/main',
};

describe('the dispatch-only check, over the spellings of `on`', () => {
  it('accepts workflow_dispatch alone, as a map, a string and a one-item list', () => {
    for (const text of [
      'on:\n  workflow_dispatch:\n    inputs: {}\njobs: {}\n',
      'on: workflow_dispatch\njobs: {}\n',
      'on: [workflow_dispatch]\njobs: {}\n',
      '"on":\n  workflow_dispatch:\njobs: {}\n',
    ]) {
      expect(dispatchOnlyProblems(parseWorkflow(text)), text).toEqual([]);
    }
  });

  it.each([
    ['a string', 'on: push\njobs: {}\n'],
    ['a list', 'on: [push, workflow_dispatch]\njobs: {}\n'],
    ['a map', 'on:\n  push:\n    branches: [main]\n  workflow_dispatch:\njobs: {}\n'],
    ['a quoted key', '"on":\n  push:\n  workflow_dispatch:\njobs: {}\n'],
    ['workflow_call', 'on:\n  workflow_call:\n  workflow_dispatch:\njobs: {}\n'],
    ['repository_dispatch', 'on:\n  repository_dispatch:\n  workflow_dispatch:\njobs: {}\n'],
    ['schedule', "on:\n  schedule:\n    - cron: '0 3 * * *'\n  workflow_dispatch:\njobs: {}\n"],
    ['a YAML 1.1 `true:` key beside `on`', 'on: workflow_dispatch\ntrue: push\njobs: {}\n'],
    ['a YAML 1.1 `true:` key alone', 'true:\n  workflow_dispatch:\njobs: {}\n'],
    ['no trigger at all', 'jobs: {}\n'],
  ])('rejects another event in %s', (_label, text) => {
    expect(dispatchOnlyProblems(parseWorkflow(text))).not.toEqual([]);
  });

  it('reads the key `on` as a string (YAML 1.2), not as the boolean true', () => {
    const parsed = parseWorkflow('on: push\njobs: {}\n');
    expect(Object.keys(parsed)).toContain('on');
    expect(triggerEvents(parsed.on)).toEqual(['push']);
  });
});

describe.each(PRODUCTION_WORKFLOWS)('%s', (file) => {
  const workflow = readWorkflow(file);

  it('starts only from workflow_dispatch', () => {
    expect(dispatchOnlyProblems(workflow)).toEqual([]);
  });

  it('calls no reusable workflow (a job-level `uses:`)', () => {
    for (const [name, job] of jobsOf(file)) expect(job.uses, name).toBeUndefined();
  });

  it('has no secret in workflow-level env', () => {
    expect(mentionsSecrets(workflow.env)).toBe(false);
  });

  it('has an authorize job with no environment, no secret, no permission, and the guard as its one step', () => {
    const authorize = workflow.jobs.authorize;
    expect(authorize).toBeDefined();
    expect(authorize!.environment).toBeUndefined();
    expect(mentionsSecrets(authorize)).toBe(false);
    expect(authorize!.permissions).toEqual({});
    expect(needsOf(authorize!)).toEqual([]);
    expect((authorize!.steps ?? []).map((s) => s.name)).toEqual([GUARD_NAME]);
  });

  it('finds at least two jobs that can read a secret (so the checks below are not vacuous)', () => {
    expect(secretJobs(file).length).toBeGreaterThanOrEqual(2);
  });

  it('makes every job that can read a secret need authorize', () => {
    for (const [name, job] of secretJobs(file)) {
      expect(needsOf(job), `${file} ${name}`).toContain('authorize');
    }
  });

  it('runs the guard as step 0 of every job that can read a secret, and no secret outside its steps', () => {
    for (const [name, job] of secretJobs(file)) {
      const steps = job.steps ?? [];
      expect(steps[0]?.name, `${file} ${name}`).toBe(GUARD_NAME);
      expect(mentionsSecrets(steps[0]), `${file} ${name} guard`).toBe(false);
      const { steps: _steps, ...rest } = job;
      expect(mentionsSecrets(rest), `${file} ${name} outside its steps`).toBe(false);
    }
  });
});

describe('the guard step', () => {
  const guards = guardSteps();

  it('appears in both workflows: authorize, plan and the production job of each', () => {
    expect(guards.map((g) => g.where).sort()).toEqual([
      'db-apply-prod.yml apply',
      'db-apply-prod.yml authorize',
      'db-apply-prod.yml plan',
      'db-rollback-prod.yml authorize',
      'db-rollback-prod.yml plan',
      'db-rollback-prod.yml rollback',
    ]);
  });

  it('passes its values through exactly this env mapping, in every copy', () => {
    for (const { where, step } of guards) expect(step.env, where).toEqual(GUARD_ENV);
  });

  it('has the identical script in every copy, with no expression inside it', () => {
    const scripts = new Set(guards.map((g) => g.step.run));
    expect(scripts.size).toBe(1);
    const [script] = [...scripts];
    expect(typeof script).toBe('string');
    expect(script).not.toContain('${{');
  });

  const script = guards[0]?.step.run ?? 'exit 0';

  it('exits 0 for a dispatch from main by the owner, run by the owner', () => {
    const r = runGuard(script, PASSING);
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it.each([
    ['dispatched by another account', { ACTOR: 'someone-else' }],
    ['re-run by another account', { TRIGGERING_ACTOR: 'someone-else' }],
    ['dispatched from another branch', { REF: 'refs/heads/other' }],
    ['dispatched from a tag', { REF: 'refs/tags/main' }],
    ['started by a push', { EVENT: 'push' }],
    ['started by workflow_call', { EVENT: 'workflow_call' }],
    ['an empty owner, matched by an empty actor', { OWNER: '', ACTOR: '', TRIGGERING_ACTOR: '' }],
    ['an empty event', { EVENT: '' }],
    ['an empty actor', { ACTOR: '' }],
    ['an empty triggering actor', { TRIGGERING_ACTOR: '' }],
    ['an empty ref', { REF: '' }],
    ['no owner variable at all', { OWNER: undefined }],
    ['an actor that only contains the owner', { ACTOR: 'sikder13-bot' }],
  ])('refuses: %s', (_label, change) => {
    const r = runGuard(script, { ...PASSING, ...change });
    expect(r.status, r.stdout + r.stderr).not.toBe(0);
    expect(r.status).not.toBeNull();
  });

  it('names what failed in an ::error:: line', () => {
    const r = runGuard(script, { ...PASSING, TRIGGERING_ACTOR: 'someone-else' });
    expect(r.stdout).toMatch(/^::error::.*someone-else/m);
  });
});

describe('every workflow in .github/workflows', () => {
  const files = workflowFiles();

  it('is read (more than the two production files)', () => {
    expect(files).toEqual(expect.arrayContaining([...PRODUCTION_WORKFLOWS, 'ci.yml']));
  });

  it('binds the production environment only in the two production workflows', () => {
    const using = files.filter((f) =>
      Object.values(readWorkflow(f).jobs).some((job) => environmentName(job) === 'production'),
    );
    expect(using).toEqual([...PRODUCTION_WORKFLOWS]);
  });

  it('never grants actions: write (nor write-all), at workflow or job level', () => {
    for (const f of files) {
      const workflow = readWorkflow(f);
      const blocks = [
        ['workflow', workflow.permissions],
        ...Object.entries(workflow.jobs).map(([n, j]) => [n, j.permissions]),
      ] as [string, unknown][];
      for (const [where, permissions] of blocks) {
        expect(permissions, `${f} ${where}`).not.toBe('write-all');
        if (permissions !== null && typeof permissions === 'object') {
          expect((permissions as Record<string, unknown>).actions, `${f} ${where}`).not.toBe(
            'write',
          );
        }
      }
    }
  });
});
