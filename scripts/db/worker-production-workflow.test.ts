import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './files';
import {
  CONFINED_ENVIRONMENTS,
  GUARD_ENV,
  GUARD_NAME,
  WORKFLOWS_DIR,
  confinedEnvironmentProblems,
  dispatchOnlyProblems,
  environmentName,
  guardProblems,
  needsOf,
  parseWorkflow,
  readWorkflow,
  secretJobNames,
  triggerEvents,
  workflowFiles,
  type Job,
  type Step,
} from './workflow-file';

// .github/workflows/worker-production.yml deploys the production crawl worker (SPEC 35, D1). It is
// held to the production workflows' rules (production-workflows.test.ts) without being one of them:
// it binds `worker-production`, never `production`, and has one secret-holding job, not two.

const FILE = 'worker-production.yml';
const APP = 'crawlmouse-worker';
const production = readWorkflow(FILE);
const staging = readWorkflow('worker-staging.yml');
const productionText = readFileSync(join(WORKFLOWS_DIR, FILE), 'utf8');

/**
 * sha256 of .github/workflows/worker-staging.yml where this branch left origin/main (dfa3ec37). D1
 * leaves the staging workflow unchanged. To read it again:
 * `git show "$(git merge-base HEAD origin/main)":.github/workflows/worker-staging.yml | sha256sum`.
 */
const STAGING_SHA256 = 'a68c866583fc7ff78a18d3bce479ac37093aa81e51844514c4a2cc7b973725dd';

function job(name: string): Job {
  const found = production.jobs[name];
  if (!found) throw new Error(`no job ${name}`);
  return found;
}

const allSteps = (w: typeof production): Step[] =>
  Object.values(w.jobs).flatMap((j) => j.steps ?? []);

/**
 * A run block of worker-staging.yml as this workflow must carry it: the errors name the
 * worker-production environment and the runbook's Production section, and the deploy reads
 * fly.production.toml and labels the image with the commit.
 */
function asProduction(run: string): string {
  return run
    .replaceAll('the staging environment', 'the worker-production environment')
    .replace(
      /worker-runbook\.md, (Before the first deploy|First deploy|Egress address)/g,
      'worker-runbook.md, Production',
    )
    .replace(
      '--config "$GITHUB_WORKSPACE/packages/worker/fly.toml" --remote-only --ha=false',
      '--config "$GITHUB_WORKSPACE/packages/worker/fly.production.toml" --remote-only --ha=false --image-label "$GITHUB_SHA"',
    );
}

describe('worker-production.yml: who can start it', () => {
  it('starts only from workflow_dispatch, never from a push', () => {
    expect(dispatchOnlyProblems(production)).toEqual([]);
    expect(triggerEvents(production.on)).not.toContain('push');
  });

  it('declares contents: read at the top and nothing more', () => {
    expect(production.permissions).toEqual({ contents: 'read' });
  });

  it('passes guardProblems: the authorize job, the guard as step 0 of the secret job, no secret outside steps', () => {
    expect(guardProblems(production)).toEqual([]);
  });

  it('has the authorize job of the production workflows: no environment, no permission, the guard alone', () => {
    const authorize = job('authorize');
    expect(authorize.environment).toBeUndefined();
    expect(authorize.permissions).toEqual({});
    expect(needsOf(authorize)).toEqual([]);
    expect((authorize.steps ?? []).map((s) => s.name)).toEqual([GUARD_NAME]);
  });

  it('has one job that can read a secret, deploy, behind authorize and the build', () => {
    expect(secretJobNames(production)).toEqual(['deploy']);
    expect(needsOf(job('deploy')).sort()).toEqual(['authorize', 'build']);
    expect(needsOf(job('build'))).toEqual(['authorize']);
    expect(job('deploy').steps?.[0]?.name).toBe(GUARD_NAME);
  });

  it('carries the guard of db-apply-prod.yml, word for word, in each copy', () => {
    const reference = readWorkflow('db-apply-prod.yml').jobs.authorize!.steps![0]!;
    for (const name of ['authorize', 'deploy']) {
      const guard = job(name).steps![0]!;
      expect(guard, name).toEqual(reference);
      expect(guard.env, name).toEqual(GUARD_ENV);
    }
  });

  it('deploys only from main, in the worker-production environment, one run at a time', () => {
    const deploy = job('deploy');
    expect(deploy.environment).toBe('worker-production');
    expect(deploy.if).toBe("github.ref == 'refs/heads/main'");
    expect(production.concurrency).toEqual({
      group: 'worker-production',
      'cancel-in-progress': false,
    });
  });
});

describe('worker-production.yml: what it reads and runs', () => {
  it('pins every action to a 40-hex commit SHA, the same ones worker-staging.yml pins', () => {
    const uses = allSteps(production)
      .map((s) => s.uses)
      .filter((u): u is string => u !== undefined);
    expect(uses.length).toBeGreaterThan(4);
    for (const u of uses) if (!u.startsWith('./')) expect(u).toMatch(/@[0-9a-f]{40}$/);
    const stagingUses = allSteps(staging)
      .map((s) => s.uses)
      .filter((u): u is string => u !== undefined);
    expect(new Set(uses)).toEqual(new Set(stagingUses));
  });

  it('reads one secret, FLY_API_TOKEN, only as step env', () => {
    expect(
      new Set([...productionText.matchAll(/secrets\.([A-Za-z_]+)/g)].map((m) => m[1])),
    ).toEqual(new Set(['FLY_API_TOKEN']));
    for (const line of productionText.split('\n').filter((l) => /secrets\./i.test(l))) {
      expect(line.trim()).toBe('FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}');
    }
  });

  it('runs the build job of worker-staging.yml, step for step', () => {
    expect(job('build').steps).toEqual(staging.jobs.build!.steps);
  });

  it("runs worker-staging.yml's deploy steps after the guard, with the production app and config", () => {
    const stagingEnv = staging.env as Record<string, string>;
    const steps = job('deploy').steps!.slice(1);
    const reference = staging.jobs.deploy!.steps!;
    expect(steps.map((s) => s.name ?? s.uses)).toEqual(reference.map((s) => s.name ?? s.uses));
    steps.forEach((step, i) => {
      const from = reference[i]!;
      const where = step.name ?? step.uses;
      if (from.uses?.startsWith('superfly/flyctl-actions/setup-flyctl@')) {
        // The one value worker-staging.yml takes from its workflow env, which this file cannot have.
        expect(step.with, where).toEqual({ version: stagingEnv.FLYCTL_VERSION });
      } else {
        expect(step.with, where).toEqual(from.with);
      }
      expect(step.uses, where).toBe(from.uses);
      expect(step.run, where).toBe(from.run === undefined ? undefined : asProduction(from.run));
      const expected: Record<string, unknown> = { ...from.env };
      if (from.run?.includes('$FLY_APP')) expected.FLY_APP = APP;
      if (from.run?.includes('$FLY_REGION')) expected.FLY_REGION = stagingEnv.FLY_REGION;
      expect(step.env ?? {}, where).toEqual(expected);
    });
  });

  it('deploys with fly.production.toml and labels the image with the commit', () => {
    const deploy = job('deploy').steps!.find((s) => s.name === 'Deploy')!;
    expect(deploy.run).toContain(
      '--config "$GITHUB_WORKSPACE/packages/worker/fly.production.toml"',
    );
    expect(deploy.run).toContain('--image-label "$GITHUB_SHA"');
    expect(productionText).not.toContain('worker/fly.toml');
  });

  it('names one app, crawlmouse-worker, the app fly.production.toml names', () => {
    const toml = readFileSync(join(REPO_ROOT, 'packages/worker/fly.production.toml'), 'utf8');
    expect(/^app = "([^"]+)"$/m.exec(toml)?.[1]).toBe(APP);
    const apps = allSteps(production)
      .map((s) => s.env?.FLY_APP)
      .filter((a) => a !== undefined);
    expect(apps.length).toBeGreaterThan(4);
    expect(new Set(apps)).toEqual(new Set([APP]));
    expect(productionText).not.toContain('crawlmouse-worker-staging');
  });

  it('turns tracing off in every block that calls flyctl, and echoes no address', () => {
    const flyctl = allSteps(production).filter((s) => s.run?.includes('flyctl'));
    expect(flyctl.length).toBeGreaterThan(3);
    for (const s of flyctl) expect(s.run!.startsWith('set +x -euo pipefail'), s.name).toBe(true);
    expect(productionText).not.toMatch(/echo "?\$(reading|before|after|egress|address)\b/);
    expect(productionText).toContain('echo "::add-mask::$reading"');
    expect(productionText).toContain('echo "::add-mask::$address"');
  });
});

describe('worker-staging.yml', () => {
  it('is unchanged from where this branch left origin/main', () => {
    const text = readFileSync(join(WORKFLOWS_DIR, 'worker-staging.yml'));
    expect(createHash('sha256').update(text).digest('hex')).toBe(STAGING_SHA256);
  });
});

describe('the guard, executed', () => {
  const script = job('deploy').steps![0]!.run!;
  const PASSING = {
    EVENT: 'workflow_dispatch',
    ACTOR: 'sikder13',
    TRIGGERING_ACTOR: 'sikder13',
    OWNER: 'sikder13',
    REF: 'refs/heads/main',
  };
  const run = (env: Record<string, string>) =>
    spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...env },
      encoding: 'utf8',
    });

  it('passes the owner dispatching from main', () => {
    const r = run(PASSING);
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it.each([
    ['dispatched by another account', { ACTOR: 'someone-else' }],
    ['re-run by another account', { TRIGGERING_ACTOR: 'someone-else' }],
    ['dispatched from another branch', { REF: 'refs/heads/other' }],
    ['started by a push', { EVENT: 'push' }],
    ['an empty owner, matched by empty actors', { OWNER: '', ACTOR: '', TRIGGERING_ACTOR: '' }],
  ])('refuses: %s', (_label, change) => {
    const r = run({ ...PASSING, ...change });
    expect(r.status).not.toBeNull();
    expect(r.status, r.stdout + r.stderr).not.toBe(0);
    expect(r.stdout).toMatch(/^::error::/m);
  });
});

describe('the worker-production environment, bound only by worker-production.yml', () => {
  const files = workflowFiles();

  it('reads every workflow, this one among them', () => {
    expect(files).toEqual(expect.arrayContaining([FILE, 'worker-staging.yml', 'ci.yml']));
    expect(CONFINED_ENVIRONMENTS['worker-production']).toBe(FILE);
  });

  it('passes confinedEnvironmentProblems in every workflow', () => {
    for (const f of files) expect(confinedEnvironmentProblems(f, readWorkflow(f)), f).toEqual([]);
  });

  it('is bound by this workflow and no other', () => {
    const binding = files.filter((f) =>
      Object.values(readWorkflow(f).jobs).some(
        (j) => environmentName(j)?.trim().toLowerCase() === 'worker-production',
      ),
    );
    expect(binding).toEqual([FILE]);
  });

  const body = (environment: string) =>
    parseWorkflow(`on: push\npermissions:\n  contents: read\njobs:\n  x:\n${environment}`);

  it.each([
    [
      'the name as it is',
      'ci.yml',
      '    environment: worker-production\n',
      /binds worker-production/,
    ],
    ['another case', 'ci.yml', '    environment: Worker-Production\n', /binds worker-production/],
    [
      'the map form, upper case',
      'nightly.yml',
      '    environment:\n      name: WORKER-PRODUCTION\n',
      /binds worker-production/,
    ],
    [
      'the map form with a url',
      'worker-staging.yml',
      '    environment:\n      name: worker-production\n      url: https://example.com\n',
      /binds worker-production/,
    ],
    [
      'a quoted name with spaces around it',
      'db-apply-prod.yml',
      "    environment: ' worker-production '\n",
      /binds worker-production/,
    ],
    [
      'a computed name',
      'ci.yml',
      "    environment: ${{ 'worker-production' }}\n",
      /computes its environment name/,
    ],
    [
      'a computed name in the map form',
      'nightly.yml',
      '    environment:\n      name: ${{ inputs.env }}\n',
      /computes its environment name/,
    ],
    [
      'a computed name in worker-production.yml itself',
      FILE,
      '    environment: ${{ inputs.env }}\n',
      /computes its environment name/,
    ],
  ])('rejects %s', (_label, file, environment, expected) => {
    expect(confinedEnvironmentProblems(file, body(environment)).join('\n')).toMatch(expected);
  });

  it('accepts worker-production in worker-production.yml, and other names anywhere', () => {
    expect(confinedEnvironmentProblems(FILE, body('    environment: worker-production\n'))).toEqual(
      [],
    );
    expect(confinedEnvironmentProblems('ci.yml', body('    environment: staging\n'))).toEqual([]);
  });
});
