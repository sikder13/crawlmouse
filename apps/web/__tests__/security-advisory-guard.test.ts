import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sentryBuildOptions } from '../next.config.mjs';

// Version floors for the October 2026 dependency advisories.
//
// pnpm-lock.yaml must not resolve an unpatched copy of next, sharp or dompurify. The lockfile is the
// source, not package.json: sharp and dompurify are transitive (next -> sharp, posthog-js ->
// dompurify), so no manifest range pins them.
//
// Floors are kept per release line, because each line is patched separately: next 16.0.0 sorts above
// 15.5.28 and is still vulnerable. Three things fail instead of passing: a version on a line with no
// floor here, a prerelease, and a lockfile key whose version is not plain x.y.z (a tarball, a file: or
// link: path, build metadata). Each needs a person to check the advisories for it first. The floor
// values themselves are pinned against the last vulnerable release on each line, so lowering one
// fails a test.
//
// dompurify: this floor keeps the lockfile and the scanner clean. It does not change the DOMPurify
// that runs on crawlmouse.com: posthog-js inlines its own copy into its product-tours bundle, and
// PostHog serves that bundle to browsers. The app imports only the posthog-js package root, which
// resolves to its dist/ files, and those do not load this package. (posthog-js also ships a lib/ tree
// that does; nothing here imports it.) Both commands print nothing when run from apps/web:
//   grep -lE "require\(['\"]dompurify|from ?['\"]dompurify|import\(['\"]dompurify" node_modules/posthog-js/dist/*.js
//   grep -rnE "['\"]posthog-js/" . --include=*.ts --include=*.tsx --include=*.mjs --exclude-dir=node_modules --exclude-dir=.next

const WEB_DIR = resolve(__dirname, '..');
const LOCKFILE = resolve(__dirname, '../../../pnpm-lock.yaml');
const THIS_FILE = '__tests__/security-advisory-guard.test.ts';

const STRICT_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Compares two x.y.z[-pre] versions by number. A prerelease sorts below its release. */
function compareVersions(a: string, b: string): number {
  const pa = STRICT_VERSION.exec(a);
  const pb = STRICT_VERSION.exec(b);
  if (!pa || !pb) throw new Error(`not an x.y.z version: ${pa ? b : a}`);
  for (let i = 1; i <= 3; i++) {
    const diff = Number(pa[i]) - Number(pb[i]);
    if (diff !== 0) return diff;
  }
  if (pa[4] !== undefined && pb[4] === undefined) return -1;
  if (pa[4] === undefined && pb[4] !== undefined) return 1;
  return 0;
}

/** The release line of an x.y.z version: its major, or `0.minor` for 0.x. Null when not x.y.z. */
function releaseLine(version: string): string | null {
  const parts = STRICT_VERSION.exec(version);
  if (!parts) return null;
  return parts[1] === '0' ? `0.${parts[2]}` : String(parts[1]);
}

/** Returns why `version` fails the per-line floors, or null when it passes. */
function floorViolation(version: string, floors: Readonly<Record<string, string>>): string | null {
  const line = releaseLine(version);
  if (line === null) return `${version} is not an x.y.z version`;
  if (STRICT_VERSION.exec(version)?.[4] !== undefined) return `${version} is a prerelease`;
  if (!Object.hasOwn(floors, line)) {
    return `${version} is on release line ${line}, which has no floor here; check the advisories for that line`;
  }
  const floor = floors[line] as string;
  return compareVersions(version, floor) < 0 ? `${version} is below ${floor}` : null;
}

/**
 * Reads the lockfile keys for `name`: lines at two-space indent that start with `name@`, quoted or
 * not. In a pnpm v9 lockfile those are the `packages:` and `snapshots:` entries; any other section
 * keyed the same way would be read too. The version is the text before a peer suffix such as
 * `(react@19.2.6)`. A key whose version is not x.y.z[-pre] goes to `unparsed`.
 */
function readLockEntries(
  lockfile: string,
  name: string,
): { versions: string[]; unparsed: string[] } {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const key = new RegExp(`^  (['"]?)${escaped}@(.*?)\\1:(?=[ \\t]|$)`, 'gm');
  const versions = new Set<string>();
  const unparsed = new Set<string>();
  for (const match of lockfile.matchAll(key)) {
    const raw = match[2] ?? '';
    const version = raw.split('(', 1)[0] ?? '';
    if (STRICT_VERSION.test(version)) versions.add(version);
    else unparsed.add(`${name}@${raw}`);
  }
  return { versions: [...versions], unparsed: [...unparsed] };
}

const UNPARSED_HINT =
  'has lockfile keys this guard cannot read (a tarball, a file: or link: path, build metadata, or an ' +
  'overrides: entry with a version selector)';

// Checked 2026-10-27: `gh api "advisories?affects=<pkg>@<floor>" --jq length` prints 0 for
// next@15.5.28, next@16.4.1, sharp@0.35.5 and dompurify@3.4.17.
const FLOORS: ReadonlyArray<{
  name: string;
  floors: Readonly<Record<string, string>>;
  advisories: string;
}> = [
  {
    name: 'next',
    floors: { '15': '15.5.28', '16': '16.4.1' },
    advisories:
      'GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r and, on 16.x, GHSA-673q-mjm6-r5xr set these floors',
  },
  {
    name: 'sharp',
    floors: { '0.35': '0.35.5' },
    advisories: 'GHSA-wq5f-xc86-pv6w; GHSA-2464-fhr4-w9xw names sharp 0.35.5 as its remedy',
  },
  {
    name: 'dompurify',
    floors: { '3': '3.4.17' },
    advisories: 'GHSA-cg2g-xh64-v4q7 and GHSA-mrv2-3pqr-j5jr set this floor',
  },
];

// Independent truth for the floor values: the last vulnerable release on each line, taken from the
// advisory ranges. Checked 2026-10-27: `gh api "advisories?affects=<pkg>@<version>" --jq length`
// prints a non-zero count for next@15.5.27, next@16.4.0, sharp@0.35.4 and dompurify@3.4.16.
const LAST_VULNERABLE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  next: { '15': '15.5.27', '16': '16.4.0' },
  sharp: { '0.35': '0.35.4' },
  dompurify: { '3': '3.4.16' },
};

function floorsFor(name: string): Readonly<Record<string, string>> {
  const entry = FLOORS.find((f) => f.name === name);
  if (!entry) throw new Error(`no FLOORS entry for ${name}`);
  return entry.floors;
}

/** Checks a floor table against the last vulnerable releases: each floor sits on its own line and passes, and each last vulnerable release fails. */
function floorTableProblems(
  floors: Readonly<Record<string, string>>,
  lastVulnerable: Readonly<Record<string, string>>,
): string[] {
  const problems: string[] = [];
  for (const [line, floor] of Object.entries(floors)) {
    if (releaseLine(floor) !== line) problems.push(`floor ${floor} is filed under line ${line}`);
    else if (floorViolation(floor, floors) !== null)
      problems.push(`floor ${floor} fails its own table`);
  }
  for (const [line, version] of Object.entries(lastVulnerable)) {
    // A pin on the wrong line, or a prerelease pin, would fail floorViolation for the wrong reason
    // and stop protecting its line, so each pin is checked as strictly as a floor.
    if (releaseLine(version) !== line)
      problems.push(`last vulnerable ${version} is filed under line ${line}`);
    else if (STRICT_VERSION.exec(version)?.[4] !== undefined)
      problems.push(`last vulnerable ${version} is a prerelease`);
    else if (!Object.hasOwn(floors, line))
      problems.push(`no floor for line ${line}, where ${version} is vulnerable`);
    else if (compareVersions(version, floors[line] as string) >= 0)
      problems.push(`${version} is vulnerable but passes`);
  }
  return problems;
}

describe('compareVersions', () => {
  it.each([
    ['15.5.27', '15.5.28', -1],
    ['15.5.28', '15.5.28', 0],
    ['16.0.0', '15.5.28', 1],
    ['0.34.5', '0.35.5', -1],
    // Numeric, not lexicographic: a string compare would put 3.4.9 above 3.4.17.
    ['3.4.9', '3.4.17', -1],
    ['10.53.1', '10.75.2', -1],
    ['10.100.0', '10.75.2', 1],
    ['15.5.28-canary.1', '15.5.28', -1],
  ])('compares %s with %s', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });

  it.each(['15.5.28+build.1', 'v15.5.28', '15.5', 'file:../next.tgz'])('throws on %s', (bad) => {
    expect(() => compareVersions(bad, '15.5.28')).toThrow(/not an x\.y\.z version/);
  });
});

describe('floorViolation, against the real next and sharp floors', () => {
  it.each([
    { version: '15.5.28', passes: true },
    { version: '15.5.30', passes: true },
    { version: '16.4.1', passes: true },
    { version: '15.5.27', passes: false },
    // A newer line is not automatically patched: 16.0.0 sorts above 15.5.28 and is vulnerable.
    { version: '16.0.0', passes: false },
    { version: '16.4.0', passes: false },
    { version: '15.5.18', passes: false },
    { version: '14.2.30', passes: false },
    { version: '17.0.0', passes: false },
    { version: '15.5.29-canary.0', passes: false },
    { version: '15.5.28+build.1', passes: false },
  ])('next $version -> passes: $passes', ({ version, passes }) => {
    expect(floorViolation(version, floorsFor('next')) === null).toBe(passes);
  });

  it('reads 0.x release lines by minor', () => {
    const sharpFloors = floorsFor('sharp');
    expect(floorViolation('0.35.5', sharpFloors)).toBeNull();
    expect(floorViolation('0.35.4', sharpFloors)).toMatch(/below 0\.35\.5/);
    expect(floorViolation('0.34.5', sharpFloors)).toMatch(/release line 0\.34,/);
    expect(floorViolation('0.36.0', sharpFloors)).toMatch(/release line 0\.36,/);
  });

  it('does not take release lines from inherited keys', () => {
    const floors = Object.create({ '15': '0.0.0' }) as Record<string, string>;
    expect(floorViolation('15.0.0', floors)).toMatch(/no floor here/);
  });
});

describe('floor values against the last vulnerable releases', () => {
  it.each(FLOORS)('$name', ({ name, floors }) => {
    const lastVulnerable = LAST_VULNERABLE[name];
    expect(lastVulnerable, `no last-vulnerable releases recorded for ${name}`).toBeDefined();
    expect(
      Object.keys(floors).sort(),
      `${name}: floors and last-vulnerable releases cover different lines`,
    ).toEqual(Object.keys(lastVulnerable ?? {}).sort());
    expect(floorTableProblems(floors, lastVulnerable ?? {})).toEqual([]);
  });

  it('catches a lowered floor, a floor or pin filed under the wrong line, and a prerelease pin', () => {
    const last = { '15': '15.5.27', '16': '16.4.0' };
    expect(floorTableProblems({ '15': '15.5.18', '16': '16.4.1' }, last)).toEqual([
      '15.5.27 is vulnerable but passes',
    ]);
    expect(floorTableProblems({ '15': '15.5.28', '16': '15.5.28' }, last)).toContain(
      'floor 15.5.28 is filed under line 16',
    );
    expect(floorTableProblems({ '3': '3.0.0' }, { '3': '2.4.16' })).toEqual([
      'last vulnerable 2.4.16 is filed under line 3',
    ]);
    expect(floorTableProblems({ '3': '3.0.0' }, { '3': '3.4.16-rc.1' })).toEqual([
      'last vulnerable 3.4.16-rc.1 is a prerelease',
    ]);
  });
});

describe('readLockEntries', () => {
  const sample = [
    'packages:',
    '',
    "  '@next/env@15.5.18':",
    '  next-themes@0.4.6:',
    '  next@15.5.18:',
    "  '@sentry/nextjs@10.53.1':",
    '  dompurify@3.4.5:',
    '',
    'snapshots:',
    '',
    '  next@15.5.18(@babel/core@7.29.0)(react@19.2.6):',
    '    dependencies:',
    '      sharp: 0.34.5',
    "  '@sentry/nextjs@10.53.1(next@15.5.18(react@19.2.6))(react@19.2.6)':",
    '  sharp@0.34.5: {}',
    '  "next@16.0.0-canary.3":',
  ].join('\n');

  it('reads unquoted, quoted, peer-suffixed, prerelease and `: {}` keys', () => {
    expect(readLockEntries(sample, 'next')).toEqual({
      versions: ['15.5.18', '16.0.0-canary.3'],
      unparsed: [],
    });
    expect(readLockEntries(sample, '@sentry/nextjs')).toEqual({
      versions: ['10.53.1'],
      unparsed: [],
    });
    expect(readLockEntries(sample, 'sharp')).toEqual({ versions: ['0.34.5'], unparsed: [] });
  });

  it('does not read packages whose names only share a prefix or suffix with the target', () => {
    expect(readLockEntries('  next-themes@0.4.6:\n', 'next').versions).toEqual([]);
    expect(readLockEntries("  '@next/env@15.5.18':\n", 'next').versions).toEqual([]);
    expect(readLockEntries("  '@next/env@15.5.18':\n", 'env').versions).toEqual([]);
    expect(readLockEntries("  '@sentry/nextjs-foo@1.0.0':\n", '@sentry/nextjs').versions).toEqual(
      [],
    );
  });

  it('reads two-space keys only', () => {
    expect(readLockEntries('    next@15.5.18:\n', 'next').versions).toEqual([]);
    expect(readLockEntries('next@15.5.18:\n', 'next').versions).toEqual([]);
    expect(readLockEntries('      next@15.5.18: {}\n', 'next').versions).toEqual([]);
  });

  it.each([
    '  next@15.5.18+build.1:',
    '  next@file:../vendor/next.tgz:',
    '  next@https://example.com/next-15.5.18.tgz:',
    '  next@link:../next:',
  ])('reports %s as unparsed instead of skipping it', (line) => {
    const { versions, unparsed } = readLockEntries(`${line}\n`, 'next');
    expect(versions).toEqual([]);
    expect(unparsed).toHaveLength(1);
  });
});

describe('pnpm-lock.yaml resolves patched versions', () => {
  const lockfile = readFileSync(LOCKFILE, 'utf8');

  it.each(FLOORS)('$name meets its per-line floors', ({ name, floors, advisories }) => {
    const { versions, unparsed } = readLockEntries(lockfile, name);
    expect(unparsed, `${name} ${UNPARSED_HINT}`).toEqual([]);
    // An empty list would make the floor check pass vacuously, so require at least one copy.
    expect(versions.length, `${name} not found in pnpm-lock.yaml`).toBeGreaterThan(0);
    const failures = versions
      .map((v) => floorViolation(v, floors))
      .filter((r): r is string => r !== null);
    expect(failures, `${name}: ${failures.join('; ')} (${advisories})`).toEqual([]);
  });
});

// Sentry tunnelRoute. GHSA-mchm-gjx6-7h55 (a middleware bypass) needs `tunnelRoute` to be set. It is
// patched in @sentry/nextjs 9.47.2, 10.75.2 and 11.0.0-rc.1; the SDK upgrade is a separate change.
// Until it lands, two checks keep the tunnel off:
// - the real `sentryBuildOptions` must not set tunnelRoute. The SDK treats any truthy value as on,
//   and turns a non-string such as `true` into a random path.
// - no file under apps/web, of any type, may mention `tunnelRoute`, this file aside. Reading the
//   value alone misses one that depends on the environment, such as `process.env.VERCEL ?
//   '/monitoring' : undefined`, which is unset when this test runs and set on Vercel. Scanning all
//   of apps/web rather than next.config.mjs alone also covers options moved into another module or
//   file type, and a sibling next.config.js, which Next checks for before next.config.mjs.
// These checks are for ordinary edits, not deliberate evasion. Known ways past both: the key spelled
// with a Unicode or hex escape, a key assembled from string pieces, a key read from the environment
// (for example parsed out of a JSON env var), and code outside apps/web.
// `sentry-sourcemap-guard.test.ts` pins the call site to `withSentryConfig(nextConfig,
// sentryBuildOptions)`, so swapping the options object there fails it.

// Checked 2026-10-27: `gh api "advisories?affects=@sentry/nextjs@<version>" --jq length` prints 0 for
// 9.47.2, 10.75.2 and 11.0.0, and 1 for 9.47.1 and 10.75.1. Line 11 has no vulnerable full release.
const SENTRY_TUNNEL_FLOORS: Readonly<Record<string, string>> = {
  '9': '9.47.2',
  '10': '10.75.2',
  '11': '11.0.0',
};
const SENTRY_LAST_VULNERABLE: Readonly<Record<string, string>> = { '9': '9.47.1', '10': '10.75.1' };

/** Returns a message when tunnelRoute is set while any resolved @sentry/nextjs is unpatched. */
function tunnelRouteViolation(options: object, sentryVersions: string[]): string | null {
  const tunnelRoute = (options as { tunnelRoute?: unknown }).tunnelRoute;
  if (tunnelRoute === undefined || tunnelRoute === null || tunnelRoute === false) return null;
  const unpatched = sentryVersions.filter((v) => floorViolation(v, SENTRY_TUNNEL_FLOORS) !== null);
  if (unpatched.length === 0) return null;
  return (
    `tunnelRoute is set (${JSON.stringify(tunnelRoute)}) but @sentry/nextjs ${unpatched.join(', ')} ` +
    'is unpatched for GHSA-mchm-gjx6-7h55 (middleware bypass). Upgrade Sentry first.'
  );
}

/** True when `source` contains the identifier `tunnelRoute`: as a key, a quoted key, a shorthand or a comment. */
function mentionsTunnelRoute(source: string): boolean {
  return /\btunnelRoute\b/.test(source);
}

/**
 * Files under apps/web, relative to it, that git tracks or would track, of every type: options can
 * come from .mts, .cts or .json as easily as from .mjs, so no extension is left out. `--exclude-standard`
 * leaves out gitignored paths such as node_modules and .next; untracked files are included so a new
 * file is checked before it is committed.
 */
function webFiles(): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: WEB_DIR,
      encoding: 'utf8',
    },
  );
  return [...new Set(out.split('\0').filter(Boolean))].filter((f) =>
    existsSync(resolve(WEB_DIR, f)),
  );
}

describe('Sentry tunnelRoute stays off while the SDK is unpatched (GHSA-mchm-gjx6-7h55)', () => {
  it('the Sentry floors sit on their own lines and reject the last vulnerable releases', () => {
    expect(floorTableProblems(SENTRY_TUNNEL_FLOORS, SENTRY_LAST_VULNERABLE)).toEqual([]);
  });

  it.each([
    {
      label: 'a string path, 10.53.1',
      options: { tunnelRoute: '/monitoring' },
      versions: ['10.53.1'],
      violation: true,
    },
    {
      label: 'true, 10.53.1',
      options: { tunnelRoute: true },
      versions: ['10.53.1'],
      violation: true,
    },
    {
      label: 'an empty string, 10.53.1 (fails closed)',
      options: { tunnelRoute: '' },
      versions: ['10.53.1'],
      violation: true,
    },
    {
      label: 'set, 10.75.2 and 10.53.1',
      options: { tunnelRoute: true },
      versions: ['10.75.2', '10.53.1'],
      violation: true,
    },
    { label: 'set, 9.46.0', options: { tunnelRoute: true }, versions: ['9.46.0'], violation: true },
    {
      label: 'set, 11.0.0-alpha.3 (prerelease)',
      options: { tunnelRoute: true },
      versions: ['11.0.0-alpha.3'],
      violation: true,
    },
    {
      label: 'set, 12.0.0 (no floor for the line)',
      options: { tunnelRoute: true },
      versions: ['12.0.0'],
      violation: true,
    },
    {
      label: 'set, 10.75.2',
      options: { tunnelRoute: '/monitoring' },
      versions: ['10.75.2'],
      violation: false,
    },
    {
      label: 'set, 10.77.1',
      options: { tunnelRoute: true },
      versions: ['10.77.1'],
      violation: false,
    },
    {
      label: 'set, 9.47.2',
      options: { tunnelRoute: true },
      versions: ['9.47.2'],
      violation: false,
    },
    {
      label: 'set, 11.0.0',
      options: { tunnelRoute: true },
      versions: ['11.0.0'],
      violation: false,
    },
    { label: 'unset, 10.53.1', options: {}, versions: ['10.53.1'], violation: false },
    {
      label: 'false, 10.53.1',
      options: { tunnelRoute: false },
      versions: ['10.53.1'],
      violation: false,
    },
    {
      label: 'undefined, 10.53.1',
      options: { tunnelRoute: undefined },
      versions: ['10.53.1'],
      violation: false,
    },
  ])('tunnelRoute $label -> violation: $violation', ({ options, versions, violation }) => {
    expect(tunnelRouteViolation(options, versions) !== null).toBe(violation);
  });

  it.each([
    { source: "  tunnelRoute: '/monitoring',", mentions: true },
    { source: "  'tunnelRoute': true,", mentions: true },
    { source: '  "tunnelRoute": "/monitoring",', mentions: true },
    { source: '  ...base, tunnelRoute,', mentions: true },
    { source: "  tunnelRoute: process.env.VERCEL ? '/monitoring' : undefined,", mentions: true },
    { source: '  // tunnelRoute stays off until the SDK upgrade', mentions: true },
    { source: "  tunnel: '/monitoring',", mentions: false },
    { source: "  org: 'nahl-technologies-inc',", mentions: false },
  ])('mentionsTunnelRoute: $source -> $mentions', ({ source, mentions }) => {
    expect(mentionsTunnelRoute(source)).toBe(mentions);
  });

  describe('against the real lockfile and apps/web', () => {
    const { versions, unparsed } = readLockEntries(
      readFileSync(LOCKFILE, 'utf8'),
      '@sentry/nextjs',
    );
    const sdkUnpatched = versions.some((v) => floorViolation(v, SENTRY_TUNNEL_FLOORS) !== null);

    it('finds @sentry/nextjs in the lockfile', () => {
      expect(unparsed, `@sentry/nextjs ${UNPARSED_HINT}`).toEqual([]);
      expect(versions.length, '@sentry/nextjs not found in pnpm-lock.yaml').toBeGreaterThan(0);
    });

    it('sentryBuildOptions does not set tunnelRoute with an unpatched SDK', () => {
      expect(tunnelRouteViolation(sentryBuildOptions, versions)).toBeNull();
    });

    it.runIf(sdkUnpatched)(
      'no file under apps/web mentions tunnelRoute while the SDK is unpatched',
      () => {
        const files = webFiles().filter((f) => f !== THIS_FILE);
        // Anti-vacuity: if git returned nothing (wrong cwd, no git) or a narrowed list, the scan below
        // would pass on too few files. It must see at least these two, of different types.
        expect(files, 'the scan does not see next.config.mjs and middleware.ts').toEqual(
          expect.arrayContaining(['next.config.mjs', 'middleware.ts']),
        );
        const offenders = files.filter((f) =>
          mentionsTunnelRoute(readFileSync(resolve(WEB_DIR, f), 'utf8')),
        );
        expect(
          offenders,
          `these files mention tunnelRoute while @sentry/nextjs ${versions.join(', ')} is unpatched for ` +
            'GHSA-mchm-gjx6-7h55. Upgrade Sentry first, or remove the mention.',
        ).toEqual([]);
      },
    );
  });
});
