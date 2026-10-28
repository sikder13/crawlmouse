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
    expect(workflow).not.toMatch(/echo "\$(before|after)"|echo \$(before|after)\b/);
    expect(workflow).toContain('echo "::add-mask::$before"');
    expect(workflow).toContain(
      'flyctl ips allocate-egress --app "$FLY_APP" -r "$FLY_REGION" >/dev/null',
    );
  });

  it('tests and builds before deploying, deploys one machine, and pins flyctl', () => {
    expect(workflow).toContain('pnpm --filter @crawlmouse/worker test');
    expect(workflow).toContain('needs: build');
    expect(workflow).toContain('--ha=false');
    expect(workflow).toMatch(/FLYCTL_VERSION: \d+\.\d+\.\d+\n/);
    expect(workflow).toContain("if: steps.app.outputs.created == 'true'");
  });
});

describe('fly.toml and the Dockerfile', () => {
  it('names the staging app, keeps one machine running and never stops it, with a /healthz check', () => {
    expect(flyToml).toContain('app = "crawlmouse-worker-staging"');
    expect(flyToml).toContain('auto_stop_machines = "off"');
    expect(flyToml).toContain('min_machines_running = 1');
    expect(flyToml).toMatch(/path = "\/healthz"/);
    // The heap cap sits below the VM's memory.
    const heap = Number(/--max-old-space-size=(\d+)/.exec(flyToml)?.[1]);
    const vm = Number(/memory = "(\d+)mb"/.exec(flyToml)?.[1]);
    expect(heap).toBeGreaterThan(0);
    expect(heap).toBeLessThan(vm);
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
