import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Two real transactions racing in migration 20261112000001's section A, on a real Postgres:
 * `request_capped_check` at one re-check below the cap, and `add_site` at one site below the limit.
 * Run like scripts/db/trial-race.test.ts: against TRIAL_RACE_DB_URL (a Postgres on this machine),
 * required when TRIAL_RACE_REQUIRED=1, skipped otherwise, because PGlite has one backend and cannot
 * hold two transactions open at once.
 *
 * Each race holds transaction A open after its call, starts B's call, waits until B is seen waiting
 * on a lock (or the watch runs out), commits A, and lets B finish. The same races also run against a
 * database built from the migration with the row lock taken out of the function, where both calls
 * must pass: those are the mutation checks, run whenever the file runs.
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
/** request_capped_check's lock on the site row. */
const SITE_LOCK = '   where s.id = v_site and s.account_id is not null\n     for update;\n';
/** add_site's lock on the account row. */
const ACCOUNT_LOCK =
  '  perform 1 from public.accounts a where a.id = v_account and a.deleted_at is null for update;\n';
/** take_rate_slot's comparison with the slot's limit. */
const SLOT_CHECK = "         <= (p_slot ->> 'limit')::integer;\n";
/**
 * Each race opens two connections and waits up to WAIT_WATCH_MS for a lock; a loaded CI runner can
 * take several times as long as a quiet machine, so each test and hook names its own bound.
 */
const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 60_000;
/** How long to watch for B waiting. */
const WAIT_WATCH_MS = 2000;

type Sql = postgres.Sql;

function urlFor(base: string, database: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

/** A fresh database with the Supabase stand-ins and every migration, this one's text edited by `edit`. */
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

/** The migration with `lock` taken out, refusing to build when the text is not there to edit. */
const without =
  (lock: string, replacement: string) =>
  (text: string): string => {
    if (!text.includes(lock)) throw new Error(`the lock to remove is not in ${MIGRATION}`);
    return text.replace(lock, replacement);
  };

/** A signed-up user's personal account and its owner seat. */
async function account(sql: Sql) {
  const [u] =
    await sql`insert into auth.users (id, email) values (gen_random_uuid(), ${`race-${randomUUID()}@example.com`}) returning id`;
  const [a] = await sql`
    select u.default_account_id as account_id, s.id as seat_id
      from public.users u join public.seats s on s.account_id = u.default_account_id and s.user_id = u.id
     where u.id = ${u!.id}`;
  return { accountId: a!.account_id as string, seatId: a!.seat_id as string };
}

async function site(sql: Sql, accountId: string): Promise<string> {
  const id = randomUUID();
  await sql`insert into public.sites (id, account_id, host) values (${id}, ${accountId}, ${`${id.slice(0, 8)}.example`})`;
  return id;
}

/** A check row as requestCheck passes it to insertQueued. */
function row(siteId: string, trigger: 'manual' | 'first_audit') {
  const at = new Date().toISOString();
  return {
    id: randomUUID(),
    site_id: siteId,
    trigger,
    grade_version: '2.0.0',
    queued_at: at,
    heartbeat_at: at,
    expires_at: null,
  };
}

type Call = (t: postgres.ReservedSql) => Promise<string>;

/** A's call commits only after B's call has been seen waiting on a lock (or the watch ran out). */
async function race(sql: Sql, a: Call, b: Call) {
  const ta = await sql.reserve();
  const tb = await sql.reserve();
  try {
    const [{ pid }] = (await tb`select pg_backend_pid() as pid`) as unknown as [{ pid: number }];
    await ta`begin`;
    await ta`set local role service_role`;
    const ra = await a(ta);
    await tb`begin`;
    await tb`set local role service_role`;
    // Settled at once, so B failing while A holds its lock is not an unhandled rejection.
    const pending = b(tb).then(
      (outcome) => ({ outcome }),
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
    return { a: ra, b: settled.outcome, waited };
  } finally {
    for (const t of [ta, tb]) {
      await t`rollback`.catch(() => {});
      t.release();
    }
  }
}

interface Slot {
  bucket: string;
  window_start: string;
  limit: number;
}

/** A slot of the daily ceiling in a bucket of its own; `limit` defaults to more than a race uses. */
const slot = (limit = 1000): Slot => ({
  bucket: `race:${randomUUID()}`,
  window_start: '2026-11-10T00:00:00.000Z',
  limit,
});

const recheck =
  (r: ReturnType<typeof row>, cap: number, global: Slot = slot()): Call =>
  async (t) => {
    const [x] = await t`select public.request_capped_check(${t.json(r as never)}, ${cap},
                                                           ${t.json(global as never)}) as r`;
    return (x!.r as { outcome: string }).outcome;
  };

const addSite =
  (accountId: string, seatId: string, limit: number, global: Slot = slot()): Call =>
  async (t) => {
    const s = {
      id: randomUUID(),
      account_id: accountId,
      host: `${randomUUID().slice(0, 8)}.example`,
      owner_seat_id: seatId,
      schedule_cadence: null,
      schedule_iso_weekday: null,
      schedule_hour_local: null,
    };
    const [x] = await t`select public.add_site(${t.json(s as never)},
                                               ${t.json(row(s.id, 'first_audit') as never)},
                                               ${limit}, ${t.json(global as never)}, null) as r`;
    return (x!.r as { outcome: string }).outcome;
  };

const count = async (q: Promise<postgres.RowList<postgres.Row[]>>) => Number((await q)[0]!.n);

describe.skipIf(!URL_ENV)('section A under two real transactions', () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const names = {
    real: `sites_race_${suffix}`,
    siteUnlocked: `sites_race_site_unlocked_${suffix}`,
    accountUnlocked: `sites_race_account_unlocked_${suffix}`,
    unceiled: `sites_race_unceiled_${suffix}`,
  };
  let admin: Sql;
  let real: Sql;
  let siteUnlocked: Sql;
  let accountUnlocked: Sql;
  let unceiled: Sql;

  beforeAll(async () => {
    admin = postgres(URL_ENV!, { max: 1, onnotice: () => {} });
    real = await migrated(admin, names.real);
    siteUnlocked = await migrated(
      admin,
      names.siteUnlocked,
      without(SITE_LOCK, '   where s.id = v_site and s.account_id is not null;\n'),
    );
    accountUnlocked = await migrated(
      admin,
      names.accountUnlocked,
      without(
        ACCOUNT_LOCK,
        '  perform 1 from public.accounts a where a.id = v_account and a.deleted_at is null;\n',
      ),
    );
    unceiled = await migrated(
      admin,
      names.unceiled,
      without(SLOT_CHECK, '         <= 2147483647;\n'),
    );
  }, 4 * HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await real?.end({ timeout: 5 });
    await siteUnlocked?.end({ timeout: 5 });
    await accountUnlocked?.end({ timeout: 5 });
    await unceiled?.end({ timeout: 5 });
    for (const n of Object.values(names))
      await admin?.unsafe(`drop database if exists ${n} with (force)`);
    await admin?.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  /** Two re-checks of one site at one below a cap of two. */
  async function recheckRace(sql: Sql) {
    const { accountId } = await account(sql);
    const s = await site(sql, accountId);
    await sql`insert into public.checks (id, site_id, status, trigger, grade_version, queued_at,
                                         started_at, finished_at, failure_reason)
              values (gen_random_uuid(), ${s}, 'failed', 'manual', '2.0.0', now() - interval '1 hour',
                      now() - interval '1 hour', now() - interval '1 hour', 'internal')`;
    const r = await race(sql, recheck(row(s, 'manual'), 2), recheck(row(s, 'manual'), 2));
    const queued = await count(
      sql`select count(*) as n from public.checks where site_id = ${s} and status = 'queued'`,
    );
    return { ...r, queued };
  }

  /** Two adds to one account at one below a limit of two. */
  async function addRace(sql: Sql) {
    const { accountId, seatId } = await account(sql);
    await site(sql, accountId);
    const r = await race(sql, addSite(accountId, seatId, 2), addSite(accountId, seatId, 2));
    const live = await count(
      sql`select count(*) as n from public.sites where account_id = ${accountId} and removed_at is null`,
    );
    return { ...r, live };
  }

  it(
    'two re-checks at the cap minus one: the second waits for the first, then is capped; one queued',
    async () => {
      const r = await recheckRace(real);
      expect(r.waited, 'B waited on the site lock while A held it').toBe(true);
      expect([r.a, r.b]).toEqual(['created', 'capped']);
      expect(r.queued).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'two adds at the limit minus one: the second waits for the first, then is full; two sites',
    async () => {
      const r = await addRace(real);
      expect(r.waited, 'B waited on the account lock while A held it').toBe(true);
      expect([r.a, r.b]).toEqual(['created', 'full']);
      expect(r.live).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'mutation check: without the site lock, both re-checks pass the cap',
    async () => {
      const r = await recheckRace(siteUnlocked);
      expect(r.waited).toBe(false);
      expect([r.a, r.b]).toEqual(['created', 'created']);
      expect(r.queued).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'mutation check: without the account lock, both adds pass the limit',
    async () => {
      const r = await addRace(accountUnlocked);
      expect(r.waited).toBe(false);
      expect([r.a, r.b]).toEqual(['created', 'created']);
      expect(r.live).toBe(3);
    },
    TEST_TIMEOUT_MS,
  );
  /** Two starts, each of its own account and site, with one slot of the daily ceiling left. */
  async function ceilingRace(sql: Sql, kind: 'recheck' | 'add') {
    const g = slot(4);
    await sql`insert into public.rate_limits (bucket_key, window_start, request_count)
              values (${g.bucket}, ${g.window_start}, 3)`;
    const accounts: string[] = [];
    const call = async () => {
      const { accountId, seatId } = await account(sql);
      accounts.push(accountId);
      if (kind === 'add') return addSite(accountId, seatId, 1, g);
      return recheck(row(await site(sql, accountId), 'manual'), 2, g);
    };
    const r = await race(sql, await call(), await call());
    const slotsUsed = await count(
      sql`select request_count as n from public.rate_limits where bucket_key = ${g.bucket}`,
    );
    // What the two calls wrote: re-checks queue a check of an existing site; adds write a site and
    // its first audit.
    const checks = await count(
      sql`select count(*) as n from public.checks c join public.sites s on s.id = c.site_id
           where s.account_id = any(${accounts}::uuid[]) and c.status = 'queued'`,
    );
    const sites = await count(
      sql`select count(*) as n from public.sites where account_id = any(${accounts}::uuid[])`,
    );
    return { ...r, slotsUsed, checks, sites };
  }

  it(
    'one slot of the daily ceiling left, two re-checks: the second waits, then is capacity; one used',
    async () => {
      const r = await ceilingRace(real, 'recheck');
      expect(r.waited, 'B waited on the bucket row while A held it').toBe(true);
      expect([r.a, r.b]).toEqual(['created', 'capacity']);
      expect(r.slotsUsed).toBe(4);
      expect(r.checks, 'one queued check').toBe(1);
      expect(r.sites, 'the two sites the test made, and no other').toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'one slot of the daily ceiling left, two adds: the second waits, then is capacity; one used',
    async () => {
      const r = await ceilingRace(real, 'add');
      expect(r.waited).toBe(true);
      expect([r.a, r.b]).toEqual(['created', 'capacity']);
      expect(r.slotsUsed).toBe(4);
      expect(r.sites, 'one site').toBe(1);
      expect(r.checks, 'its one first audit').toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'mutation check: without the ceiling comparison, both re-checks pass it',
    async () => {
      const r = await ceilingRace(unceiled, 'recheck');
      expect([r.a, r.b]).toEqual(['created', 'created']);
      expect(r.slotsUsed).toBe(5);
      expect(r.checks).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );
});
