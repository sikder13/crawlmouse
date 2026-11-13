/**
 * The probes that compare with the code production runs (review r1 C-B1, N7): the worker release,
 * the migrations list and the agency-trial route are read at the live production deployment's commit,
 * which the Vercel project names, never at a local ref or the working tree.
 */
import { describe, expect, it } from 'vitest';
import { PRODUCTION_REF } from '../../db/target';
import { deps, fakeToken, json, scriptedFetch } from '../test-support';
import { LIVE_UNKNOWN_HINT, liveCommit } from './live';
import { migrationsProbe } from './migrations';
import { AGENCY_TRIAL_ROUTE, agencyTrialRemovedProbe } from './repo';
import type { GitResult, ProbeDeps } from './types';
import { VERCEL_PROJECT_ID } from './vercel-env';
import { releaseProbe } from './worker';

const LIVE = 'c'.repeat(40);
const TAG = 'a'.repeat(40);
const tokens = {
  VERCEL_TOKEN: fakeToken(['vcp', 'test']),
  FLY_READ_TOKEN: fakeToken(['fo1']),
  SUPABASE_ACCESS_TOKEN: fakeToken(['sbp', 'test']),
};

/** Vercel names `commit` as live; the machines run `TAG`; Supabase answers `rows`. */
function production(commit: unknown = LIVE, rows: unknown[] = []) {
  return scriptedFetch((url) => {
    if (url.pathname === `/v9/projects/${VERCEL_PROJECT_ID}`)
      return json({ targets: { production: { createdAt: 1, meta: { githubCommitSha: commit } } } });
    if (url.hostname === 'api.machines.dev')
      return json([{ state: 'started', image_ref: { tag: TAG } }]);
    if (url.pathname === `/v1/projects/${PRODUCTION_REF}/database/query/read-only`)
      return json(rows);
    return json({}, 404);
  });
}

type Git = (args: readonly string[]) => GitResult | undefined;
/** A git that records each command; `answer` decides, else every commit exists and the rest exits 128. */
function git(answer: Git = () => undefined) {
  const seen: string[][] = [];
  const run: ProbeDeps['git'] = async (args) => {
    seen.push([...args]);
    const a = answer(args);
    if (a) return a;
    if (args[0] === 'cat-file') return { code: 0, stdout: '' };
    return { code: 128, stdout: '' };
  };
  return { run, seen };
}
const ok = (stdout = ''): GitResult => ({ code: 0, stdout });

describe('the live production commit', () => {
  it('is read from the Vercel project and checked against the clone', async () => {
    const g = git();
    const r = await liveCommit(deps({ fetch: production().fetch, git: g.run, env: tokens }));
    expect(r).toEqual({ ok: true, sha: LIVE });
    expect(g.seen).toEqual([['cat-file', '-e', `${LIVE}^{commit}`]]);
  });

  const none: Git = () => undefined;
  const missing: Git = () => ({ code: 128, stdout: '' });
  it.each([
    ['no VERCEL_TOKEN', {}, LIVE, none],
    ['no commit named', tokens, null, none],
    ['a commit that is not a sha', tokens, '--output=x', none],
    ['a commit not in the clone', tokens, LIVE, missing],
  ])('is unknown with %s', async (_label, env, commit, answer) => {
    const g = git(answer);
    const r = await liveCommit(deps({ fetch: production(commit).fetch, git: g.run, env }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.result.status).toBe('unknown');
      expect(r.result.reason).toContain(LIVE_UNKNOWN_HINT);
    }
  });
});

describe('worker-release compares the image with the live commit', () => {
  const diffAnswer =
    (code: number): Git =>
    (args) =>
      args[0] === 'diff' ? { code, stdout: '' } : undefined;

  it('passes when no worker input changed between the image and the live commit', async () => {
    const g = git(diffAnswer(0));
    const r = await releaseProbe(() => ['packages/**'])(
      deps({ fetch: production().fetch, git: g.run, env: tokens }),
    );
    expect(r.status).toBe('pass');
    expect(g.seen).toContainEqual(['diff', '--quiet', TAG, LIVE, '--', 'packages/**']);
    expect(g.seen.flat()).not.toContain('origin/main');
  });

  it('fails when a worker input changed', async () => {
    const r = await releaseProbe(() => ['packages/**'])(
      deps({ fetch: production().fetch, git: git(diffAnswer(1)).run, env: tokens }),
    );
    expect(r.status).toBe('fail');
  });

  it('is unknown without VERCEL_TOKEN, and does not diff', async () => {
    const g = git(diffAnswer(0));
    const r = await releaseProbe(() => ['packages/**'])(
      deps({
        fetch: production().fetch,
        git: g.run,
        env: { FLY_READ_TOKEN: tokens.FLY_READ_TOKEN },
      }),
    );
    expect(r.status).toBe('unknown');
    expect(r.reason).toContain(LIVE_UNKNOWN_HINT);
    expect(g.seen.some((a) => a[0] === 'diff')).toBe(false);
  });

  it('is unknown when the live commit is not in the clone', async () => {
    const g = git((args) =>
      args[0] === 'cat-file' && args[2] === `${LIVE}^{commit}`
        ? { code: 128, stdout: '' }
        : undefined,
    );
    const r = await releaseProbe(() => ['packages/**'])(
      deps({ fetch: production().fetch, git: g.run, env: tokens }),
    );
    expect(r.status).toBe('unknown');
    expect(r.reason).toContain(LIVE_UNKNOWN_HINT);
  });

  it('is unknown when the running image commit is not in the clone', async () => {
    const g = git((args) =>
      args[0] === 'cat-file' && args[2] === `${TAG}^{commit}`
        ? { code: 128, stdout: '' }
        : undefined,
    );
    const r = await releaseProbe(() => ['packages/**'])(
      deps({ fetch: production().fetch, git: g.run, env: tokens }),
    );
    expect(r.status).toBe('unknown');
  });
});

describe('migrations-applied lists the files at the live commit', () => {
  const tree = (...names: string[]) =>
    ok(names.map((n) => `infra/supabase/migrations/${n}`).join('\n') + '\n');
  const lsTree =
    (result: GitResult): Git =>
    (args) =>
      args[0] === 'ls-tree' ? result : undefined;
  const recorded = (...versions: string[]) =>
    versions.map((v) => ({ version: v, name: 'x', statements: ['select 1'] }));

  it('passes when every file at the live commit is recorded, reading the tree at that commit', async () => {
    const g = git(lsTree(tree('20260101000001_one.sql', '20260101000002_two.sql')));
    const r = await migrationsProbe()(
      deps({
        fetch: production(LIVE, recorded('20260101000001', '20260101000002')).fetch,
        git: g.run,
        env: tokens,
      }),
    );
    expect(r.status).toBe('pass');
    expect(g.seen).toContainEqual([
      'ls-tree',
      '--name-only',
      LIVE,
      '--',
      'infra/supabase/migrations/',
    ]);
  });

  it('fails naming a file at the live commit that production has not applied', async () => {
    const g = git(lsTree(tree('20260101000001_one.sql', '20260101000002_two.sql')));
    const r = await migrationsProbe()(
      deps({ fetch: production(LIVE, recorded('20260101000001')).fetch, git: g.run, env: tokens }),
    );
    expect(r.status).toBe('fail');
    expect(r.reason).toMatch(/^not applied: 20260101000002 /);
  });

  it('is unknown without VERCEL_TOKEN, or when the tree cannot be read', async () => {
    const noVercel = await migrationsProbe()(
      deps({
        fetch: production(LIVE, recorded()).fetch,
        git: git(lsTree(tree('20260101000001_one.sql'))).run,
        env: { SUPABASE_ACCESS_TOKEN: tokens.SUPABASE_ACCESS_TOKEN },
      }),
    );
    expect(noVercel.status).toBe('unknown');
    expect(noVercel.reason).toContain(LIVE_UNKNOWN_HINT);
    for (const result of [{ code: 128, stdout: '' }, ok(''), tree('not-a-migration.sql')]) {
      const r = await migrationsProbe()(
        deps({
          fetch: production(LIVE, recorded()).fetch,
          git: git(lsTree(result)).run,
          env: tokens,
        }),
      );
      expect(r.status, JSON.stringify(result)).toBe('unknown');
    }
  });

  it('answers unknown without the Supabase token, and sends nothing', async () => {
    const { fetch, calls } = production();
    const r = await migrationsProbe()(deps({ fetch, git: git().run, env: {} }));
    expect(r).toEqual({
      status: 'unknown',
      reason: 'set SUPABASE_ACCESS_TOKEN in scripts/.env.local',
    });
    expect(calls).toEqual([]);
  });

  it('reports a failed query by status only', async () => {
    const { fetch } = scriptedFetch(() =>
      json([{ message: 'a body that must not be printed' }], 401),
    );
    const r = await migrationsProbe()(deps({ fetch, git: git().run, env: tokens }));
    expect(r).toEqual({
      status: 'unknown',
      reason: 'the read-only history query failed (HTTP 401)',
    });
  });
});

describe('agency-trial-route-removed reads the live commit', () => {
  const lsTree =
    (result: GitResult): Git =>
    (args) =>
      args[0] === 'ls-tree' ? result : undefined;
  const run = (g: ReturnType<typeof git>, env: Record<string, string> = tokens) =>
    agencyTrialRemovedProbe(deps({ fetch: production().fetch, git: g.run, env }));

  it('fails while the route is at the live commit and passes once ls-tree shows it absent', async () => {
    expect((await run(git(lsTree(ok(`${AGENCY_TRIAL_ROUTE}\n`))))).status).toBe('fail');
    const gone = git(lsTree(ok('')));
    expect((await run(gone)).status).toBe('pass');
    expect(gone.seen).toContainEqual(['ls-tree', '--name-only', LIVE, '--', AGENCY_TRIAL_ROUTE]);
  });

  it('is unknown on any git error, not pass', async () => {
    for (const code of [1, 128]) {
      expect((await run(git(lsTree({ code, stdout: '' })))).status, String(code)).toBe('unknown');
    }
  });

  it('is unknown without VERCEL_TOKEN', async () => {
    const r = await run(git(lsTree(ok(''))), {});
    expect(r.status).toBe('unknown');
    expect(r.reason).toContain(LIVE_UNKNOWN_HINT);
  });
});
