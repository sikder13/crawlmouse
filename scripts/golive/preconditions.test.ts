import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './env-scan';
import { functionCountAfter } from './inngest-sync';
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

  it('has a Vercel variables row and an Inngest sync row for each step', () => {
    for (const s of STEPS) {
      expect(
        PRECONDITIONS.some(
          (p) => p.check.kind === 'auto' && p.check.probe === `vercel-env-${s}` && p.gates === s,
        ),
      ).toBe(true);
      expect(
        PRECONDITIONS.some((p) => p.id === `inngest-synced-before-step-${s}` && p.gates === s),
      ).toBe(true);
    }
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

describe('the expected Inngest function counts', () => {
  it('grow as the flags turn on, from v1 alone', () => {
    // v1 registers four functions (inngest/audit.ts and inngest/billing.ts' three), counted by hand.
    expect(functionCountAfter(1)).toBe(4);
    expect(functionCountAfter(2)).toBe(8);
    const counts = STEPS.map(functionCountAfter);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
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
