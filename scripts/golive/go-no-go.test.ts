import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main, parseArgs } from './check';
import { REPO_ROOT } from './env-scan';
import {
  DOC_PATH,
  GATES,
  WALK_RESULTS_PATH,
  goNoGoLines,
  readWalkResults,
  renderGoNoGo,
} from './go-no-go';
import { PRECONDITIONS } from './preconditions';
import { PROBES, type ProbeId } from './probes/index';
import { pass, type Probe, type ProbeResult } from './probes/types';
import { VERCEL_PROJECT_ID } from './probes/vercel-env';
import { STEPS } from './steps';
import { fakeToken, json, scriptedFetch, scriptedGit } from './test-support';

describe('docs/ops/go-no-go.md', () => {
  it('is the render of GATES, byte for byte', async () => {
    expect(readFileSync(DOC_PATH, 'utf8')).toBe(await renderGoNoGo());
  });

  it('lists each gate id once', async () => {
    const doc = await renderGoNoGo();
    for (const g of GATES) expect(doc.split(`| \`${g.id}\``).length - 1, g.id).toBe(1);
  });
});

describe('the gates', () => {
  it('have distinct ids', () => {
    expect(new Set(GATES.map((g) => g.id)).size).toBe(GATES.length);
  });

  it("are the brief's seven journeys, by spec file", () => {
    expect(GATES.filter((g) => g.how === 'walk').map((g) => g.ref)).toEqual([
      'tests/e2e/1-anonymous.spec.ts',
      'tests/e2e/2-free.spec.ts',
      'tests/e2e/3-pro-trial.spec.ts',
      'tests/e2e/4-agency.spec.ts',
      'tests/e2e/5-settings.spec.ts',
      'tests/e2e/6-v1-urls.spec.ts',
      'tests/e2e/7-support.spec.ts',
    ]);
  });

  it("hold one golive-step gate per step of steps.ts, and name the step's title", async () => {
    const { STEP_TITLE } = await import('./steps');
    const steps = GATES.filter((g) => g.how === 'golive-step');
    expect(steps).toHaveLength(STEPS.length);
    for (const [i, s] of STEPS.entries()) {
      expect(steps[i]!.id).toBe(`golive-step-${s}`);
      expect(steps[i]!.gate).toContain(STEP_TITLE[s]);
      expect(steps[i]!.detail).toContain(`--step ${s} `);
    }
  });

  it("are the brief's owner-ticked items, and the 2FA row names the launch-readiness providers", () => {
    expect(GATES.filter((g) => g.how === 'owner').map((g) => g.id)).toEqual([
      'restore-drill',
      'load-staging',
      'self-audit',
      'live-purchase',
      'cloudflare-ai-crawlers',
      'provider-2fa',
    ]);
    const twoFactor = GATES.find((g) => g.id === 'provider-2fa')!;
    // Launch readiness §6, as written there.
    for (const p of 'GitHub, Vercel, Supabase, Stripe, Cloudflare, Sentry, Namecheap, Google'.split(
      ', ',
    ))
      expect(twoFactor.detail).toContain(p);
    expect(GATES.find((g) => g.id === 'self-audit')!.gate).toContain(
      'crawlmouse.com and nahltech.com',
    );
  });

  it('has one CI gate', () => {
    expect(GATES.filter((g) => g.how === 'ci').map((g) => g.id)).toEqual(['ci-release-sha']);
  });
});

/** A Playwright JSON report (playwright/types/testReporter.d.ts `JSONReport`) with the given tests. */
const WALKED = 'a'.repeat(40);

const report = (
  files: Record<string, string[]>,
  nested = false,
  metadata: Record<string, unknown> = { commit: WALKED },
) => {
  const test = (status: string) => ({ status, projectName: 'chromium', results: [] });
  return JSON.stringify({
    config: { rootDir: '/repo/tests/e2e', metadata },
    stats: { startTime: '2026-11-14T06:00:00.000Z', duration: 1, expected: 0 },
    errors: [],
    suites: Object.entries(files).map(([file, statuses]) => {
      const specs = statuses.map((s, i) => ({ title: `t${i}`, file, tests: [test(s)] }));
      return nested
        ? { title: file, file, specs: [], suites: [{ title: 'describe', file, specs }] }
        : { title: file, file, specs };
    }),
  });
};

const ALL_READY = () => ({ ready: true as const });
/** The inputs of a run on the walked commit. */
const ON_WALKED = { live: null, head: WALKED };

const stateOf = (lines: string[], id: string): string => {
  const line = lines.find((l) => l.startsWith(`  ${id} [`));
  if (line === undefined) throw new Error(`no line for ${id}`);
  return line.slice(line.indexOf(']: ') + 3);
};

describe('the walk states', () => {
  it('are "not run" for every spec when there is no results file', () => {
    const lines = goNoGoLines({ step: ALL_READY, walkResults: null, ...ON_WALKED });
    expect(lines).toContain('  walk: not run (no tests/e2e/results.json)');
    for (const g of GATES.filter((x) => x.how === 'walk'))
      expect(stateOf(lines, g.id)).toBe('not run');
  });

  it("are each spec file's own, read from the report, at any depth", () => {
    for (const nested of [false, true]) {
      const lines = goNoGoLines({
        step: ALL_READY,
        ...ON_WALKED,
        walkResults: report(
          {
            '1-anonymous.spec.ts': ['expected', 'expected', 'skipped'],
            '2-free.spec.ts': ['expected', 'unexpected'],
            '3-pro-trial.spec.ts': ['flaky', 'expected'],
            '4-agency.spec.ts': ['skipped', 'skipped'],
            '6-v1-urls.spec.ts': ['expected', 'expected'],
            // A file whose name ends journey 5's, which the match must not take for it.
            'settings.spec.ts': ['expected'],
          },
          nested,
        ),
      });
      expect(lines).toContain(
        '  walk: tests/e2e/results.json, run started 2026-11-14T06:00:00.000Z, on aaaaaaaaaaaa',
      );
      // A skipped test beside passing ones: the journey was not walked whole.
      expect(stateOf(lines, 'walk-1-anonymous')).toBe('incomplete (2 expected, 1 skipped)');
      expect(stateOf(lines, 'walk-2-free')).toBe('failed (1 expected, 1 unexpected)');
      expect(stateOf(lines, 'walk-3-pro-trial')).toBe('flaky (1 expected, 1 flaky)');
      expect(stateOf(lines, 'walk-4-agency')).toBe('skipped (2 skipped)');
      expect(stateOf(lines, 'walk-5-settings')).toBe('not in tests/e2e/results.json');
      expect(stateOf(lines, 'walk-6-v1-urls')).toBe('passed (2 expected)');
    }
  });

  it('are "unknown" when the file is not a Playwright JSON report', () => {
    for (const text of ['not json', '{"tests": []}']) {
      const lines = goNoGoLines({ step: ALL_READY, walkResults: text, ...ON_WALKED });
      expect(lines[1]).toMatch(/^ {2}walk: unknown \(tests\/e2e\/results\.json is not/);
      expect(stateOf(lines, 'walk-1-anonymous')).toBe('unknown');
    }
    expect(typeof readWalkResults('[]')).toBe('string');
  });
});

describe("the walk's commit", () => {
  const passing = { '7-support.spec.ts': ['expected'] };
  const lines = (walkResults: string, live: string | null, head: string | null) =>
    goNoGoLines({ step: ALL_READY, walkResults, live, head });

  it("is set by the walk's Playwright config, from git's HEAD", () => {
    const config = readFileSync(join(REPO_ROOT, 'tests/e2e/playwright.config.ts'), 'utf8');
    expect(config).toMatch(
      /metadata:\s*\{\s*commit:\s*execFileSync\(\s*'git',\s*\[\s*'rev-parse',\s*'HEAD'\s*\]/,
    );
  });

  it('is read from config.metadata.commit, and a walk on HEAD is not stale', () => {
    const out = lines(report(passing), null, WALKED);
    expect(out[1]).toBe(
      '  walk: tests/e2e/results.json, run started 2026-11-14T06:00:00.000Z, on aaaaaaaaaaaa',
    );
    expect(stateOf(out, 'walk-7-support')).toBe('passed (1 expected)');
  });

  it('is compared with the live commit when it is known, before HEAD', () => {
    const live = 'b'.repeat(40);
    expect(stateOf(lines(report(passing), live, WALKED), 'walk-7-support')).toBe(
      'stale (walked on aaaaaaaaaaaa, the live commit is bbbbbbbbbbbb; passed (1 expected))',
    );
    expect(stateOf(lines(report(passing), WALKED, live), 'walk-7-support')).toBe(
      'passed (1 expected)',
    );
  });

  it('marks the walk stale against HEAD when the live commit is unknown', () => {
    expect(stateOf(lines(report(passing), null, 'c'.repeat(40)), 'walk-7-support')).toBe(
      'stale (walked on aaaaaaaaaaaa, HEAD is cccccccccccc; passed (1 expected))',
    );
    // A spec not in the report is stale too: the report is not this release's either way.
    expect(stateOf(lines(report(passing), null, 'c'.repeat(40)), 'walk-1-anonymous')).toBe(
      'stale (walked on aaaaaaaaaaaa, HEAD is cccccccccccc; not in tests/e2e/results.json)',
    );
  });

  it('marks the walk stale when the report names no commit, or one that is not a sha', () => {
    for (const metadata of [{}, { commit: 'main' }, { commit: 7 }]) {
      const out = lines(report(passing, false, metadata), null, WALKED);
      expect(out[1]).toMatch(/, on a commit it does not name$/);
      expect(stateOf(out, 'walk-7-support')).toBe(
        'stale (the report names no commit; passed (1 expected))',
      );
    }
  });

  it('says it was not compared when neither the live commit nor HEAD is known', () => {
    const out = lines(report(passing), null, null);
    expect(out[1]).toMatch(
      /, on aaaaaaaaaaaa \(not compared: neither the live commit nor HEAD is known\)$/,
    );
    expect(stateOf(out, 'walk-7-support')).toBe('passed (1 expected)');
  });
});

describe('the other states', () => {
  it('are fixed words for CI and the owner rows', () => {
    const lines = goNoGoLines({ step: ALL_READY, walkResults: null, ...ON_WALKED });
    expect(stateOf(lines, 'ci-release-sha')).toBe("check the release SHA's run");
    for (const g of GATES.filter((x) => x.how === 'owner'))
      expect(stateOf(lines, g.id)).toBe('owner-ticked');
  });

  it("are a step's readiness as the input gives it", () => {
    const lines = goNoGoLines({
      step: (s) => (s < 3 ? { ready: true } : { ready: false, blocking: s }),
      walkResults: null,
      ...ON_WALKED,
    });
    expect(stateOf(lines, 'golive-step-2')).toBe('pass');
    expect(stateOf(lines, 'golive-step-4')).toBe(
      'not ready (4 rows gating steps 1–4 do not pass, listed above)',
    );
  });
});

// ── through `pnpm golive:check --go-no-go` ──

const allPass = (): Record<ProbeId, Probe> => {
  const probes: Partial<Record<ProbeId, Probe>> = {};
  for (const id of Object.keys(PROBES) as ProbeId[]) probes[id] = async () => pass('ok');
  return probes as Record<ProbeId, Probe>;
};
const probesWith = (answers: Partial<Record<ProbeId, ProbeResult>>) => {
  const p = allPass();
  for (const [id, r] of Object.entries(answers)) p[id as ProbeId] = async () => r!;
  return p;
};
const ALL_MANUAL = PRECONDITIONS.filter((p) => p.check.kind === 'manual').map((p) => p.id);

async function run(
  argv: string[],
  probes: Record<ProbeId, Probe>,
  opts: { walk?: string | null; live?: string; head?: string; liveInClone?: boolean } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const envFile = `VERCEL_TOKEN=${fakeToken(['vcp'])}`;
  const code = await main(argv, {
    processEnv: {},
    readFile: (path) => (path === WALK_RESULTS_PATH ? (opts.walk ?? null) : envFile),
    fetch: scriptedFetch((url) =>
      url.pathname === `/v9/projects/${VERCEL_PROJECT_ID}`
        ? json({
            targets: { production: { meta: { githubCommitSha: opts.live ?? 'c'.repeat(40) } } },
          })
        : json({}),
    ).fetch,
    now: () => new Date(Date.UTC(2026, 10, 14)),
    git: scriptedGit({
      'cat-file': { code: opts.liveInClone === false ? 1 : 0, stdout: '' },
      'rev-parse': { code: 0, stdout: `${opts.head ?? WALKED}\n` },
      // A diff that names a file: the checkout's inputs differ from the live commit's.
      diff: { code: 0, stdout: opts.live === undefined ? '' : 'scripts/golive/check.ts\n' },
    }),
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    probes,
  });
  return { code, out };
}

describe('pnpm golive:check -- --go-no-go', () => {
  it('is a flag with no value, anywhere among the arguments', () => {
    expect(parseArgs(['--go-no-go'])).toMatchObject({ goNoGo: true, step: 1 });
    expect(parseArgs(['--step', '3', '--go-no-go', '--ticked', ALL_MANUAL[0]!])).toMatchObject({
      goNoGo: true,
      step: 3,
    });
    expect(parseArgs([])).toMatchObject({ goNoGo: false });
  });

  it('prints nothing of the list without the flag', async () => {
    const { out } = await run(['--step', '5'], allPass());
    expect(out.join('\n')).not.toContain('go/no-go');
  });

  it("prints each gate's line, and a step's state from this run's rows", async () => {
    // resend-domain is the probe of one row, and that row gates step 4.
    expect(
      PRECONDITIONS.filter((p) => p.check.kind === 'auto' && p.check.probe === 'resend-domain').map(
        (p) => p.gates,
      ),
    ).toEqual([4]);
    const probes = probesWith({ 'resend-domain': { status: 'fail', reason: 'x' } });
    const argv = ['--step', '3', '--ticked', ALL_MANUAL.join(','), '--go-no-go'];
    const { code, out } = await run(argv, probes, {
      // Walked on the live commit (run's default), so not stale.
      walk: report({ '7-support.spec.ts': ['expected'] }, false, { commit: 'c'.repeat(40) }),
    });
    for (const g of GATES)
      expect(
        out.some((l) => l.startsWith(`  ${g.id} [${g.how}]: `)),
        g.id,
      ).toBe(true);
    expect(stateOf(out, 'golive-step-1')).toBe('pass');
    expect(stateOf(out, 'golive-step-3')).toBe('pass');
    expect(stateOf(out, 'golive-step-4')).toBe(
      'not ready (1 rows gating steps 1–4 do not pass, listed above)',
    );
    expect(stateOf(out, 'golive-step-5')).toBe(
      'not ready (1 rows gating steps 1–5 do not pass, listed above)',
    );
    expect(stateOf(out, 'walk-7-support')).toBe('passed (1 expected)');
    expect(stateOf(out, 'walk-1-anonymous')).toBe('not in tests/e2e/results.json');
    // The exit code is --step's: step 3 is ready, so 0, and the last line is still the verdict.
    expect(code).toBe(0);
    expect(out.at(-1)).toMatch(/^ready for step 3/);
    const without = await run(argv.slice(0, -1), probes);
    expect(without.code).toBe(code);
  });

  it("compares the walk with the live commit the check reads, else with git's HEAD", async () => {
    const walk = report({ '7-support.spec.ts': ['expected'] });
    const argv = ['--ticked', ALL_MANUAL.join(','), '--go-no-go'];
    // The live commit is the walked one: not stale, whatever HEAD is.
    const onLive = await run(argv, allPass(), { walk, live: WALKED, head: 'e'.repeat(40) });
    expect(stateOf(onLive.out, 'walk-7-support')).toBe('passed (1 expected)');
    // The live commit is another (run's default, cccc…), though HEAD is the walked one.
    const offLive = await run(argv, allPass(), { walk });
    expect(stateOf(offLive.out, 'walk-7-support')).toBe(
      'stale (walked on aaaaaaaaaaaa, the live commit is cccccccccccc; passed (1 expected))',
    );
    // The live commit is not in the local clone, so unknown: HEAD decides.
    const noLive = { walk, liveInClone: false };
    expect(stateOf((await run(argv, allPass(), noLive)).out, 'walk-7-support')).toBe(
      'passed (1 expected)',
    );
    expect(
      stateOf(
        (await run(argv, allPass(), { ...noLive, head: 'e'.repeat(40) })).out,
        'walk-7-support',
      ),
    ).toBe('stale (walked on aaaaaaaaaaaa, HEAD is eeeeeeeeeeee; passed (1 expected))');
  });

  it('counts a manual row that is not ticked against its step and the later ones', async () => {
    const step2Manual = PRECONDITIONS.find((p) => p.check.kind === 'manual' && p.gates === 2)!;
    const ticked = ALL_MANUAL.filter((id) => id !== step2Manual.id);
    const { out } = await run(['--ticked', ticked.join(','), '--go-no-go'], allPass());
    expect(stateOf(out, 'golive-step-1')).toBe('pass');
    for (const s of [2, 3, 4, 5])
      expect(stateOf(out, `golive-step-${s}`)).toBe(
        `not ready (1 rows gating steps 1–${s} do not pass, listed above)`,
      );
  });

  it('holds every step not ready while the checkout differs from the live commit', async () => {
    const { out } = await run(['--ticked', ALL_MANUAL.join(','), '--go-no-go'], allPass(), {
      live: 'd'.repeat(40),
    });
    for (const s of STEPS) expect(stateOf(out, `golive-step-${s}`)).toMatch(/^not ready /);
  });
});
