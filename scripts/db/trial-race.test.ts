import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Two real transactions racing in `start_trial_with_ledger` (migration 006c), on a real Postgres:
 * CI's `db-cli-files` job runs this against its Postgres service with TRIAL_RACE_DB_URL set (and
 * TRIAL_RACE_REQUIRED=1, so a missing URL fails the job rather than skipping). Elsewhere it is
 * skipped: PGlite has one backend and cannot hold two transactions open at once.
 *
 * Each race holds transaction A open after its call, starts B's call, waits until B is seen waiting
 * on a lock, commits A, and then lets B finish. The same race also runs against a database built
 * from the migration with the advisory-lock call removed, where it must start two trials: that is
 * the mutation check, run every time, so this file cannot pass by testing nothing.
 */

const URL_ENV = process.env.TRIAL_RACE_DB_URL;
if (!URL_ENV && process.env.TRIAL_RACE_REQUIRED === '1') {
  throw new Error('TRIAL_RACE_REQUIRED=1 but TRIAL_RACE_DB_URL is not set');
}

const MIGRATION = '20261108000001_v2_006c_trial_function_and_checks.sql';
const LOCK_CALL = '  perform public.trial_ledger_lock(p_hashes);\n';
/** How long to watch for B waiting. Below the function's 3 s lock_timeout, so B never times out. */
const WAIT_WATCH_MS = 2000;

type Sql = postgres.Sql;
type Hash = { kind: 'email' | 'device' | 'ip24'; value_hash: string };
const hex = (n: number, tag: string) => createHash('sha256').update(`${tag}:${n}`).digest('hex');

function urlFor(base: string, database: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

/** A fresh database with the Supabase stand-ins and every migration, the 006c text edited by `edit`. */
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

/** A signed-up account and the p_transition first-login.ts would send for it. */
async function account(sql: Sql, email: string) {
  const { next } = await import('../../apps/web/lib/billing/state-machine');
  const { snapshotFromRow, toTransitionParams } =
    await import('../../apps/web/lib/billing/state-machine-apply');
  const [u] =
    await sql`insert into auth.users (id, email) values (gen_random_uuid(), ${email}) returning id`;
  const [a] = await sql`
    select a.id, a.state, a.tier, a.trial_variant, a.trial_ends_at, a.trial_used_at, a.past_due_tier,
           a.past_due_since, a.disputed_at, a.seat_limit, a.site_limit, a.competitor_limit,
           a.entitlement_version, a.current_subscription_id, a.entitlement_changed_at, a.state_history
      from public.accounts a join public.users us on us.default_account_id = a.id
     where us.id = ${u!.id}`;
  const stored = snapshotFromRow(a as never);
  const at = new Date();
  const t = next(stored.snapshot, { type: 'trial_started', at, variant: 'no_card' });
  return {
    id: a!.id as string,
    transition: {
      event: 'trial_started',
      ...toTransitionParams(a!.id as string, stored.version, t.state, at),
    },
  };
}

interface Call {
  accountId: string;
  hashes: Hash[];
  transition: unknown;
}

/** A's call commits only after B's call has been seen waiting on a lock (or the watch ran out). */
async function race(sql: Sql, a: Call, b: Call) {
  const ta = await sql.reserve();
  const tb = await sql.reserve();
  try {
    const call = (t: postgres.ReservedSql, c: Call) =>
      // sql.json sends the value as jsonb; a JSON.stringify'd string would be sent as a jsonb string.
      t`select public.start_trial_with_ledger(${c.accountId}::uuid, ${t.json(c.hashes as never)},
                                              ${t.json(c.transition as never)}) as r`;
    const [{ pid }] = (await tb`select pg_backend_pid() as pid`) as unknown as [{ pid: number }];
    await ta`begin`;
    await ta`set local role service_role`;
    const [ra] = await call(ta, a);
    await tb`begin`;
    await tb`set local role service_role`;
    const pending = call(tb, b).then((rows) => rows[0]!.r as { outcome: string });
    let waited = false;
    for (const until = Date.now() + WAIT_WATCH_MS; Date.now() < until && !waited; ) {
      const [w] =
        await sql`select exists (select 1 from pg_locks where pid = ${pid} and not granted) as w`;
      waited = w!.w as boolean;
      if (!waited) await new Promise((r) => setTimeout(r, 25));
    }
    await ta`commit`;
    const rb = await pending;
    await tb`commit`;
    return { a: (ra!.r as { outcome: string }).outcome, b: rb.outcome, waited };
  } finally {
    // A failed race leaves a transaction open; end it before the connection goes back to the pool.
    for (const t of [ta, tb]) {
      await t`rollback`.catch(() => {});
      t.release();
    }
  }
}

const trials = async (sql: Sql, ids: string[]) =>
  Number(
    (
      await sql`select count(*) as n from public.accounts where id = any(${ids}::uuid[]) and state = 'pro_trial'`
    )[0]!.n,
  );
const rowsOf = async (sql: Sql, id: string) =>
  Number((await sql`select count(*) as n from public.trial_ledger where account_id = ${id}`)[0]!.n);
const deviceRows = async (sql: Sql, hash: string) =>
  Number(
    (
      await sql`select count(*) as n from public.trial_ledger where kind = 'device' and value_hash = ${hash}`
    )[0]!.n,
  );

describe.skipIf(!URL_ENV)('start_trial_with_ledger under two real transactions', () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const names = { real: `trial_race_${suffix}`, unlocked: `trial_race_unlocked_${suffix}` };
  let admin: Sql;
  let real: Sql;
  let unlocked: Sql;

  beforeAll(async () => {
    admin = postgres(URL_ENV!, { max: 1, onnotice: () => {} });
    real = await migrated(admin, names.real);
    unlocked = await migrated(admin, names.unlocked, (text) => {
      if (!text.includes(LOCK_CALL)) throw new Error('the lock call to remove is not in 006c');
      return text.replace(LOCK_CALL, '');
    });
  }, 120_000);

  afterAll(async () => {
    await real?.end({ timeout: 5 });
    await unlocked?.end({ timeout: 5 });
    for (const n of Object.values(names))
      await admin?.unsafe(`drop database if exists ${n} with (force)`);
    await admin?.end({ timeout: 5 });
  });

  /** Two new accounts on one device that already has one trial in the last 30 days. */
  async function sameDevice(sql: Sql, tag: string) {
    const device: Hash = { kind: 'device', value_hash: hex(1, `${tag}-device`) };
    const prior = await account(sql, `${tag}-prior@example.com`);
    await sql`insert into public.trial_ledger (kind, value_hash, account_id, trial_kind, created_at)
              values ('device', ${device.value_hash}, ${prior.id}, 'pro', now() - interval '1 day')`;
    const x = await account(sql, `${tag}-x@example.com`);
    const y = await account(sql, `${tag}-y@example.com`);
    const call = (who: typeof x, n: number): Call => ({
      accountId: who.id,
      hashes: [{ kind: 'email', value_hash: hex(n, `${tag}-email`) }, device],
      transition: who.transition,
    });
    return { device, x, y, a: call(x, 2), b: call(y, 3) };
  }

  it('one device hash: the second waits for the first, then is refused; one trial, the right rows', async () => {
    const s = await sameDevice(real, 'dev');
    const r = await race(real, s.a, s.b);
    expect(r.waited, 'B waited on a lock while A held it').toBe(true);
    expect([r.a, r.b]).toEqual(['started', 'refused']);
    expect(await trials(real, [s.x.id, s.y.id])).toBe(1);
    expect(await rowsOf(real, s.x.id)).toBe(2);
    expect(await rowsOf(real, s.y.id)).toBe(0);
    expect(await deviceRows(real, s.device.value_hash)).toBe(2);
  });

  it('one account, two calls: the second waits for the first, then is not_eligible; one trial, one set of rows', async () => {
    const x = await account(real, 'acct-x@example.com');
    const call: Call = {
      accountId: x.id,
      hashes: [
        { kind: 'email', value_hash: hex(4, 'acct-email') },
        { kind: 'device', value_hash: hex(5, 'acct-device') },
      ],
      transition: x.transition,
    };
    const r = await race(real, call, call);
    expect(r.waited, 'B waited on a lock while A held it').toBe(true);
    expect([r.a, r.b]).toEqual(['started', 'not_eligible']);
    expect(await trials(real, [x.id])).toBe(1);
    expect(await rowsOf(real, x.id)).toBe(2);
  });

  it('mutation check: without the advisory locks the same device race starts two trials', async () => {
    const s = await sameDevice(unlocked, 'mut');
    const r = await race(unlocked, s.a, s.b);
    expect(r.waited).toBe(false);
    expect([r.a, r.b]).toEqual(['started', 'started']);
    expect(await trials(unlocked, [s.x.id, s.y.id])).toBe(2);
    expect(await deviceRows(unlocked, s.device.value_hash)).toBe(3);
  });
});
