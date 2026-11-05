/**
 * No secret-shaped literal anywhere in the engine package: the Browser Run credentials come from the
 * environment only. Every text file under src/ and fixtures/ is read, and each gzip file is read after
 * decompressing it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/** Shapes of live credentials. Each is pinned by the planted examples below. */
const SECRET_SHAPES: readonly [name: string, pattern: RegExp][] = [
  ['32-hex identifier or key', /\b[a-f0-9]{32}\b/],
  ['bearer token', /Bearer [A-Za-z0-9_.-]{20,}/],
  ['Stripe live key', /\b(?:sk|rk)_live_[A-Za-z0-9]{10,}/],
  ['webhook secret', /\bwhsec_[A-Za-z0-9]{10,}/],
  ['GitHub token', /\b(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}/],
  ['AWS key id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}/],
  ['private key', /BEGIN [A-Z ]*PRIVATE KEY/],
  ['JWT', /\beyJhbGciOi[A-Za-z0-9_-]{10,}/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
];

const ROOT = new URL('../../../', import.meta.url);

function files(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(new URL(`${e.name}/`, dir)) : [new URL(e.name, dir)],
  );
}

function textOf(file: URL): string {
  const bytes = readFileSync(file);
  return file.pathname.endsWith('.gz')
    ? gunzipSync(bytes).toString('utf8')
    : bytes.toString('utf8');
}

const shapesIn = (text: string) => SECRET_SHAPES.filter(([, re]) => re.test(text)).map(([n]) => n);

describe('the engine package', () => {
  const scanned = [...files(new URL('src/', ROOT)), ...files(new URL('fixtures/', ROOT))];

  it('is scanned whole, so a clean result is not an empty scan', () => {
    expect(scanned.some((f) => f.pathname.endsWith('/v2/render/client.ts'))).toBe(true);
    expect(scanned.some((f) => f.pathname.endsWith('.gz'))).toBe(true);
    expect(scanned.length).toBeGreaterThan(200);
  });

  it('holds no secret-shaped literal', () => {
    const found = scanned.flatMap((f) =>
      shapesIn(textOf(f)).map((shape) => `${f.pathname.slice(ROOT.pathname.length)}: ${shape}`),
    );
    expect(found).toEqual([]);
  });
});

describe('the scan', () => {
  // Built at run time, so this file holds none of the shapes it looks for.
  const planted: [string, string][] = [
    ['32-hex identifier or key', 'a1'.repeat(16)],
    ['bearer token', `Bearer ${'t'.repeat(30)}`],
    ['Stripe live key', `${'sk'}_live_${'x'.repeat(24)}`],
    ['webhook secret', `${'whsec'}_${'x'.repeat(24)}`],
    ['GitHub token', `${'ghp'}_${'x'.repeat(36)}`],
    ['AWS key id', `${'AKIA'}${'A'.repeat(16)}`],
    ['Google API key', `${'AIza'}${'x'.repeat(35)}`],
    ['private key', `-----${'BEGIN'} RSA PRIVATE KEY-----`],
    ['JWT', `${'eyJhbGciOi'}${'x'.repeat(20)}`],
    ['Slack token', `${'xoxb'}-${'1'.repeat(20)}`],
  ];

  it.each(planted)('finds a planted %s', (name, value) => {
    expect(shapesIn(`const x = "${value}";`)).toContain(name);
  });

  it('has a planted example for every shape', () => {
    expect(planted.map(([n]) => n)).toEqual(SECRET_SHAPES.map(([n]) => n));
  });
});
