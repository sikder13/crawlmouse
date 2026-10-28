import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const workflow = read('../../../.github/workflows/worker-staging.yml');
const flyToml = read('../fly.toml');
const dockerfile = read('../Dockerfile');
const runBlocks = [...workflow.matchAll(/run: \|\n((?: {10,}.*\n?)+)/g)].map((m) => m[1]!);

describe('.github/workflows/worker-staging.yml', () => {
  it('runs only on a push to main, with contents: read and no other permission', () => {
    expect(workflow).toMatch(/\non:\n {2}push:\n {4}branches: \[main\]\n/);
    expect(workflow).not.toMatch(/pull_request|workflow_dispatch|schedule:/);
    expect(workflow.match(/permissions:/g)).toHaveLength(1);
    expect(workflow).toMatch(/\npermissions:\n {2}contents: read\n\n/);
  });

  it('pins every third-party action to a full commit SHA', () => {
    const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(4);
    for (const u of uses) {
      if (u.startsWith('./')) continue;
      expect(u).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('reads FLY_API_TOKEN only in the staging environment, only as step env, and no other secret', () => {
    expect(new Set([...workflow.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))).toEqual(
      new Set(['FLY_API_TOKEN']),
    );
    for (const line of workflow.split('\n').filter((l) => l.includes('secrets.'))) {
      expect(line.trim()).toBe('FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}');
    }
    const deploy = workflow.slice(workflow.indexOf('\n  deploy:'));
    expect(deploy).toContain('environment: staging');
    expect(workflow.slice(0, workflow.indexOf('\n  deploy:'))).not.toContain('secrets.');
  });

  it('turns tracing off in every block that has the token, and prints no address', () => {
    const tokenBlocks = runBlocks.filter((b) => b.includes('flyctl'));
    expect(tokenBlocks.length).toBeGreaterThan(3);
    for (const b of tokenBlocks) expect(b.trimStart().startsWith('set +x')).toBe(true);
    // A reading is masked before anything else is done with it, and never echoed itself.
    expect(workflow).not.toMatch(/echo "?\$(reading|before|after|egress)\b/);
    for (const masked of ['$reading', '$address']) {
      expect(workflow).toContain(`echo "::add-mask::${masked}"`);
    }
    // The address read must look like one, so a stray line from flyctl cannot be echoed unmasked.
    expect(workflow).toContain('[[ "$reading" =~ $ipv4 ]]');
    expect(workflow).toContain('--machine "$machine"');
  });

  it('allocates the egress pair after the first deploy, non-interactively, and only when the region has none', () => {
    const deploy = workflow.indexOf('- name: Deploy');
    const allocate = workflow.indexOf('- name: Allocate the app');
    expect(deploy).toBeGreaterThan(0);
    expect(allocate).toBeGreaterThan(deploy);
    expect(workflow).toContain(
      'flyctl ips allocate-egress --app "$FLY_APP" -r "$FLY_REGION" --yes >/dev/null',
    );
    expect(workflow).toContain('.Type == "egress_v4" and .Region == $r');
    expect(workflow.match(/allocate-egress/g)).toHaveLength(1);
  });

  it('takes the Fly organisation from the environment, never by guessing', () => {
    expect(workflow).toContain('FLY_ORG: ${{ vars.FLY_ORG }}');
    expect(workflow).not.toContain('orgs list');
  });

  it('fails a step when flyctl fails, instead of reading its silence as "none"', () => {
    const tokenBlocks = runBlocks.filter((b) => b.includes('flyctl'));
    for (const b of tokenBlocks)
      expect(b.trimStart().startsWith('set +x -euo pipefail')).toBe(true);
    // flyctl output is read into a variable first; piped straight into jq, a failed call is an empty input.
    const joined = workflow.replace(/\\\n\s*/g, ' ');
    expect(joined).not.toMatch(/flyctl [^\n]*\|\s*jq/);
    expect(workflow).toContain('ips=$(flyctl ips list --app "$FLY_APP" --json)');
  });

  it('tests and builds before deploying, deploys one machine, and pins flyctl', () => {
    expect(workflow).toContain('pnpm --filter @crawlmouse/worker test');
    expect(workflow).toContain('needs: build');
    expect(workflow).toContain('--ha=false');
    expect(workflow).toMatch(/FLYCTL_VERSION: \d+\.\d+\.\d+\n/);
  });

  it('runs on a change to anything the bundle is built from', () => {
    for (const path of [
      'packages/**',
      'pnpm-lock.yaml',
      'tsconfig.base.json',
      '.nvmrc',
      '.github/actions/setup/**',
    ]) {
      expect(workflow).toContain(`- '${path}'`);
    }
  });
});

describe('fly.toml and the Dockerfile', () => {
  it('names the staging app, keeps one machine running and restarts it, with a /healthz check', () => {
    expect(flyToml).toContain('app = "crawlmouse-worker-staging"');
    expect(flyToml).toContain('auto_stop_machines = "off"');
    expect(flyToml).toContain('min_machines_running = 1');
    expect(flyToml).toMatch(/path = "\/healthz"/);
    // Restarted whatever its exit, so a crash cannot leave staging down until the next deploy.
    expect(flyToml).toMatch(/\n\[\[restart\]\]\n {2}policy = "always"\n/);
    // The heap limit is set; src/load.test.ts checks what the process holds under load against the VM.
    expect(flyToml).toContain('NODE_OPTIONS = "--max-old-space-size=256 --max-semi-space-size=4"');
  });

  it('carries no address and no secret value', () => {
    expect(flyToml).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
    expect(flyToml).not.toMatch(/WORKER_SIGNING_SECRET\s*=|WORKER_JWT_PUBLIC_KEY\s*=/);
  });

  it('runs the bundle on Node 22, pinned by digest, as the node user', () => {
    expect(dockerfile).toMatch(/^FROM node:22\.\d+\.\d+-bookworm-slim@sha256:[0-9a-f]{64}$/m);
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('CMD ["node", "main.mjs"]');
  });
});
