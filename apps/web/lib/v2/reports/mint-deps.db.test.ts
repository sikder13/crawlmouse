/**
 * `supabaseMintDeps(...).snapshotOf` over Postgres (PGlite, every migration applied), reading through
 * the real `supabaseCheckReader` (over the PostgREST stand-in) the checks the engine built and the
 * pipeline persisted. F-261: a site's second check, whose fixes were first seen at its first, made
 * the production mint throw `No check <first> in the fixture`, because the mint read the one check
 * alone; the audit page reads the site's earlier checks with it.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { BuildInput, BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import { instant } from '@crawlmouse/types/v2';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { accountOf, doorDb, signUp } from '../../../__tests__/v2/_lib/door-pglite';
import { loadCheck } from '../pipeline/load';
import { loadCheckFor } from '../pipeline/load-for';
import {
  FIRST,
  SECOND,
  keepSite,
  persistBuild,
  publicDeps,
  secondInput,
  type TestDeps,
} from '../pipeline/test-support/public-checks';
import { buildPublicSnapshot } from './build-snapshot';

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstileToken: vi.fn() }));
// The loader is the real one. Only the reader under it is the loader tests' own over PGlite, which
// returns rows as PostgREST does (a `date` as its day); the PostgREST stand-in writes it as an instant.
const pg = vi.hoisted(() => ({ db: null as unknown, clients: [] as unknown[] }));
vi.mock('../pipeline/load', async (original) => {
  const { pgliteCheckReader } = await import('../pipeline/test-support/pglite');
  return {
    ...(await original<typeof import('../pipeline/load')>()),
    supabaseCheckReader: (sb: unknown) => {
      pg.clients.push(sb);
      return pgliteCheckReader(pg.db as PGlite);
    },
  };
});

const { supabaseMintDeps } = await import('./mint-deps');

const NOW = Date.parse('2026-11-07T00:00:00Z');
const AT = '2026-11-07T00:00:00.000Z';
/** The shared prefix of the recorded access tests' ids, and the second check's in its place. */
const RECORDED_TEST_IDS = 'e0000000-0000-4000-8000-0000';
const SECOND_TEST_IDS = 'e0000000-0000-4000-8000-c200';

/**
 * The recorded site checked again, finished: the recorded build renamed to the second check, crawl,
 * access and render alike (its access tests given ids of their own), with the first check as its previous one and the first check's fixes and
 * events read in. Nothing on the site changed, so the first check's fixes stay open at the second.
 */
function finishedSecond(first: BuiltCheck): BuildInput {
  const renamed = JSON.parse(
    JSON.stringify(recordedBuild())
      .replaceAll(FIRST, SECOND)
      // Access tests are keyed by their own ids, which a second check may not reuse.
      .replaceAll(RECORDED_TEST_IDS, SECOND_TEST_IDS),
  ) as BuildInput;
  const later = secondInput(first);
  return {
    ...renamed,
    check: later.check,
    previous: later.previous,
    fixes: later.fixes,
    events: later.events,
    now: later.now,
  };
}

describe('snapshotOf: a site with two checks (F-261)', () => {
  let db: PGlite;
  let deps: TestDeps;
  let first: BuiltCheck;
  let second: BuiltCheck;
  let accountId: string;
  let owner: string;
  let admin: SupabaseClient;

  beforeAll(async () => {
    db = await doorDb();
    pg.db = db;
    deps = publicDeps(db, () => NOW);
    first = await persistBuild(db, deps.evidence, recordedBuild());
    second = await persistBuild(db, deps.evidence, finishedSecond(first), {
      siteSeeded: true,
      map: false,
    });
    owner = await signUp(db, 'owner@example.com');
    accountId = (await accountOf(db, owner)).id as string;
    await keepSite(db, first.check.site_id, accountId);
    admin = postgrestOver(db) as unknown as SupabaseClient;
  }, 180_000);

  const mintDeps = () => supabaseMintDeps(admin, admin, null);

  it('the fixture is the production shape: the second check finished, holding fixes first seen at the first', async () => {
    expect([first.check.status, second.check.status]).toEqual(['finished', 'finished']);
    const alone = await loadCheck(deps.read, SECOND);
    expect(alone.checks.map((c) => c.id)).toEqual([SECOND]);
    expect(alone.fixes.some((f) => f.first_seen_check_id === FIRST)).toBe(true);
  });

  it('mints the second check, with the snapshot of the dataset the audit page reads', async () => {
    const { snapshot, accountId: of } = await mintDeps().snapshotOf(SECOND, AT);
    expect(of).toBe(accountId);
    expect(pg.clients.at(-1)).toBe(admin);
    const read = await loadCheckFor(deps, SECOND, { userId: owner });
    if (read?.state !== 'ready') throw new Error(`expected ready, got ${read?.state}`);
    expect(read.dataset.checks.map((c) => c.id)).toEqual([FIRST, SECOND]);
    expect(snapshot).toEqual(buildPublicSnapshot(read.dataset, SECOND, AT));
  });

  it('counts the fixes the second check knew about, worked out from the stored rows alone', async () => {
    // Independently of the views: a fix first seen at or before the second check, whose latest
    // verified-or-reopened event at or before its finish is not `verified`.
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n
         from public.site_fixes f
         join public.checks seen on seen.id = f.first_seen_check_id
         join public.checks c on c.id = $1
        where f.site_id = c.site_id and seen.queued_at <= c.queued_at
          and coalesce((select e.kind from public.fix_events e
                         where e.fix_id = f.id and e.kind in ('verified', 'reopened')
                           and e.at <= c.finished_at
                         order by e.at desc limit 1), 'none') <> 'verified'`,
      [SECOND],
    );
    const { snapshot } = await mintDeps().snapshotOf(SECOND, AT);
    expect(rows[0]!.n).toBeGreaterThan(0);
    expect(snapshot.fixCount).toBe(rows[0]!.n);
    expect(instant(snapshot.checkedAt)).toBe(instant(second.check.finished_at!));
  });

  it('a site’s only check mints the snapshot it minted before: no sentence changes', async () => {
    // FIRST is the earliest of the site's checks, so its dataset holds no other.
    const { snapshot } = await mintDeps().snapshotOf(FIRST, AT);
    expect(snapshot).toEqual(buildPublicSnapshot(await loadCheck(deps.read, FIRST), FIRST, AT));
  });
});
