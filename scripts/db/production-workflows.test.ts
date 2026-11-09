import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GUARD_ENV as HELPER_GUARD_ENV,
  GUARD_NAME,
  dispatchOnlyProblems,
  environmentProblems,
  guardProblems,
  environmentName,
  mentionsSecrets,
  needsOf,
  parseWorkflow,
  readWorkflow,
  triggerEvents,
  workflowFiles,
  type Job,
  type Step,
  type Workflow,
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

  it('passes guardProblems (each of its checks has a bypass fixture below)', () => {
    expect(guardProblems(workflow)).toEqual([]);
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

type Bypass = [label: string, file: string, mutate: (w: Workflow) => void, expected: RegExp];

function jobIn(w: Workflow, name: string): Job {
  const job = w.jobs[name];
  if (!job) throw new Error(`no job ${name}`);
  return job;
}

function guardIn(w: Workflow, name: string): Step {
  const step = jobIn(w, name).steps?.[0];
  if (step?.name !== GUARD_NAME) throw new Error(`${name}: step 0 is not the guard`);
  return step;
}

// Each one leaves the guard as step 0 and disables it. Applied to the parsed real files.
const BYPASSES: Bypass[] = [
  [
    'step-level if: false on the guard',
    'db-apply-prod.yml',
    (w) => void (guardIn(w, 'apply').if = false),
    /apply: the guard step's keys/,
  ],
  [
    'continue-on-error on the guard step',
    'db-apply-prod.yml',
    (w) => void (guardIn(w, 'apply')['continue-on-error'] = true),
    /apply: step 0 has continue-on-error/,
  ],
  [
    "shell: 'true {0}' on the guard step",
    'db-rollback-prod.yml',
    (w) => void (guardIn(w, 'rollback').shell = 'true {0}'),
    /rollback: the guard step's keys/,
  ],
  [
    'an id on the authorize guard',
    'db-apply-prod.yml',
    (w) => void (guardIn(w, 'authorize').id = 'x'),
    /authorize: the guard step's keys/,
  ],
  [
    'workflow-level defaults.run.shell',
    'db-apply-prod.yml',
    (w) => void (w.defaults = { run: { shell: 'true {0}' } }),
    /workflow: has defaults/,
  ],
  [
    'job-level defaults.run.shell',
    'db-rollback-prod.yml',
    (w) => void (jobIn(w, 'plan').defaults = { run: { shell: 'true {0}' } }),
    /plan: has defaults/,
  ],
  [
    'job-level defaults on authorize',
    'db-apply-prod.yml',
    (w) => void (jobIn(w, 'authorize').defaults = { run: { shell: 'true {0}' } }),
    /authorize: has defaults/,
  ],
  [
    'continue-on-error on the authorize job',
    'db-apply-prod.yml',
    (w) => void (jobIn(w, 'authorize')['continue-on-error'] = true),
    /authorize: has continue-on-error/,
  ],
  [
    'an if on the authorize job',
    'db-rollback-prod.yml',
    (w) => void (jobIn(w, 'authorize').if = 'false'),
    /authorize: has an if/,
  ],
  [
    'continue-on-error on a secret job',
    'db-apply-prod.yml',
    (w) => void (jobIn(w, 'apply')['continue-on-error'] = true),
    /apply: has continue-on-error/,
  ],
  [
    'if: always() on apply, with continue-on-error on its guard',
    'db-apply-prod.yml',
    (w) => {
      jobIn(w, 'apply').if = 'always()';
      guardIn(w, 'apply')['continue-on-error'] = true;
    },
    /apply: its if calls a status function/,
  ],
  [
    'if: always() on plan',
    'db-rollback-prod.yml',
    (w) => void (jobIn(w, 'plan').if = "${{ always() && github.ref == 'refs/heads/main' }}"),
    /plan: its if calls a status function/,
  ],
  [
    'a second step in authorize',
    'db-apply-prod.yml',
    (w) => void jobIn(w, 'authorize').steps!.push({ run: 'true' }),
    /authorize: has 2 steps/,
  ],
  [
    'a different guard script in one copy',
    'db-rollback-prod.yml',
    (w) => void (guardIn(w, 'plan').run = 'exit 0'),
    /differs between copies/,
  ],
  [
    'a job-level secret on a secret job',
    'db-apply-prod.yml',
    (w) => void (jobIn(w, 'apply').env = { T: '${{ secrets.X }}' }),
    /apply: mentions secrets outside its steps/,
  ],
  [
    'the guard gone from rollback',
    'db-rollback-prod.yml',
    (w) => void jobIn(w, 'rollback').steps!.shift(),
    /rollback: step 0 is not the guard/,
  ],
  [
    'authorize no longer needed by plan',
    'db-apply-prod.yml',
    (w) => void (jobIn(w, 'plan').needs = []),
    /plan: does not need authorize/,
  ],
];

const MORE_BYPASSES: Bypass[] = [
  [
    'workflow-level env BASH_ENV',
    'db-apply-prod.yml',
    (w) => void (w.env = { BASH_ENV: '/tmp/x' }),
    /workflow: has env/,
  ],
  [
    'workflow-level env naming a secret',
    'db-rollback-prod.yml',
    (w) => void (w.env = { T: '${{ secrets.X }}' }),
    /workflow: has env/,
  ],
  [
    'job-level env BASH_FUNC_[%% on authorize',
    'db-apply-prod.yml',
    (w) => void (jobIn(w, 'authorize').env = { 'BASH_FUNC_[%%': '() { return 0; }' }),
    /authorize: has a job-level env/,
  ],
  [
    'job-level env BASH_ENV on apply',
    'db-apply-prod.yml',
    (w) => void (jobIn(w, 'apply').env = { BASH_ENV: '/tmp/x' }),
    /apply: has a job-level env/,
  ],
  [
    'job-level env on rollback plan',
    'db-rollback-prod.yml',
    (w) => void (jobIn(w, 'plan').env = { A: 'b' }),
    /plan: has a job-level env/,
  ],
  [
    'if: failure() on apply',
    'db-apply-prod.yml',
    (w) => void (jobIn(w, 'apply').if = 'failure()'),
    /apply: its if calls a status function/,
  ],
  [
    'if: !cancelled() on plan',
    'db-apply-prod.yml',
    (w) => void (jobIn(w, 'plan').if = '${{ !cancelled() }}'),
    /plan: its if calls a status function/,
  ],
  [
    'if: success() || true on rollback',
    'db-rollback-prod.yml',
    (w) => void (jobIn(w, 'rollback').if = 'success() || true'),
    /rollback: its if calls a status function/,
  ],
  [
    'if: !success() || success() on apply',
    'db-apply-prod.yml',
    (w) => void (jobIn(w, 'apply').if = '${{ !success() || success() }}'),
    /apply: its if calls a status function/,
  ],
  [
    'needs on authorize',
    'db-rollback-prod.yml',
    (w) => void (jobIn(w, 'authorize').needs = 'plan'),
    /authorize: needs another job/,
  ],
  [
    'a container on apply',
    'db-apply-prod.yml',
    (w) => void (jobIn(w, 'apply').container = 'ubuntu:24.04'),
    /apply: has a container/,
  ],
  [
    'services on rollback plan',
    'db-rollback-prod.yml',
    (w) => void (jobIn(w, 'plan').services = { pg: { image: 'postgres' } }),
    /plan: has services/,
  ],
  [
    'runs-on [self-hosted] on authorize',
    'db-apply-prod.yml',
    (w) => void (jobIn(w, 'authorize')['runs-on'] = ['self-hosted']),
    /authorize: runs-on is not ubuntu-24.04/,
  ],
  [
    'runs-on ubuntu-latest on rollback',
    'db-rollback-prod.yml',
    (w) => void (jobIn(w, 'rollback')['runs-on'] = 'ubuntu-latest'),
    /rollback: runs-on is not ubuntu-24.04/,
  ],
  [
    'continue-on-error on a later step',
    'db-rollback-prod.yml',
    (w) => void (jobIn(w, 'rollback').steps![1]!['continue-on-error'] = true),
    /rollback: step 1 has continue-on-error/,
  ],
  [
    'no secret-holding job left',
    'db-apply-prod.yml',
    (w) => {
      delete w.jobs.plan;
      delete w.jobs.apply;
    },
    /no job can read a secret/,
  ],
  [
    'no authorize job',
    'db-rollback-prod.yml',
    (w) => void delete w.jobs.authorize,
    /authorize: missing/,
  ],
  [
    'an environment on authorize',
    'db-apply-prod.yml',
    (w) => void (jobIn(w, 'authorize').environment = 'staging'),
    /authorize: has an environment/,
  ],
  [
    'a secret in authorize outputs',
    'db-apply-prod.yml',
    (w) => void (jobIn(w, 'authorize').outputs = { x: '${{ secrets.X }}' }),
    /authorize: mentions secrets/,
  ],
  [
    'a permission on authorize',
    'db-rollback-prod.yml',
    (w) => void (jobIn(w, 'authorize').permissions = { contents: 'read' }),
    /authorize: permissions are not \{\}/,
  ],
  [
    'a job-level uses',
    'db-apply-prod.yml',
    (w) => void (w.jobs.called = { uses: './.github/workflows/x.yml' }),
    /called: calls a reusable workflow/,
  ],
  [
    'a push trigger beside the dispatch',
    'db-rollback-prod.yml',
    (w) => void ((w.on as Record<string, unknown>).push = null),
    /the events are/,
  ],
  [
    'a guard env from github.actor',
    'db-rollback-prod.yml',
    (w) => void (guardIn(w, 'rollback').env!.OWNER = '${{ github.actor }}'),
    /rollback: the guard step's env is not the pinned mapping/,
  ],
  [
    'a guard with no run',
    'db-rollback-prod.yml',
    (w) => void delete guardIn(w, 'plan').run,
    /plan: the guard's run is missing/,
  ],
  [
    'an expression inside the guard script',
    'db-apply-prod.yml',
    (w) => void (guardIn(w, 'apply').run = 'echo ${{ github.actor }}'),
    /apply: the guard's run is missing or holds an expression/,
  ],
];

describe('bypasses of the guard, each rejected by guardProblems', () => {
  it.each([...BYPASSES, ...MORE_BYPASSES])('%s (%s)', (_label, file, mutate, expected) => {
    const workflow = readWorkflow(file);
    expect(guardProblems(workflow)).toEqual([]);
    mutate(workflow);
    expect(guardProblems(workflow).join('\n')).toMatch(expected);
  });
});

describe('the guard step', () => {
  it('is pinned in the helper to the same env mapping this file writes out', () => {
    expect(HELPER_GUARD_ENV).toEqual(GUARD_ENV);
  });

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

  // Why a workflow- or job-level env is rejected: it reaches the guard's process. Run as GitHub runs
  // a bash step (`bash --noprofile --norc -eo pipefail {0}`), each of these makes the real script
  // pass a non-owner. These tests pass while the threat holds; they document it.
  function runAsStep(env: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'guard-'));
    const file = join(dir, 'step.sh');
    writeFileSync(file, script);
    return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', file], {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...PASSING, ACTOR: 'someone-else', ...env },
      encoding: 'utf8',
      cwd: dir,
    });
  }

  it('refuses a non-owner when run as GitHub runs a step, with no extra env', () => {
    const r = runAsStep({});
    expect(r.status).not.toBeNull();
    expect(r.status).not.toBe(0);
  });

  it('threat, documented: BASH_ENV in the env makes the guard exit 0 for a non-owner', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bash-env-'));
    writeFileSync(join(dir, 'f'), 'exit 0\n');
    const r = runAsStep({ BASH_ENV: join(dir, 'f') });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/::error::/);
  });

  it('threat, documented: an exported BASH_FUNC_[%% makes the guard print the owner line for a non-owner', () => {
    const r = runAsStep({ 'BASH_FUNC_[%%': '() { return 0; }' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/dispatched and run by the owner/);
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
      Object.values(readWorkflow(f).jobs).some(
        (job) => environmentName(job)?.toLowerCase() === 'production',
      ),
    );
    expect(using).toEqual([...PRODUCTION_WORKFLOWS]);
  });

  it('passes environmentProblems: production only where it belongs, no computed name, no spike, top-level permissions', () => {
    for (const f of files) {
      expect(environmentProblems(f, readWorkflow(f), PRODUCTION_WORKFLOWS), f).toEqual([]);
    }
  });

  it.each([
    [
      'Production, capitalised',
      'ci.yml',
      'jobs:\n  x:\n    environment: Production\n',
      /binds production/,
    ],
    [
      'PRODUCTION as a name map',
      'ci.yml',
      'jobs:\n  x:\n    environment:\n      name: PRODUCTION\n',
      /binds production/,
    ],
    [
      'a computed name',
      'ci.yml',
      "jobs:\n  x:\n    environment: ${{ 'production' }}\n",
      /computes its environment name/,
    ],
    [
      'a computed name map',
      'nightly.yml',
      'jobs:\n  x:\n    environment:\n      name: ${{ inputs.env }}\n',
      /computes its environment name/,
    ],
    ['spike', 'ci.yml', 'jobs:\n  x:\n    environment: spike\n', /binds spike/],
    [
      'Spike in a production workflow',
      'db-apply-prod.yml',
      'jobs:\n  x:\n    environment: Spike\n',
      /binds spike/,
    ],
    ['no top-level permissions', 'ci.yml', 'jobs: {}\n', /no top-level permissions/],
  ])('rejects %s', (_label, file, body, expected) => {
    const permissions = body.startsWith('jobs: {}') ? '' : 'permissions:\n  contents: read\n';
    const workflow = parseWorkflow(`on: push\n${permissions}${body}`);
    expect(environmentProblems(file, workflow, PRODUCTION_WORKFLOWS).join('\n')).toMatch(expected);
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
