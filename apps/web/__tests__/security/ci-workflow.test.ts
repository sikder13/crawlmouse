import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  KEEP,
  SKIP,
  needsVisual,
  parseChanged,
  skippable,
} from '../../../../.github/workflows/scripts/changes.mjs';
import tailwindConfig from '../../tailwind.config';

// CI's trigger, CodeQL's condition, and when the visual shards, security-browser and zap-baseline
// run (.github/workflows/ci.yml, .github/workflows/scripts/changes.mjs). The workflow is parsed with
// the `yaml` package, which reads YAML 1.2: the key `on` is the string "on", as GitHub reads it,
// where a YAML 1.1 parser would read the boolean true. The `visual` job's script is executed.

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const CI_FILE = join(REPO, '.github/workflows/ci.yml');

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};
type Job = {
  needs?: string | string[];
  if?: string;
  steps?: Step[];
  outputs?: Record<string, string>;
};
const ci = parse(readFileSync(CI_FILE, 'utf8')) as {
  on: unknown;
  concurrency: { group: string };
  jobs: Record<string, Job>;
};

function job(name: string): Job {
  const j = ci.jobs[name];
  if (!j) throw new Error(`ci.yml has no job ${name}`);
  return j;
}

function needs(name: string): string[] {
  const n = job(name).needs;
  return n === undefined ? [] : Array.isArray(n) ? n : [n];
}

describe('ci.yml triggers', () => {
  it('runs on pushes, a pull request opened, reopened or marked ready, a dispatch, and nightly', () => {
    expect(ci.on).toEqual({
      push: { branches: ['**'] },
      pull_request: { types: ['opened', 'reopened', 'ready_for_review'] },
      workflow_dispatch: {
        inputs: {
          visual: {
            description:
              'Run the visual set (the shards, security-browser, ZAP) as if a pull request were open',
            type: 'boolean',
            default: false,
          },
        },
      },
      schedule: [{ cron: '0 3 * * *' }],
    });
  });

  it('keys its concurrency group on the ref, with one group per run on main', () => {
    expect(ci.concurrency.group).toBe(
      "ci-${{ github.ref }}${{ github.ref == 'refs/heads/main' && format('-{0}', github.run_id) || '' }}",
    );
  });

  // A pull request's later pushes run the visual set from the push itself (its pull request is open),
  // so a pull_request run on `synchronize` would only run everything a second time.
  it('runs on a pull request only when it is opened, reopened or marked ready', () => {
    expect((ci.on as { pull_request: { types: string[] } }).pull_request.types).toEqual([
      'opened',
      'reopened',
      'ready_for_review',
    ]);
  });
});

describe('codeql', () => {
  it('runs only while the repository is public, and not on the nightly run', () => {
    expect(job('codeql').if).toBe(
      "${{ github.event_name != 'schedule' && !github.event.repository.private }}",
    );
  });

  it('uploads its results from every run', () => {
    const analyze = (job('codeql').steps ?? []).find((s) =>
      s.uses?.startsWith('github/codeql-action/analyze@'),
    );
    expect(analyze?.with?.upload).toBe('always');
  });
});

describe('the changes job and the jobs it gates', () => {
  it('checks out the full history without credentials, at the pinned checkout', () => {
    const [checkout] = job('changes').steps ?? [];
    const lintCheckout = (job('lint').steps ?? [])[0];
    expect(checkout?.uses).toBe(lintCheckout?.uses);
    expect(checkout?.with).toEqual({ 'fetch-depth': 0, 'persist-credentials': false });
  });

  it('may read pull requests, and nothing else beyond the contents', () => {
    expect((job('changes') as { permissions?: unknown }).permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
    });
  });

  it('outputs gate and visual from its decide step, and runs changes.mjs on the merge-base diff', () => {
    expect(job('changes').outputs).toEqual({
      gate: '${{ steps.decide.outputs.gate }}',
      visual: '${{ steps.decide.outputs.visual }}',
    });
    const decide = (job('changes').steps ?? []).find((s) => (s as { id?: string }).id === 'decide');
    expect(decide?.run).toContain('git merge-base origin/main HEAD');
    expect(decide?.run).toContain('--no-renames');
    expect(decide?.run).toContain('node .github/workflows/scripts/changes.mjs');
  });

  it.each(['visual-shard', 'security-browser', 'zap-baseline'])(
    '%s runs only when visual is true',
    (name) => {
      expect(needs(name)).toContain('changes');
      expect(job(name).if).toBe("needs.changes.outputs.visual == 'true'");
    },
  );

  // Run 43280365648: shard 6 reached a 60-minute limit (45.4 min of checks, then "Propose
  // baselines" cancelled at 13.8 min) and shard 1 took 55.7 min, so a failing run left no artifact.
  it('gives each visual shard 90 minutes, so a failing shard can still propose its baselines', () => {
    expect((job('visual-shard') as { 'timeout-minutes'?: number })['timeout-minutes']).toBe(90);
  });

  // Q51 (CC-31): one `next dev` holding every preview route crossed Next's restart line while
  // warming, so each shard runs once per half of the routes, on its own runner (tests/visual/part.ts).
  describe('the visual shards split the preview routes in two', () => {
    const shard = job('visual-shard') as Job & { strategy?: { matrix?: Record<string, unknown> } };
    const step = (name: string) => {
      const found = (shard.steps ?? []).find((s) => s.name === name);
      if (!found) throw new Error(`visual-shard has no step ${name}`);
      return found;
    };

    it('has a part axis of 1 and 2 beside the six shards', () => {
      expect(shard.strategy?.matrix?.shard).toEqual([1, 2, 3, 4, 5, 6]);
      expect(shard.strategy?.matrix?.part).toEqual([1, 2]);
    });

    it.each(['Visual, layout and accessibility checks', 'Propose baselines from this run'])(
      '"%s" checks the job\'s half, so it proposes for the tests it ran',
      (name) => {
        expect(step(name).env?.VISUAL_PART).toBe('${{ matrix.part }}/2');
      },
    );

    it('runs the production-build steps once, on shard 1 part 1, over every route', () => {
      const once = (shard.steps ?? []).filter((s) =>
        (s as { if?: string }).if?.includes('matrix.shard == 1'),
      );
      expect(once.map((s) => s.name)).toEqual([
        'Production build for the budgets',
        'Runner probe',
        'Performance budgets, on next start',
        'Production checks, on next start',
        'Upload the flake register row',
        'On any Vercel environment the previews are a 404',
      ]);
      for (const s of once) {
        expect((s as { if?: string }).if).toBe(
          '${{ matrix.shard == 1 && matrix.part == 1 && !cancelled() }}',
        );
        expect(s.env?.VISUAL_PART).toBeUndefined();
      }
    });

    it('names each artifact by its shard and its part, so the two halves do not collide', () => {
      expect(step('Upload proposed baselines and diffs').with?.name).toBe(
        'visual-${{ github.run_id }}-${{ github.run_attempt }}-shard${{ matrix.shard }}-part${{ matrix.part }}',
      );
    });
  });

  it('security-browser and zap-baseline still need the build', () => {
    expect(needs('security-browser')).toEqual(['build', 'changes']);
    expect(needs('zap-baseline')).toEqual(['build', 'changes']);
  });

  it('the required visual check needs both, and always runs', () => {
    expect(needs('visual')).toEqual(['changes', 'visual-shard']);
    expect(job('visual').if).toBe('${{ always() }}');
  });

  // The ruleset requires a check named exactly `visual`. On a push the gate defers, the job takes
  // another name, so no check named `visual` exists on that commit and the requirement stays unmet.
  // Only an explicit `deferred` renames it: a changes job that failed leaves the name `visual`, and
  // the rule below fails it.
  it('is named visual unless the gate deferred the visual set', () => {
    expect((job('visual') as { name?: string }).name).toBe(
      "${{ needs.changes.outputs.gate == 'deferred' && 'visual (deferred: no open pull request)' || 'visual' }}",
    );
  });
});

describe('the build artifact security-browser and zap-baseline start', () => {
  // "Re-run failed jobs" re-runs those two without the build that passed, so their download must
  // name what the build of an earlier attempt uploaded: a name keyed on the run, not the attempt
  // (run 42671166085, attempt 2, failed on "Artifact not found" when it was keyed on the attempt).
  // A full re-run builds again under the same name, which the upload must be allowed to replace.
  function artifactSteps(jobName: string, action: 'upload-artifact' | 'download-artifact') {
    return (job(jobName).steps ?? []).filter(
      (s) =>
        s.uses?.startsWith(`actions/${action}@`) && String(s.with?.name).startsWith('next-build-'),
    );
  }
  const uploads = artifactSteps('build', 'upload-artifact');
  const consumers = ['security-browser', 'zap-baseline'] as const;

  it('is uploaded once by build, named by the run id alone, and may be replaced', () => {
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.with?.name).toBe('next-build-${{ github.run_id }}');
    expect(uploads[0]!.with?.overwrite).toBe(true);
  });

  it.each(consumers)('%s downloads exactly the name build uploads', (consumer) => {
    const downloads = artifactSteps(consumer, 'download-artifact');
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.with?.name).toBe(uploads[0]!.with?.name);
  });

  it('no job downloads an artifact whose name reads the attempt', () => {
    const offenders = Object.entries(ci.jobs).flatMap(([name, j]) =>
      (j.steps ?? [])
        .filter((s) => s.uses?.startsWith('actions/download-artifact@'))
        .filter((s) => /run_attempt/i.test(String(s.with?.name ?? '')))
        .map(() => name),
    );
    expect(offenders).toEqual([]);
  });
});

describe('the rule the required visual check applies', () => {
  const [step] = job('visual').steps ?? [];

  it('reads the three results and the gate through env', () => {
    expect(step?.env).toEqual({
      SHARDS: '${{ needs.visual-shard.result }}',
      CHANGES: '${{ needs.changes.result }}',
      VISUAL: '${{ needs.changes.outputs.visual }}',
      GATE: '${{ needs.changes.outputs.gate }}',
    });
  });

  function rule(SHARDS: string, CHANGES: string, VISUAL: string, GATE = 'open') {
    return spawnSync('bash', ['-c', step?.run ?? 'exit 99'], {
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        SHARDS,
        CHANGES,
        VISUAL,
        GATE,
      },
      encoding: 'utf8',
    });
  }

  // The passing triples, written out: the shards passed (whatever `changes` reported), or they
  // were skipped because `changes` passed and said visual=false. Every other triple fails.
  // shards=success with changes other than success cannot occur (the shards need changes); those
  // triples are listed only because the rule, as written, passes them.
  const PASSING = new Set([
    'success/success/true',
    'success/success/false',
    'success/success/',
    'success/failure/true',
    'success/failure/false',
    'success/failure/',
    'success/cancelled/true',
    'success/cancelled/false',
    'success/cancelled/',
    'success/skipped/true',
    'success/skipped/false',
    'success/skipped/',
    'skipped/success/false',
  ]);

  const RESULTS = ['success', 'failure', 'cancelled', 'skipped'];
  const cases = RESULTS.flatMap((shards) =>
    RESULTS.flatMap((changes) =>
      ['true', 'false', ''].map((visual) => [shards, changes, visual] as const),
    ),
  );

  it.each(cases)('shards=%s changes=%s visual=%j', (shards, changes, visual) => {
    const r = rule(shards, changes, visual);
    expect(r.status, r.stdout + r.stderr).not.toBeNull();
    expect(r.status === 0, r.stdout + r.stderr).toBe(PASSING.has(`${shards}/${changes}/${visual}`));
  });

  it.each([
    ['skipped', 'failure', ''],
    ['skipped', 'cancelled', ''],
    ['skipped', 'success', 'true'],
    ['skipped', 'success', ''],
    ['failure', 'success', 'true'],
    ['cancelled', 'success', 'true'],
  ])('fails, naming why: shards=%s changes=%s visual=%j', (shards, changes, visual) => {
    const r = rule(shards, changes, visual);
    expect(r.status).not.toBeNull();
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^::error::/m);
  });

  // The gate changes the job's name (above), never its verdict: the name is what keeps a deferred
  // push from satisfying the ruleset.
  it.each(cases)(
    'gives one verdict under every gate: shards=%s changes=%s visual=%j',
    (s, c, v) => {
      const verdicts = ['open', 'deferred', ''].map((g) => rule(s, c, v, g).status);
      expect(verdicts.every((x) => x !== null)).toBe(true);
      expect(new Set(verdicts).size).toBe(1);
    },
  );

  it('says why the shards did not run when the gate deferred them', () => {
    const r = rule('skipped', 'success', 'false', 'deferred');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('no open pull request');
  });
});

describe('changes.mjs', () => {
  it('pins the skip list and its exceptions', () => {
    expect(SKIP).toEqual([
      'docs/**',
      '*.md',
      'infra/**',
      'scripts/**',
      'packages/worker/**',
      'evidence/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/__tests__/**',
      '.github/workflows/db-*.yml',
      '.github/workflows/nightly.yml',
      '.github/workflows/worker-staging.yml',
      '.github/workflows/scripts/**',
      'osv-scanner.toml',
      '.gitleaksignore',
      'renovate.json',
    ]);
    expect(KEEP).toEqual([
      'docs/design/**',
      'tests/visual/**',
      'packages/types/**',
      'packages/engine/**',
      'packages/timing/**',
      'apps/web/app/**',
      'apps/web/components/**',
      'apps/web/__tests__/security/browser/**',
      '.github/workflows/scripts/changes.mjs',
      '**/package.json',
    ]);
  });

  it.each([
    ['docs only', ['docs/ops/db-migrations.md', 'README.md'], false],
    ['docs and a lib file', ['docs/ops/a.md', 'apps/web/lib/x.ts'], true],
    ['a web test file', ['apps/web/foo.test.ts'], false],
    ['a web component test, which Tailwind scans', ['apps/web/components/v2/x.test.tsx'], true],
    ['a route test, which Tailwind scans', ['apps/web/app/api/health/route.test.ts'], true],
    ['a lib test', ['apps/web/lib/x.test.ts'], false],
    ['a folder only ending in __tests__', ['apps/web/lib/x__tests__/a.ts'], true],
    ['a test file at the root', ['a.test.ts'], false],
    ['a web __tests__ file', ['apps/web/__tests__/v2/a.ts'], false],
    ['a security-browser spec', ['apps/web/__tests__/security/browser/headers.pw.ts'], true],
    ['a visual spec', ['tests/visual/a.spec.ts'], true],
    ['a visual baseline', ['tests/visual/__snapshots__/a.png'], true],
    ['a locked design screen', ['docs/design/v2/screens/Final-Crawl.dc.html'], true],
    ['nothing at all', [], true],
    ['ci.yml', ['.github/workflows/ci.yml'], true],
    ['the setup action', ['.github/actions/setup/action.yml'], true],
    ['the lockfile', ['pnpm-lock.yaml'], true],
    ['the root manifest', ['package.json'], true],
    ['a manifest under a skipped directory', ['inngest/package.json'], true],
    ['the CI env file', ['apps/web/.env.ci'], true],
    ['changes.mjs itself', ['.github/workflows/scripts/changes.mjs'], true],
    ['the sarif gate', ['.github/workflows/scripts/sarif-gate.mjs'], false],
    ['a production workflow', ['.github/workflows/db-apply-prod.yml'], false],
    ['an engine test', ['packages/engine/src/a.test.ts'], true],
    ['a worker source file', ['packages/worker/src/a.ts'], false],
    ['an inngest source file, which API routes import', ['inngest/audit.ts'], true],
    ['an inngest test', ['inngest/audit.test.ts'], false],
    ['a markdown file below the root', ['apps/web/README.md'], true],
    ['a prefix of scripts/ that is not scripts/', ['scripts-x/a'], true],
    ['a prefix of docs/ that is not docs/', ['docsx/a'], true],
    ['a prefix of docs/design that is not it', ['docs/designs/a.md'], false],
    ['a prefix of evidence/', ['evidencex/a'], true],
    ['a file named like a test, not ending in one', ['apps/web/lib/a.test.ts.bak'], true],
  ])('%s', (_label, files, want) => {
    expect(needsVisual(files)).toBe(want);
  });

  it("reads Tailwind's content as folder globs, so the cases below are not vacuous", () => {
    expect(tailwindConfig.content).toEqual(['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}']);
  });

  it.each((tailwindConfig.content as string[]).map((glob) => [glob]))(
    "keeps test files under Tailwind's content glob %s",
    (glob) => {
      expect(glob).toMatch(/^\.\/[a-z][\w-]*\/\*\*\//);
      const dir = join('apps/web', glob.slice(0, glob.indexOf('/**')))
        .split(sep)
        .join('/');
      expect(dir).toMatch(/^apps\/web\/[a-z]/);
      expect(skippable(`${dir}/x.test.tsx`)).toBe(false);
      expect(skippable(`${dir}/x.test.ts`)).toBe(false);
      expect(skippable(`${dir}/__tests__/a.tsx`)).toBe(false);
    },
  );

  it('reads NUL-separated paths (keeping a newline inside a name), else lines', () => {
    expect(parseChanged('a\0b c\0')).toEqual(['a', 'b c']);
    expect(parseChanged('a\nb\0c\0')).toEqual(['a\nb', 'c']);
    expect(parseChanged('a\nb\n')).toEqual(['a', 'b']);
  });

  function cli(stdin: string) {
    return spawnSync(process.execPath, [join(REPO, '.github/workflows/scripts/changes.mjs')], {
      input: stdin,
      encoding: 'utf8',
    });
  }

  it.each([
    ['a docs-only diff', 'docs/a.md\0README.md\0', 'visual=false'],
    ['a rendering diff', 'docs/a.md\0apps/web/lib/x.ts\0', 'visual=true'],
    ['an empty diff', '', 'visual=true'],
  ])('as a CLI, prints only the output line on stdout for %s', (_label, stdin, line) => {
    const r = cli(stdin);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`${line}\n`);
  });

  it('as a CLI, names the files that forced a run on stderr', () => {
    expect(cli('docs/a.md\0apps/web/lib/x.ts\0').stderr).toContain('apps/web/lib/x.ts');
  });
});

// The changes job's decide step, run in bash with a stub git on PATH that records its arguments.
describe("the changes job's decide step", () => {
  const decide = (job('changes').steps ?? []).find((s) => (s as { id?: string }).id === 'decide');

  it('reads the event, the dispatch input and the branch through env', () => {
    expect(decide?.env).toEqual({
      REF: '${{ github.ref }}',
      EVENT: '${{ github.event_name }}',
      DISPATCH_VISUAL: '${{ inputs.visual }}',
      BRANCH: '${{ github.ref_name }}',
      OWNER: '${{ github.repository_owner }}',
      REPO: '${{ github.repository }}',
      GH_TOKEN: '${{ github.token }}',
    });
  });

  function run(opts: {
    ref: string;
    mergeBaseFails?: boolean;
    diff?: string[];
    event?: string;
    dispatchVisual?: string;
    /** What the stub `gh` prints for the open pull requests, or 'fail' to exit 1. */
    openPrs?: string;
  }) {
    const dir = mkdtempSync(join(tmpdir(), 'ci-changes-'));
    const bin = join(dir, 'bin');
    spawnSync('mkdir', ['-p', bin]);
    const ghLog = join(dir, 'gh.log');
    writeFileSync(
      join(bin, 'gh'),
      [
        '#!/usr/bin/env bash',
        `{ printf '%s\\037' "$@"; printf '\\n'; } >> '${ghLog}'`,
        opts.openPrs === 'fail' ? 'exit 1' : `printf '%s\\n' '${opts.openPrs ?? '0'}'`,
        '',
      ].join('\n'),
    );
    chmodSync(join(bin, 'gh'), 0o755);
    const log = join(dir, 'git.log');
    writeFileSync(join(dir, 'diff'), (opts.diff ?? []).map((f) => `${f}\0`).join(''));
    writeFileSync(
      join(bin, 'git'),
      [
        '#!/usr/bin/env bash',
        // One line per call, its arguments separated by the unit separator, so argv is exact.
        `{ printf '%s\\037' "$@"; printf '\\n'; } >> '${log}'`,
        'args=("$@")',
        'while [ "${args[0]}" = -c ]; do args=("${args[@]:2}"); done',
        'case "${args[0]}" in',
        `  merge-base) ${opts.mergeBaseFails ? 'exit 128' : 'echo 0123456789abcdef'} ;;`,
        `  diff) cat '${join(dir, 'diff')}' ;;`,
        '  *) exit 2 ;;',
        'esac',
        '',
      ].join('\n'),
    );
    chmodSync(join(bin, 'git'), 0o755);
    const output = join(dir, 'output');
    writeFileSync(output, '');
    const r = spawnSync('bash', ['-e', '-c', decide?.run ?? 'exit 99'], {
      cwd: REPO,
      env: {
        NODE_ENV: 'test',
        PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
        REF: opts.ref,
        EVENT: opts.event ?? 'push',
        DISPATCH_VISUAL: opts.dispatchVisual ?? '',
        BRANCH: opts.ref.replace(/^refs\/heads\//, ''),
        OWNER: 'owner',
        REPO: 'owner/repo',
        GITHUB_OUTPUT: output,
        RUNNER_TEMP: dir,
      },
      encoding: 'utf8',
    });
    const read = (file: string) =>
      existsSync(file)
        ? readFileSync(file, 'utf8')
            .split('\n')
            .filter((line) => line !== '')
            .map((line) => line.split('\x1f').slice(0, -1))
        : [];
    return { r, output: readFileSync(output, 'utf8'), calls: read(log), gh: read(ghLog) };
  }

  const OPEN_PR = { openPrs: '1' };

  it('on main, opens the gate with visual=true without asking git or GitHub anything', () => {
    for (const event of ['push', 'workflow_dispatch', 'schedule']) {
      const { r, output, calls, gh } = run({ ref: 'refs/heads/main', event });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(output).toBe('gate=open\nvisual=true\n');
      expect(calls).toEqual([]);
      expect(gh).toEqual([]);
    }
  });

  it('asks GitHub for open pull requests whose head is this branch', () => {
    const { gh } = run({ ref: 'refs/heads/build/x', diff: ['docs/a.md'], ...OPEN_PR });
    expect(gh).toEqual([
      [
        'api',
        '-X',
        'GET',
        'repos/owner/repo/pulls',
        '-f',
        'state=open',
        '-f',
        'head=owner:build/x',
        '--jq',
        'length',
      ],
    ]);
  });

  it('on a push with no open pull request, defers: visual=false, and diffs nothing', () => {
    const { r, output, calls } = run({ ref: 'refs/heads/x', diff: ['apps/web/lib/x.ts'] });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(output).toBe('gate=deferred\nvisual=false\n');
    expect(calls).toEqual([]);
  });

  it('on a dispatch with visual false and no open pull request, defers as a push does', () => {
    const { output } = run({
      ref: 'refs/heads/x',
      event: 'workflow_dispatch',
      dispatchVisual: 'false',
      diff: ['apps/web/lib/x.ts'],
    });
    expect(output).toBe('gate=deferred\nvisual=false\n');
  });

  it('on a pull request event, opens the gate without asking GitHub; the path filter decides', () => {
    const rendering = run({
      ref: 'refs/pull/7/merge',
      event: 'pull_request',
      diff: ['apps/web/lib/x.ts'],
    });
    expect(rendering.output).toBe('gate=open\nvisual=true\n');
    expect(rendering.gh).toEqual([]);
    const docs = run({ ref: 'refs/pull/7/merge', event: 'pull_request', diff: ['docs/a.md'] });
    expect(docs.output).toBe('gate=open\nvisual=false\n');
  });

  it('on a dispatch with visual true, opens the gate without asking GitHub', () => {
    const { output, gh } = run({
      ref: 'refs/heads/x',
      event: 'workflow_dispatch',
      dispatchVisual: 'true',
      diff: ['apps/web/lib/x.ts'],
    });
    expect(output).toBe('gate=open\nvisual=true\n');
    expect(gh).toEqual([]);
  });

  it('opens the gate with a warning when GitHub cannot be asked, or answers nonsense', () => {
    for (const openPrs of ['fail', '', 'null', '1 2']) {
      const { r, output } = run({ ref: 'refs/heads/x', diff: ['apps/web/lib/x.ts'], openPrs });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(output, openPrs).toBe('gate=open\nvisual=true\n');
      expect(r.stdout, openPrs).toMatch(/^::warning::/m);
    }
  });

  it('when merge-base fails, outputs visual=true with a warning and diffs nothing', () => {
    const { r, output, calls } = run({ ref: 'refs/heads/x', mergeBaseFails: true, ...OPEN_PR });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(output).toBe('gate=open\nvisual=true\n');
    expect(r.stdout).toMatch(/^::warning::/m);
    expect(calls).toEqual([['merge-base', 'origin/main', 'HEAD']]);
  });

  it('with an open pull request on a docs-only branch, outputs visual=false', () => {
    const { r, output } = run({
      ref: 'refs/heads/x',
      diff: ['docs/a.md', 'README.md'],
      ...OPEN_PR,
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(output).toBe('gate=open\nvisual=false\n');
  });

  it('with an open pull request on a branch that changes rendering, outputs visual=true', () => {
    const { r, output } = run({
      ref: 'refs/heads/x',
      diff: ['docs/a.md', 'apps/web/lib/x.ts'],
      ...OPEN_PR,
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(output).toBe('gate=open\nvisual=true\n');
  });

  it('diffs the whole branch against the merge-base, NUL-separated, with renames split', () => {
    const { calls } = run({ ref: 'refs/heads/x', diff: ['docs/a.md'], ...OPEN_PR });
    expect(calls).toEqual([
      ['merge-base', 'origin/main', 'HEAD'],
      [
        '-c',
        'core.quotePath=false',
        'diff',
        '--name-only',
        '--no-renames',
        '-z',
        '0123456789abcdef',
        'HEAD',
      ],
    ]);
  });
});

// Every file reached through static imports, dynamic imports, require(), new URL(file, import.meta.url)
// and CSS @import, from: every non-test file under apps/web/app (the previews, the root layout, and
// the routes next start serves to security-browser and zap-baseline), the middleware and configs, the
// visual and security-browser specs, and the locked design screens. None may be on the skip list, or a
// change to it would skip the jobs that would have caught it. Not seen: a file read at run time other
// than through new URL('<literal>', import.meta.url); a whole `import type` (erased, so it cannot
// change what runs); and files Tailwind scans for class names by its `content` globs rather than by
// import (apps/web/app and apps/web/components, which changes.mjs keeps whole instead).
describe('the import closure of what the gated jobs render and serve', () => {
  const WEB = join(REPO, 'apps/web');
  const CODE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|css)$/;
  const EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css'];

  function walkDir(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walkDir(full));
      else out.push(full);
    }
    return out;
  }

  // Workspace packages by name, with their exports (or main) for `@crawlmouse/<pkg>[/sub]`.
  const packages = new Map<string, { dir: string; exports: Record<string, unknown> }>();
  for (const dir of [
    'apps/web',
    'inngest',
    'scripts',
    ...readdirSync(join(REPO, 'packages')).map((p) => `packages/${p}`),
  ]) {
    const manifest = join(REPO, dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
      name: string;
      exports?: unknown;
      main?: string;
    };
    const exports =
      typeof pkg.exports === 'string'
        ? { '.': pkg.exports }
        : ((pkg.exports as Record<string, unknown> | undefined) ??
          (pkg.main ? { '.': pkg.main } : {}));
    packages.set(pkg.name, { dir: join(REPO, dir), exports });
  }

  /** A bare specifier is external only when node resolves it: a builtin, or under node_modules. */
  function isInstalled(from: string, name: string): boolean {
    if (builtinModules.includes(name)) return true;
    // Next resolves these two to its own compiled copies, not to node_modules/<name>.
    const nextCompiled = join(WEB, 'node_modules/next/dist/compiled', name);
    if ((name === 'server-only' || name === 'client-only') && existsSync(nextCompiled)) return true;
    for (let dir = dirname(from); ; dir = dirname(dir)) {
      if (existsSync(join(dir, 'node_modules', name))) return true;
      if (dir === dirname(dir)) return false;
    }
  }

  function isDirectory(path: string): boolean {
    return existsSync(path) && statSync(path).isDirectory();
  }

  function exportTarget(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      const v = value as Record<string, unknown>;
      return exportTarget(v.import ?? v.default ?? v.types);
    }
    return undefined;
  }

  function resolveFile(base: string): string | undefined {
    const candidates = [base, base.replace(/\.(?:js|mjs|cjs)$/, '')];
    for (const c of candidates) {
      for (const ext of EXTENSIONS) {
        const f = c + ext;
        if (existsSync(f) && statSync(f).isFile()) return f;
      }
      for (const index of ['index.ts', 'index.tsx', 'index.js', 'index.mjs']) {
        const f = join(c, index);
        if (existsSync(f)) return f;
      }
    }
    return undefined;
  }

  /** Files for a specifier, [] for an installed package, undefined when unresolved. */
  function resolveSpecifier(from: string, spec: string): string[] | undefined {
    let target: string | undefined;
    if (spec.startsWith('.')) target = resolve(dirname(from), spec);
    else if (spec.startsWith('@/')) target = join(WEB, spec.slice(2));
    else {
      const parts = spec.split('/');
      const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
      const pkg = packages.get(name);
      if (!pkg) return isInstalled(from, name) ? [] : undefined;
      const sub = spec.slice(name.length);
      const exported = exportTarget(pkg.exports[sub === '' ? '.' : `.${sub}`]);
      if (!exported) return undefined;
      target = join(pkg.dir, exported);
    }
    const file = resolveFile(target);
    return file ? [file] : undefined;
  }

  const NEW_URL = /\bnew URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;
  const PATTERNS = [
    // import x from '...', import { a, type B } from '...'; a whole `import type` is erased.
    /\bimport\s+(?!type\s)[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+(?!type\s)(?:\*|\{)[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    NEW_URL,
    /@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g,
  ];

  // Test files under apps/web/app are not served, so they are not roots (a test file an import reaches
  // still counts).
  const roots = [
    ...walkDir(join(WEB, 'app')).filter((f) => !/\.test\.tsx?$/.test(f)),
    ...['middleware.ts', 'next.config.mjs', 'postcss.config.mjs', 'tailwind.config.ts'].map((f) =>
      join(WEB, f),
    ),
    ...['instrumentation.ts', 'instrumentation-client.ts', 'sentry.server.config.ts'].map((f) =>
      join(WEB, f),
    ),
    ...walkDir(join(REPO, 'tests/visual')),
    ...walkDir(join(WEB, '__tests__/security/browser')),
    ...walkDir(join(REPO, 'docs/design/v2/screens')),
  ];

  const reached = new Set<string>();
  const unresolved: string[] = [];
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (reached.has(file)) continue;
    reached.add(file);
    // An installed package reached by a relative path is a leaf: not walked, not counted.
    if (!CODE.test(file) || file.split(sep).includes('node_modules')) continue;
    const text = readFileSync(file, 'utf8');
    for (const pattern of PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const spec = match[1]!;
        if (/^(?:https?:|data:|node:|#)/.test(spec)) continue;
        // A directory named through new URL(…, import.meta.url) is a working directory or a folder
        // read at run time, not an import; the one such folder the specs read is a root above.
        if (pattern === NEW_URL && isDirectory(resolve(dirname(file), spec))) continue;
        const files = resolveSpecifier(file, spec);
        if (files === undefined) unresolved.push(`${relative(REPO, file)} -> ${spec}`);
        else for (const f of files) if (!reached.has(f)) queue.push(f);
      }
    }
  }
  const inRepo = [...reached]
    .filter((f) => !f.split(sep).includes('node_modules'))
    .map((f) => relative(REPO, f).split(sep).join('/'));

  it('resolves every relative, aliased and workspace import it finds', () => {
    expect(unresolved).toEqual([]);
  });

  it('is not trivial: it reaches the engine, the types package and past apps/web/app', () => {
    expect(inRepo.length).toBeGreaterThan(1000);
    expect(inRepo.some((f) => f.startsWith('packages/engine/src/'))).toBe(true);
    expect(inRepo.some((f) => f.startsWith('packages/types/src/'))).toBe(true);
    expect(inRepo.some((f) => f.startsWith('apps/web/lib/'))).toBe(true);
    expect(inRepo.some((f) => f.startsWith('apps/web/components/'))).toBe(true);
  });

  it('contains no file on the skip list', () => {
    expect(inRepo.filter((f) => skippable(f))).toEqual([]);
  });
});

// migrations-append-only on main compares with the push's `before`; a dispatched or scheduled run on
// main has none, so it compares with the first parent.
describe('migrations-append-only, the commit it compares with', () => {
  const [, check] = job('migrations-append-only').steps ?? [];

  it('reads the event through env', () => {
    expect(check?.env).toEqual({
      PUSH_BEFORE: '${{ github.event.before }}',
      REF: '${{ github.ref }}',
      EVENT: '${{ github.event_name }}',
    });
  });

  function base(env: { REF: string; EVENT: string; PUSH_BEFORE: string }) {
    const dir = mkdtempSync(join(tmpdir(), 'ci-mig-'));
    const log = join(dir, 'git.log');
    writeFileSync(
      join(dir, 'git'),
      [
        '#!/usr/bin/env bash',
        `{ printf '%s\\037' "$@"; printf '\\n'; } >> '${log}'`,
        'case "$1" in',
        '  merge-base) echo mergebase ;;',
        '  rev-parse) echo parent ;;',
        '  cat-file) exit 0 ;;',
        '  diff) exit 0 ;;',
        'esac',
        '',
      ].join('\n'),
    );
    chmodSync(join(dir, 'git'), 0o755);
    const r = spawnSync('bash', ['-e', '-c', check?.run ?? 'exit 99'], {
      env: { NODE_ENV: 'test', PATH: `${dir}:/usr/bin:/bin`, ...env },
      encoding: 'utf8',
    });
    const diff = readFileSync(log, 'utf8')
      .split('\n')
      .map((l) => l.split('\x1f'))
      .find((a) => a[0] === 'diff');
    return { r, against: diff?.[3] };
  }

  it.each([
    [{ REF: 'refs/heads/main', EVENT: 'push', PUSH_BEFORE: 'before' }, 'before'],
    [{ REF: 'refs/heads/main', EVENT: 'schedule', PUSH_BEFORE: '' }, 'parent'],
    [{ REF: 'refs/heads/main', EVENT: 'workflow_dispatch', PUSH_BEFORE: '' }, 'parent'],
    [{ REF: 'refs/heads/x', EVENT: 'push', PUSH_BEFORE: 'before' }, 'mergebase'],
    [{ REF: 'refs/heads/x', EVENT: 'workflow_dispatch', PUSH_BEFORE: '' }, 'mergebase'],
  ])('%j compares with %s', (env, want) => {
    const { r, against } = base(env);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(against).toBe(want);
  });
});

// The ruleset protect-main requires these checks by name. Each must be reported by exactly one job of
// ci.yml (a matrix job once per value), or a rename would leave a requirement no job can meet.
describe('the required checks', () => {
  const REQUIRED = [
    'build',
    'lint',
    'typecheck',
    'test (web)',
    'test (engine)',
    'test (inngest)',
    'test (timing)',
    'gitleaks',
    'osv-scanner',
    'visual',
    'migrations-append-only',
  ];

  /**
   * The check names a job reports: its name, or its id, once per matrix value it names. A name of
   * the form `${{ cond && 'a' || 'b' }}` (the `visual` job's) is read as 'b', the name it reports
   * when the condition is false: for `visual`, an open gate.
   */
  function checkNames(id: string, j: Job & { name?: string; strategy?: unknown }): string[] {
    const conditional = /^\$\{\{ .+ && '[^']+' \|\| '([^']+)' \}\}$/.exec(j.name ?? '');
    const name = conditional ? conditional[1]! : (j.name ?? id);
    const matrix = (j.strategy as { matrix?: Record<string, unknown[]> } | undefined)?.matrix;
    if (!matrix) return [name];
    return Object.entries(matrix).reduce<string[]>(
      (names, [key, values]) =>
        names.flatMap((n) => values.map((v) => n.replaceAll(`\${{ matrix.${key} }}`, String(v)))),
      [name],
    );
  }

  const names = Object.entries(ci.jobs).flatMap(([id, j]) => checkNames(id, j));

  it.each(REQUIRED)('%s is reported by exactly one job', (check) => {
    expect(names.filter((n) => n === check)).toHaveLength(1);
  });
});

// test (web) runs in three shards; one job named `test (web)` reports their verdict, so the
// required check keeps its name. On 2026-11-11 the single job took 13.5 min (run 43056751031) and
// was cancelled at its 15-minute limit (run 43073710281).
describe('test (web), sharded', () => {
  const shard = job('test-web-shard') as Job & {
    name?: string;
    strategy?: { 'fail-fast'?: boolean; matrix?: { shard?: number[] } };
    'timeout-minutes'?: number;
  };
  const aggregate = job('test-web') as Job & { name?: string; permissions?: unknown };

  it('leaves web out of the per-package matrix', () => {
    const matrix = (job('test') as { strategy?: { matrix?: { package?: string[] } } }).strategy
      ?.matrix?.package;
    expect(matrix).toEqual(['engine', 'inngest', 'types', 'scripts', 'worker', 'timing']);
  });

  it('runs vitest in three shards, each within 25 minutes, none cancelling the others', () => {
    expect(shard.name).toBe('test (web, shard ${{ matrix.shard }}/3)');
    expect(shard.strategy).toEqual({ 'fail-fast': false, matrix: { shard: [1, 2, 3] } });
    expect(shard['timeout-minutes']).toBe(25);
    const run = (shard.steps ?? []).map((s) => s.run).filter(Boolean);
    expect(run).toEqual([
      'pnpm --filter @crawlmouse/web exec vitest run --shard=${{ matrix.shard }}/3',
    ]);
  });

  it('reports the verdict as test (web), always, reading only the shards', () => {
    expect(aggregate.name).toBe('test (web)');
    expect(needs('test-web')).toEqual(['test-web-shard']);
    expect(aggregate.if).toBe('${{ always() }}');
    expect(aggregate.permissions).toEqual({});
    expect(aggregate.steps?.[0]?.env).toEqual({ SHARDS: '${{ needs.test-web-shard.result }}' });
  });

  it.each([
    ['success', 0],
    ['failure', 1],
    ['cancelled', 1],
    ['skipped', 1],
    ['', 1],
  ])('passes only when every shard passed: shards=%j', (SHARDS, want) => {
    const r = spawnSync('bash', ['-c', aggregate.steps?.[0]?.run ?? 'exit 99'], {
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '/usr/bin:/bin', SHARDS },
      encoding: 'utf8',
    });
    expect(r.status, r.stdout + r.stderr).toBe(want);
    if (want !== 0) expect(r.stdout).toMatch(/^::error::/m);
  });
});
