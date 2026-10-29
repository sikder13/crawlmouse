import { READER_FILE } from './reader/file.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runStep, stepScript, unmasked } from './test-support/workflow.js';

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

  it('caps the requests the proxy sends the machine at once, so the bodies it buffers are bounded', () => {
    const section = /\n {2}\[http_service\.concurrency\]\n((?: {4}.*\n)+)/.exec(flyToml);
    expect(section?.[1]).toBe('    type = "requests"\n    soft_limit = 20\n    hard_limit = 25\n');
  });

  it('carries no address and no secret value', () => {
    expect(flyToml).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
    expect(flyToml).not.toMatch(/WORKER_SIGNING_SECRET\s*=|WORKER_JWT_PUBLIC_KEY\s*=/);
  });

  it('runs the bundle on Node 22, pinned by digest, as the node user', () => {
    expect(dockerfile).toMatch(/^FROM node:22\.\d+\.\d+-bookworm-slim@sha256:[0-9a-f]{64}$/m);
    expect(dockerfile).toContain('USER node');
    expect(dockerfile).toContain('CMD ["node", "main.mjs"]');
    // The reader thread's bundle, which main.mjs starts by that name from beside itself.
    expect(dockerfile).toContain(`COPY dist/${READER_FILE} ./${READER_FILE}`);
  });
});

// Addresses from the documentation ranges (RFC 5737): never anyone's real address.
const EGRESS = '203.0.113.7';
const OTHER = '198.51.100.9';
/** EGRESS with one more digit: a substring match would take a reading of EGRESS for it. */
const NEAR = '203.0.113.70';
const ips = (...entries: Array<[string, string, string]>) =>
  JSON.stringify(entries.map(([Type, Region, Address]) => ({ Type, Region, Address })));

describe('the deploy steps, run against stand-ins for flyctl', () => {
  const allocate = stepScript(workflow, "Allocate the app's static egress addresses, once");
  const secrets = stepScript(workflow, "Require the worker's secrets");
  const egress = stepScript(
    workflow,
    "Egress is the app's own address, before and after a restart",
  );
  const allocated = (r: { flyctl: string[] }) =>
    r.flyctl.filter((c) => c.startsWith('ips allocate-egress')).length;
  const sshCalls = (r: { flyctl: string[] }) =>
    r.flyctl.filter((c) => c.startsWith('ssh console')).length;
  /** Runs a step, and fails the test if its log shows any of the test's addresses before its mask. */
  const step = (...args: Parameters<typeof runStep>) => {
    const r = runStep(...args);
    expect(unmasked(r.log, [EGRESS, OTHER, NEAR, '2001:db8::7'])).toEqual([]);
    return r;
  };

  it('allocates once when the region has no egress IPv4, and not when it has one', () => {
    expect(allocated(step(allocate, { ips: '[]' }))).toBe(1);
    expect(allocated(step(allocate, { ips: ips(['egress_v4', 'ams', OTHER]) }))).toBe(1);
    const has = step(allocate, { ips: ips(['egress_v4', 'iad', EGRESS]) });
    expect({ code: has.code, allocated: allocated(has) }).toEqual({ code: 0, allocated: 0 });
  });

  it.each([
    ['the listing fails', null],
    ['the listing prints nothing', ''],
    ['the listing prints null', 'null'],
    ['the listing prints something other than JSON', 'Error: unauthorized'],
  ])('fails, allocating nothing, when %s', (_name, listing) => {
    const r = step(allocate, { ips: listing });
    expect(r.code).not.toBe(0);
    expect(allocated(r)).toBe(0);
  });

  it("names the missing secret, also when flyctl lists an app's secrets as null", () => {
    for (const listing of ['null', '[]', '[{"name":"WORKER_JWT_PUBLIC_KEY"}]']) {
      const r = step(secrets, { secrets: listing });
      expect(r.code).toBe(1);
      expect(r.log).toContain(
        '::error::WORKER_SIGNING_SECRET is not set on crawlmouse-worker-staging.',
      );
    }
    const both = '[{"name":"WORKER_SIGNING_SECRET"},{"Name":"WORKER_JWT_PUBLIC_KEY"}]';
    expect(step(secrets, { secrets: both }).code).toBe(0);
    expect(step(secrets, { secrets: null }).code).not.toBe(0);
  });

  const listed = ips(['egress_v4', 'iad', EGRESS], ['egress_v6', 'iad', '2001:db8::7']);

  it.each([
    ['the egress address, before and after the restart', [EGRESS], 0, 'egress: the app'],
    [
      'another address twice, then the egress address',
      [OTHER, OTHER, EGRESS],
      0,
      'egress: the app',
    ],
    ['no reading at all', ['FAIL'], 1, '::error::could not read the address seen in 15 attempts'],
    [
      'another address every time',
      [OTHER],
      1,
      "::error::after 15 attempts the address seen is not the app's egress IPv4",
    ],
    [
      'the egress address, then another after the restart',
      [EGRESS, OTHER],
      1,
      '::error::the egress address changed across a restart',
    ],
  ])(
    'reading %s: the step ends as it should, says why, and shows no address unmasked',
    (_name, ssh, code, says) => {
      const r = step(egress, { ips: listed, ssh });
      expect(r.code).toBe(code);
      expect(r.log).toContain(says);
    },
  );

  it('tries 15 times before it gives up, as its messages say', () => {
    expect(sshCalls(step(egress, { ips: listed, ssh: ['FAIL'] }))).toBe(15);
    expect(sshCalls(step(egress, { ips: listed, ssh: [OTHER] }))).toBe(15);
  });

  it('takes only the egress address itself, not a reading that is part of it', () => {
    const r = step(egress, { ips: ips(['egress_v4', 'iad', NEAR]), ssh: [EGRESS] });
    expect(r.code).toBe(1);
    expect(r.log).toContain("the address seen is not the app's egress IPv4");
  });

  it('does not count a line that is not an IPv4 address as a reading', () => {
    const r = step(egress, { ips: listed, ssh: ['<html>blocked</html>'] });
    expect(r.code).toBe(1);
    expect(r.log).toContain('::error::could not read the address seen in 15 attempts');
  });
});
