import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('.github/workflows/fly-spike.yml', () => {
  const wf = read('.github/workflows/fly-spike.yml');
  const code = wf.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

  it('is workflow_dispatch only, with contents: read and nothing else', () => {
    const on = code.match(/^on:\n((?:[ ]{2,}.*\n)+)/m)![1]!;
    expect(on).toMatch(/^\s{2}workflow_dispatch:/m);
    expect(on).not.toMatch(/^\s{2}(push|pull_request|pull_request_target|schedule|workflow_run):/m);
    const perms = code.match(/^permissions:\n((?:[ ]{2}.*\n)+)/m)![1]!;
    expect(perms.trim()).toBe('contents: read');
  });

  it('every job that uses a secret runs in the spike environment', () => {
    for (const job of ['deploy', 'measure', 'teardown']) {
      const body = code.split(new RegExp(`^  ${job}:\\n`, 'm'))[1]!.split(/^  [a-z-]+:\n/m)[0]!;
      expect(body, job).toMatch(/environment: spike/);
    }
  });

  it('pins every action by a full 40-character commit SHA', () => {
    const uses = [...code.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThanOrEqual(5);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });

  it('exposes FLY_API_TOKEN only as env: on steps, never in a run line or with:', () => {
    for (const line of code.split('\n')) {
      if (line.includes('secrets.FLY_API_TOKEN')) expect(line.trim()).toBe('FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}');
    }
    expect(code).not.toMatch(/with:\s*\n\s+[a-z-]+: \$\{\{ secrets\.FLY_API_TOKEN/);
  });

  it('uses set +x in every run block and never echoes the environment', () => {
    const runs = code.split(/\n\s+run: \|\n/).slice(1);
    expect(runs.length).toBeGreaterThanOrEqual(5);
    for (const r of runs.filter((x) => !x.startsWith('          npm install'))) expect(r.trimStart().startsWith('set +x')).toBe(true);
    expect(code).not.toMatch(/\b(printenv|env\s*\||echo \$\{\{|set -x)\b/);
  });

  it('does not hand the worker an Inngest or service-role key', () => {
    const step = code.split('- name: Set worker secrets')[1]!.split('- name:')[0]!;
    expect(step).not.toMatch(/INNGEST|SERVICE_KEY|SERVICE_ROLE/i);
  });

  it('tears down even when measure fails', () => {
    expect(code).toMatch(/teardown:[\s\S]*if: \$\{\{ always\(\) && inputs\.teardown \}\}/);
  });
});

describe('fly.toml and Dockerfile', () => {
  const fly = read('scripts/spike/worker/fly.toml');
  const docker = read('scripts/spike/worker/Dockerfile');

  it('names the app and carries placeholders only', () => {
    expect(fly).toMatch(/^app = "crawlmouse-spike-worker"$/m);
    expect(fly).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(fly).not.toMatch(/[0-9a-f]{32,}/i);
    expect(fly).not.toMatch(/(SECRET|TOKEN|PASSWORD)\s*=/i);
  });

  it('runs Node 22 and starts the worker entry', () => {
    expect(docker).toMatch(/^FROM node:22/m);
    expect(docker).toMatch(/CMD \["tsx", "scripts\/spike\/worker\/main\.ts"\]/);
    expect(docker).toMatch(/^USER node$/m);
  });

  it('copies only engine modules that import nothing outside node: built-ins and each other', () => {
    const copied = [...docker.matchAll(/packages\/engine\/src\/([a-z-]+\.ts)/g)].map((m) => m[1]!);
    expect(copied.sort()).toEqual(['robots.ts', 'safe-fetch.ts', 'ssrf-guard.ts']);
    for (const f of copied) {
      const src = read(`packages/engine/src/${f}`);
      for (const m of src.matchAll(/^import .* from '([^']+)'/gm)) {
        expect(m[1]!, `${f} imports ${m[1]}`).toMatch(/^(node:|\.\/(safe-fetch|ssrf-guard|robots)\.js$)/);
      }
    }
  });
});

describe('spike sources: no secret-shaped strings, no assistant references', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(here);
  files.push(join(root, '.github/workflows/fly-spike.yml'));
  // Patterns for common credential shapes. Written as constructed regexes so this file does not match itself.
  const shapes = [
    new RegExp('sk[-_](live|test|proj)?[-_]?[A-Za-z0-9]{16,}'),
    new RegExp('(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}'),
    new RegExp('AKIA[0-9A-Z]{16}'),
    new RegExp('eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.'),
    new RegExp('-----BEGIN [A-Z ]*PRIVATE KEY-----'),
    new RegExp('(fo1|fm1|fm2)_[A-Za-z0-9+/=_-]{20,}'),
  ];
  // Built from pieces so this file does not contain the strings it forbids elsewhere.
const assistants = new RegExp(
  [['co', 'authored', 'by'].join('-'), ['claude', 'code'].join(' '), ['generated', 'with'].join(' '), ['anthro', 'pic'].join('')].join('|'),
  'i',
);

  it('scans a non-trivial number of files', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it.each(files.map((f) => [f.replace(root + '/', ''), f]))('%s', (_n, f) => {
    const text = readFileSync(f as string, 'utf8');
    for (const re of shapes) expect(text).not.toMatch(re);
    expect(text).not.toMatch(assistants);
  });
});
