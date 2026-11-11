import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * A member's mark done (`mark_fix_done`) and a check's persist (`persist_built_check`) racing on one
 * fix (migration 20261112000001 section B, CC-26b D5), on a real Postgres: CI's `db-cli-files` job
 * runs this with TRIAL_RACE_DB_URL set (and TRIAL_RACE_REQUIRED=1, so a missing URL fails the job
 * rather than skipping), as it runs trial-race.test.ts. Elsewhere it is skipped: PGlite has one
 * backend and cannot hold two transactions open at once.
 *
 * The site is the engine's recorded site, kept by an account. Its first check is persisted; its
 * second is built from the fixes as the first left them, so the build reads the orphan fix `open`
 * and verifies it. Each race holds transaction A open after its call, starts B's call, waits until
 * B is seen waiting on a lock, commits A, and lets B finish:
 *   - mark first: A marks the orphan fix, B persists the second check. B must withhold the fix,
 *     whose last event is now a mark its build never read.
 *   - persist first: A persists, B marks. B must find the fix verified and refuse it.
 * Each also runs against a database built from the migration with the lock that orders it removed
 * (persist's `for update` of the read fixes; mark_fix_done's `for update of f`), where the outcome
 * the lock prevents must happen: those are the mutation checks, run whenever the file runs.
 */

const URL_ENV = process.env.TRIAL_RACE_DB_URL;
if (!URL_ENV && process.env.TRIAL_RACE_REQUIRED === '1') {
  throw new Error('TRIAL_RACE_REQUIRED=1 but TRIAL_RACE_DB_URL is not set');
}
// It creates databases and cluster-wide roles, so it runs only against a Postgres on this machine.
if (URL_ENV && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(URL_ENV).hostname)) {
  throw new Error('TRIAL_RACE_DB_URL must name a local Postgres (localhost, 127.0.0.1 or [::1])');
}

const MIGRATION = '20261112000001_v2_026b_sites_fixes.sql';
const PERSIST_LOCK = '    order by f.id\n    for update;\n';
const MARK_LOCK = '     for update of f;\n';
/** How long to watch for B waiting. */
const WAIT_WATCH_MS = 2000;
/** Each race's own bound: a persist of the recorded check runs for seconds on a loaded machine. */
const RACE_TIMEOUT_MS = 60_000;

type Sql = postgres.Sql;

function urlFor(base: string, database: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

/** A fresh database with the Supabase stand-ins and every migration, the 026b text edited by `edit`. */
async function migrated(admin: Sql, name: string, edit: (sql: string) => string = (s) => s) {
  const { PLATFORM_SHIM, migrationFiles, readMigration } =
    await import('../../apps/web/__tests__/helpers/pglite-migrations');
  await admin.unsafe(`create database ${name}`);
  const sql = postgres(urlFor(URL_ENV!, name), { max: 4, onnotice: () => {} });
  // Roles are cluster-wide: the second database finds the first one's.
  const shim = PLATFORM_SHIM.replace(
    /create role (\w+)([^;]*);/g,
    (_m, role: string, opts: string) =>
      `do $r$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role}${opts}; end if; end $r$;`,
  );
  await sql.unsafe(shim).simple();
  for (const f of migrationFiles()) {
    const text = readMigration(f);
    await sql.unsafe(f === MIGRATION ? edit(text) : text).simple();
  }
  return sql;
}

const removing = (lock: string) => (text: string) => {
  if (!text.includes(lock)) throw new Error(`the lock to remove is not in ${MIGRATION}`);
  return text.replace(lock, ';\n');
};

interface Calls {
  checkId: string;
  stages: { collection: string; chunk: number; rows: unknown[] }[];
  payload: Record<string, unknown>;
}

type Seeded = Awaited<ReturnType<typeof seeded>>;

/** The recorded site kept by a new account, its first check persisted, its second running. */
async function seeded(sql: Sql) {
  const { buildCheck } = await import('@crawlmouse/engine/v2/pipeline');
  const { recordedBuild } = await import('../../packages/engine/fixtures/v2/build/recorded');
  const { pageVantage, persistCalls, readOfFixes } =
    await import('../../apps/web/lib/v2/pipeline/persist');
  const { secondCrawl, secondInput } =
    await import('../../apps/web/lib/v2/pipeline/test-support/second-check');

  const [u] =
    await sql`insert into auth.users (id, email) values (gen_random_uuid(), ${`race-${Date.now()}@example.com`}) returning id`;
  const [acct] = await sql`
    select s.account_id, s.id as seat_id from public.users us
      join public.seats s on s.account_id = us.default_account_id and s.user_id = us.id
     where us.id = ${u!.id}`;
  const accountId = acct!.account_id as string;
  const seatId = acct!.seat_id as string;

  const recorded = recordedBuild();
  const site = { ...recorded.site, account_id: accountId };
  const vantageOf = (batches: readonly unknown[]) =>
    pageVantage(
      (batches as { kind: string; pages: never[] }[]).flatMap((b) =>
        b.kind === 'crawl' ? b.pages : [],
      ),
    );
  const first = buildCheck({ ...recorded, site });
  await sql`insert into public.sites (id, account_id, host, created_at)
            values (${site.id}, ${accountId}, ${site.host}, ${site.created_at})`;
  await running(sql, recorded.check);
  await persist(
    sql,
    persistCalls({ built: first, vantage: vantageOf(recorded.batches), map_path: null, read: [] }),
  );

  const at = (ms: number) => new Date(Date.now() + ms).toISOString();
  const input = secondInput(first, {
    queued_at: at(60_000),
    started_at: at(62_000),
    finished_at: at(600_000),
    expires_at: at(30 * 86_400_000),
  });
  const second = buildCheck({ ...input, site });
  await running(sql, input.check);
  const orphan = first.fixes.find((f) => f.type === 'orphan_pages')!.id;
  expect(second.fixes.find((f) => f.id === orphan)?.status, 'anti-vacuity').toBe(
    'verified_resolved',
  );
  const calls: Calls = persistCalls({
    built: second,
    vantage: vantageOf(secondCrawl()),
    map_path: null,
    read: readOfFixes(first.fixes, first.fix_events),
  });
  return { orphan, seatId, calls };
}

async function running(
  sql: Sql,
  c: {
    id: string;
    site_id: string;
    trigger: string;
    grade_version: string;
    queued_at: string;
    started_at: string;
    expires_at: string | null;
  },
) {
  await sql`insert into public.checks (id, site_id, status, trigger, grade_version, queued_at, started_at,
                                      expires_at, progress, inngest_run_id, heartbeat_at)
            values (${c.id}, ${c.site_id}, 'running', ${c.trigger}, ${c.grade_version}, ${c.queued_at},
                    ${c.started_at}, ${c.expires_at},
                    ${sql.json({ steps: [], pages_crawled: 0, pages_estimated: null, links_found: 0, elapsed_ms: 0, recent_fetches: [] } as never)},
                    'race', now())`;
}

/** The stages, each committed; then the persist call on `t` (left open when `t` is in a transaction). */
async function stage(sql: Sql | postgres.ReservedSql, calls: Calls) {
  for (const s of calls.stages)
    await sql`select public.stage_check_rows(${calls.checkId}::uuid, ${s.collection}, ${s.chunk},
                                             ${sql.json(s.rows as never)})`;
}
const persistCall = (t: Sql | postgres.ReservedSql, calls: Calls) =>
  t`select public.persist_built_check(${t.json(calls.payload as never)}) as r`;
const markCall = (t: Sql | postgres.ReservedSql, fix: string, seat: string) =>
  t`select public.mark_fix_done(${fix}::uuid, ${seat}::uuid) as r`;

async function persist(sql: Sql, calls: Calls) {
  await stage(sql, calls);
  await persistCall(sql, calls);
}

/** A's call commits only after B's call has been seen waiting on a lock (or the watch ran out). */
async function race(
  sql: Sql,
  a: (t: postgres.ReservedSql) => Promise<postgres.RowList<postgres.Row[]>>,
  b: (t: postgres.ReservedSql) => Promise<postgres.RowList<postgres.Row[]>>,
) {
  const ta = await sql.reserve();
  const tb = await sql.reserve();
  try {
    const [{ pid }] = (await tb`select pg_backend_pid() as pid`) as unknown as [{ pid: number }];
    await ta`begin`;
    await ta`set local role service_role`;
    const [ra] = await a(ta);
    await tb`begin`;
    await tb`set local role service_role`;
    const pending = b(tb).then(
      (rows) => ({ ok: rows[0]!.r as Record<string, unknown> }),
      (error: unknown) => ({ error }),
    );
    let waited = false;
    for (const until = Date.now() + WAIT_WATCH_MS; Date.now() < until && !waited; ) {
      const [w] =
        await sql`select exists (select 1 from pg_locks where pid = ${pid} and not granted) as w`;
      waited = w!.w as boolean;
      if (!waited) await new Promise((r) => setTimeout(r, 25));
    }
    await ta`commit`;
    const settled = await pending;
    if ('error' in settled) throw settled.error;
    await tb`commit`;
    return { a: ra!.r as Record<string, unknown>, b: settled.ok, waited };
  } finally {
    for (const t of [ta, tb]) {
      await t`rollback`.catch(() => {});
      t.release();
    }
  }
}

async function fixOf(sql: Sql, fix: string) {
  const [row] = await sql`select status from public.site_fixes where id = ${fix}`;
  const events =
    await sql`select kind from public.fix_events where fix_id = ${fix} order by at, id`;
  return { status: row!.status as string, events: events.map((e) => e.kind as string) };
}

describe.skipIf(!URL_ENV)(
  'mark_fix_done and persist_built_check under two real transactions',
  () => {
    const suffix = `${process.pid}_${Date.now()}`;
    // One database per race: each seeds the recorded site, whose ids are fixed.
    const names = {
      markFirst: `fixes_race_mark_first_${suffix}`,
      persistFirst: `fixes_race_persist_first_${suffix}`,
      persistUnlocked: `fixes_race_persist_unlocked_${suffix}`,
      markUnlocked: `fixes_race_mark_unlocked_${suffix}`,
    };
    let admin: Sql;
    let markFirstDb: Sql;
    let persistFirstDb: Sql;
    let persistUnlocked: Sql;
    let markUnlocked: Sql;
    /** Each database's site, seeded and its second check staged, ahead of the race it runs. */
    const ready = new Map<Sql, Seeded>();

    beforeAll(async () => {
      admin = postgres(URL_ENV!, { max: 1, onnotice: () => {} });
      markFirstDb = await migrated(admin, names.markFirst);
      persistFirstDb = await migrated(admin, names.persistFirst);
      persistUnlocked = await migrated(admin, names.persistUnlocked, removing(PERSIST_LOCK));
      markUnlocked = await migrated(admin, names.markUnlocked, removing(MARK_LOCK));
      // Seeding imports and runs the engine, which takes seconds on a loaded machine, so it is done
      // here and not inside each race.
      for (const sql of [markFirstDb, persistFirstDb, persistUnlocked, markUnlocked]) {
        const s = await seeded(sql);
        await stage(sql, s.calls);
        ready.set(sql, s);
      }
    }, 600_000);

    afterAll(async () => {
      for (const s of [markFirstDb, persistFirstDb, persistUnlocked, markUnlocked])
        await s?.end({ timeout: 5 });
      for (const n of Object.values(names))
        await admin?.unsafe(`drop database if exists ${n} with (force)`);
      await admin?.end({ timeout: 5 });
    });

    /** A marks the orphan fix, B persists the second check over it. */
    async function markFirst(sql: Sql) {
      const s = ready.get(sql)!;
      const r = await race(
        sql,
        (t) => markCall(t, s.orphan, s.seatId),
        (t) => persistCall(t, s.calls),
      );
      return { ...r, orphan: s.orphan, fix: await fixOf(sql, s.orphan) };
    }

    /** A persists the second check, B marks the orphan fix. */
    async function persistFirst(sql: Sql) {
      const s = ready.get(sql)!;
      const r = await race(
        sql,
        (t) => persistCall(t, s.calls),
        (t) => markCall(t, s.orphan, s.seatId),
      );
      return { ...r, fix: await fixOf(sql, s.orphan) };
    }

    it(
      'mark first: the persist waits for it, then withholds the fix; the mark stands',
      async () => {
        const r = await markFirst(markFirstDb);
        expect(r.waited, 'B waited on a lock while A held it').toBe(true);
        expect(r.a).toMatchObject({ outcome: 'marked' });
        expect(r.b).toMatchObject({ written: true, counts: { fixes_withheld: 1 } });
        const verified = (r.b.verified as { fix_id: string }[]).map((v) => v.fix_id);
        expect(verified).not.toContain(r.orphan);
        expect(r.fix).toEqual({ status: 'marked_done', events: ['marked_done'] });
      },
      RACE_TIMEOUT_MS,
    );

    it(
      'persist first: the mark waits for it, then finds the fix verified and refuses',
      async () => {
        const r = await persistFirst(persistFirstDb);
        expect(r.waited, 'B waited on a lock while A held it').toBe(true);
        expect(r.a).toMatchObject({ written: true, counts: { fixes_withheld: 0 } });
        expect(r.b).toEqual({ outcome: 'refused', status: 'verified_resolved' });
        expect(r.fix).toEqual({ status: 'verified_resolved', events: ['verified'] });
      },
      RACE_TIMEOUT_MS,
    );

    it(
      'mutation: without persist’s lock, the check verifies over a mark its build never read',
      async () => {
        const r = await markFirst(persistUnlocked);
        expect(r.b).toMatchObject({ written: true, counts: { fixes_withheld: 0 } });
        expect(r.fix).toEqual({ status: 'verified_resolved', events: ['marked_done', 'verified'] });
      },
      RACE_TIMEOUT_MS,
    );

    it(
      'mutation: without mark_fix_done’s lock, the mark reads the fix before the persist and writes over it',
      async () => {
        // It reads `open`, its update waits for the persist, then writes marked_done over the verified
        // row, which the row's rank rule refuses: an error, where the lock gives a refusal.
        await expect(persistFirst(markUnlocked)).rejects.toThrow(/site_fixes_rank/);
      },
      RACE_TIMEOUT_MS,
    );
  },
);
