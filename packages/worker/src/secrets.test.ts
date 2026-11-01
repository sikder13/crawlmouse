import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No secret-shaped literal anywhere in the package or its workflow. The patterns are the sixteen
 * PROJECT_OVERVIEW.md §10 lists, plus Fly's two token forms, since this package deploys to Fly.
 */
const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['sk-', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['sk_live_', /\bsk_live_[A-Za-z0-9]{16,}/],
  ['rk_live_', /\brk_live_[A-Za-z0-9]{16,}/],
  ['whsec_', /\bwhsec_[A-Za-z0-9]{16,}/],
  ['ghp_', /\bghp_[A-Za-z0-9]{30,}/],
  ['gho_', /\bgho_[A-Za-z0-9]{30,}/],
  ['github_pat_', /\bgithub_pat_[A-Za-z0-9_]{30,}/],
  ['AKIA', /\bAKIA[A-Z0-9]{16}\b/],
  ['ASIA', /\bASIA[A-Z0-9]{16}\b/],
  ['AIza', /\bAIza[0-9A-Za-z_-]{35}/],
  ['PEM private key', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['JWT', /\beyJhbGciOi[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['re_', /\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{16,}/],
  ['phc_', /\bphc_[A-Za-z0-9]{30,}/],
  ['xox', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['SG.', /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/],
  ['Fly macaroon', /\bFlyV1 fm\d_[A-Za-z0-9_+/=,-]{20,}/],
  ['Fly fo1_', /\bfo1_[A-Za-z0-9_-]{20,}/],
];

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const WORKFLOW = fileURLToPath(
  new URL('../../../.github/workflows/worker-staging.yml', import.meta.url),
);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist') return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const findings = (paths: string[]) =>
  paths.flatMap((path) => {
    const text = readFileSync(path, 'utf8');
    return PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => `${path}: ${name}`);
  });

describe('secret-shaped literals', () => {
  it('the scanner finds real-shaped credentials when they are there', () => {
    // Built from parts at run time, so this file holds none of them.
    const planted = [
      ['sk', 'live', 'Ab12Cd34Ef56Gh78Ij90'].join('_'),
      ['gh', 'p_', 'A'.repeat(36)].join(''),
      ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join(''),
      ['-----BEGIN', ' PRIVATE', ' KEY-----'].join(''),
      ['Fly', 'V1 fm2_', 'x'.repeat(40)].join(''),
    ];
    const dir = mkdtempSync(join(tmpdir(), 'secret-scan-'));
    try {
      const path = join(dir, 'planted.txt');
      writeFileSync(path, planted.join('\n'));
      expect(findings([path])).toHaveLength(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('none in the worker package or its workflow', () => {
    const scanned = [...files(PACKAGE), WORKFLOW];
    expect(scanned.length).toBeGreaterThan(40);
    expect(findings(scanned)).toEqual([]);
  });
});
