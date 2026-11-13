import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './env-scan';
import { syncedFunctionCount } from './inngest-sync';
import { PRECONDITIONS } from './preconditions';
import { PROBES } from './probes/index';
import { SENDING_DOMAIN } from './probes/resend';
import { WORKER_APP } from './probes/worker';
import { STEPS } from './steps';

const tracked = PRECONDITIONS.filter((p) => !p.source.startsWith('notes/'));

describe('the registry', () => {
  it('has unique ids', () => {
    const ids = PRECONDITIONS.map((p) => p.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('gates a step from 1 to 5 in every row', () => {
    for (const p of PRECONDITIONS) expect(STEPS, p.id).toContain(p.gates);
  });

  it('cites a tracked file:line that exists and is that long, or a session note', () => {
    expect(tracked.length).toBeGreaterThan(20);
    for (const p of PRECONDITIONS) {
      if (p.source.startsWith('notes/')) {
        expect(p.source, p.id).toMatch(/^notes\/cc-[a-z0-9-]+\/[A-Za-z.-]+\.md/);
        continue;
      }
      const m = /^([^:]+):(\d+)$/.exec(p.source);
      expect(m, `${p.id}: ${p.source}`).not.toBeNull();
      const path = join(REPO_ROOT, m![1]!);
      expect(existsSync(path), `${p.id}: ${m![1]} exists`).toBe(true);
      const lines = readFileSync(path, 'utf8').split('\n').length;
      expect(lines, `${p.id}: ${p.source}`).toBeGreaterThanOrEqual(Number(m![2]));
    }
  });

  it('names only probes that are implemented, and uses every probe', () => {
    const used = new Set<string>();
    for (const p of PRECONDITIONS) {
      if (p.check.kind === 'auto') {
        expect(Object.hasOwn(PROBES, p.check.probe), p.id).toBe(true);
        used.add(p.check.probe);
      }
    }
    expect([...used].sort()).toEqual(Object.keys(PROBES).sort());
  });

  it("has a Vercel variables row for each step's names, step 1's gating step 2", () => {
    for (const s of STEPS) {
      expect(
        PRECONDITIONS.some(
          (p) =>
            p.check.kind === 'auto' &&
            p.check.probe === `vercel-env-${s}` &&
            p.gates === (s === 1 ? 2 : s),
        ),
        String(s),
      ).toBe(true);
    }
  });

  it('has an Inngest sync row gating each flag step, and none gating step 1', () => {
    for (const s of [2, 3, 4, 5]) {
      expect(
        PRECONDITIONS.some((p) => p.id === `inngest-synced-before-step-${s}` && p.gates === s),
      ).toBe(true);
    }
    expect(PRECONDITIONS.some((p) => p.id === 'inngest-synced-before-step-1')).toBe(false);
  });

  it('holds the rows the brief names, at their steps and owners', () => {
    const at = (id: string) => PRECONDITIONS.find((p) => p.id === id);
    expect(at('vercel-env-step-4')?.mustBeTrue).toMatch(/EMAIL_LINK_SECRET/);
    expect(at('agency-trial-route-removed')).toMatchObject({ gates: 5, owner: 'done' });
    expect(at('signin-canary')).toMatchObject({ owner: 'CC-33' });
    expect(at('stripe-live-prices')).toMatchObject({ gates: 5 });
    expect(at('resend-domain')).toMatchObject({ gates: 4 });
    expect(at('resend-webhook')).toMatchObject({ gates: 4 });
    expect(at('inngest-plan')).toMatchObject({ gates: 2 });
    for (const id of [
      'cc36-v1-accounts',
      'cc36-v1-pages',
      'cc36-v1-redirects',
      'cc36-v1-crons',
      'cc36-v1-billing',
    ]) {
      expect(at(id)?.owner, id).toBe('CC-36');
    }
  });
});

describe('step 1 can be checked before the worker deploy (review r1 D-B1)', () => {
  const at = (id: string) => PRECONDITIONS.find((p) => p.id === id);

  it('gates step 1 only on what the owner makes true before deploying, all manual', () => {
    expect(
      PRECONDITIONS.filter((p) => p.gates === 1)
        .map((p) => p.id)
        .sort(),
    ).toEqual(['fly-tokens-scoped', 'worker-fly-secrets', 'worker-github-environment']);
    for (const p of PRECONDITIONS.filter((x) => x.gates === 1)) expect(p.check.kind).toBe('manual');
  });

  it("moves step 1's exit check to step 2's entry", () => {
    for (const id of [
      'worker-healthz',
      'worker-release',
      'vercel-env-step-1',
      'worker-egress-recorded',
      'worker-uptime-monitor',
    ]) {
      expect(at(id)?.gates, id).toBe(2);
    }
  });

  it('asks that no other environment holds a Fly token that reaches the production worker (D-B2)', () => {
    expect(at('fly-tokens-scoped')).toMatchObject({ gates: 1, owner: 'owner' });
    expect(at('fly-tokens-scoped')?.mustBeTrue).toMatch(
      /tokens create deploy -a crawlmouse-worker-staging/,
    );
    expect(at('fly-tokens-scoped')?.mustBeTrue).toMatch(/`spike`/);
  });
});

describe('rows added in review round 1', () => {
  const at = (id: string) => PRECONDITIONS.find((p) => p.id === id);

  it('pairs the app worker variables with the production worker before step 4', () => {
    expect(at('worker-variables-paired')).toMatchObject({ gates: 4, owner: 'owner' });
    expect(at('worker-variables-paired')?.mustBeTrue).toContain(
      'https://crawlmouse-worker.fly.dev',
    );
  });

  it('records Search Console before step 5, and runs IndexNow only after the watch', () => {
    expect(at('search-console-step-5')).toMatchObject({ gates: 5, owner: 'owner' });
    for (const id of ['search-console-baseline', 'search-console-step-5']) {
      expect(at(id)?.mustBeTrue, id).toMatch(
        /IndexNow is run only after the step's 30-minute watch/,
      );
      expect(at(id)?.mustBeTrue, id).not.toMatch(/after the deploy/);
    }
  });

  it("says the Stripe probe cannot see the key's account", () => {
    expect(at('stripe-live-prices')?.why).toMatch(/cannot see which Stripe account/);
  });

  it('does not require the optional sign-in canary, only its prerequisites when it is set', () => {
    expect(at('signin-canary')?.mustBeTrue).toMatch(/^SIGNIN_CANARY_TO is unset, or/);
  });
});

describe('the expected Inngest function counts', () => {
  it('count synced functions, failure handlers included, from v1 alone', () => {
    // Independent truth: apps/web/lib/v2/pipeline/functions.test.ts asserts the synced configs are
    // (V2_PIPELINE ? 10 : 5) + …, because auditFn and checkFn each declare onFailure, and
    // notes/cc-03/PR.md:180 lists v1's five: audit, audit-failure, stripe-reconcile,
    // stripe-reconcile-manual, audits-ttl-cleanup. After steps 1–5: 5, 10, 10, 22, 24.
    expect(STEPS.map(syncedFunctionCount)).toEqual([5, 10, 10, 22, 24]);
  });
});

describe('constants that copy a file', () => {
  it("names the production worker as fly.production.toml's app, once that file exists", () => {
    const toml = join(REPO_ROOT, 'packages/worker/fly.production.toml');
    if (!existsSync(toml)) {
      // Workstream A adds the file; until it is merged this test has nothing to compare.
      expect(WORKER_APP).toBe('crawlmouse-worker');
      return;
    }
    expect(/^app = "([^"]+)"$/m.exec(readFileSync(toml, 'utf8'))?.[1]).toBe(WORKER_APP);
  });

  it('checks the sending domain docs/ops/senders.md names', () => {
    const senders = readFileSync(join(REPO_ROOT, 'docs/ops/senders.md'), 'utf8');
    expect(senders).toContain(`Domains → \`${SENDING_DOMAIN}\` shows _Verified_`);
  });
});
