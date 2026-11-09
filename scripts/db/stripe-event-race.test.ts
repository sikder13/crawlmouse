import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Two real transactions racing in `apply_stripe_event` (migration 20261110000001), on a real
 * Postgres: CI's `db-cli-files` job runs this against its Postgres service with TRIAL_RACE_DB_URL
 * set (and TRIAL_RACE_REQUIRED=1, so a missing URL fails the job rather than skipping), as it runs
 * scripts/db/trial-race.test.ts. Elsewhere it is skipped: PGlite has one backend and cannot hold
 * two transactions open at once.
 *
 * Each race holds transaction A open after its call, starts B's call, waits until B is seen waiting
 * on a lock, commits A, and then lets B finish. Each lock the function takes is also removed in a
 * database built from an edited copy of the migration, where the same race must come out wrong:
 * those are the mutation checks, run whenever the file runs.
 */

const URL_ENV = process.env.TRIAL_RACE_DB_URL;
if (!URL_ENV && process.env.TRIAL_RACE_REQUIRED === '1') {
  throw new Error('TRIAL_RACE_REQUIRED=1 but TRIAL_RACE_DB_URL is not set');
}
// It creates databases and cluster-wide roles, so it runs only against a Postgres on this machine.
if (URL_ENV && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(URL_ENV).hostname)) {
  throw new Error('TRIAL_RACE_DB_URL must name a local Postgres (localhost, 127.0.0.1 or [::1])');
}

const MIGRATION = '20261110000001_v2_billing_rpc.sql';
const LOCKS = {
  ledger: '     for update of e;\n',
  subscription: '       for update of s;\n',
  account: '       for update of a;\n',
} as const;
/** How long to watch for B waiting. Below the function's 5 s lock_timeout, so B never times out. */
const WAIT_WATCH_MS = 2000;
const OLDER = "older than the subscription's last event";

type Sql = postgres.Sql;
type Lock = keyof typeof LOCKS;

function urlFor(base: string, database: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

/** A fresh database with the Supabase stand-ins and every migration, ours without `unlock`'s lock. */
async function migrated(admin: Sql, name: string, unlock: Lock | null) {
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
    let text = readMigration(f);
    if (f === MIGRATION && unlock !== null) {
      if (text.split(LOCKS[unlock]).length !== 2) {
        throw new Error(`the ${unlock} lock to remove is not in the migration exactly once`);
      }
      text = text.replace(LOCKS[unlock], ';\n');
    }
    await sql.unsafe(text).simple();
  }
  return sql;
}

const BASE = Date.parse('2099-03-01T00:00:00.000Z');
const iso = (seconds: number) => new Date(BASE + seconds * 1000).toISOString();
let seq = 0;
const evt = () => `evt_race${++seq}_${process.pid}`;

async function signUp(sql: Sql): Promise<string> {
  const [u] =
    await sql`insert into auth.users (id, email) values (gen_random_uuid(), ${`race${++seq}@example.com`}) returning id`;
  const [a] = await sql`select default_account_id as id from public.users where id = ${u!.id}`;
  return a!.id as string;
}

async function ledger(sql: Sql, id: string) {
  await sql`insert into public.stripe_events (id, type, livemode) values (${id}, 'customer.subscription.updated', false)`;
}

const mirror = (id: string, status: string) => ({
  id,
  status,
  plan: 'pro',
  interval: 'month',
  seat_quantity: 0,
  extra_site_quantity: 0,
  current_period_end: iso(30 * 86_400),
  trial_end: null,
  cancel_at_period_end: false,
  canceled_at: null,
  ended_at: null,
  price_ids: ['price_crawlmouse_pro_monthly'],
});

/** next() on the account as stored, through toTransitionParams: what webhook-db.ts sends. */
async function transitionFor(sql: Sql, accountId: string, e: Record<string, unknown>) {
  const { next } = await import('../../apps/web/lib/billing/state-machine');
  const { snapshotFromRow, toTransitionParams } =
    await import('../../apps/web/lib/billing/state-machine-apply');
  const [row] = await sql`select * from public.accounts where id = ${accountId}`;
  const stored = snapshotFromRow(row as never);
  const t = next(stored.snapshot, e as never);
  return toTransitionParams(accountId, stored.version, t.state, e.at as Date);
}

interface P {
  event_id: string;
  event_created: string;
  account_id: string | null;
  customer_id: null;
  subscription: { id: string; gated: boolean; mirror: ReturnType<typeof mirror> | null } | null;
  transition: unknown;
  expected_version: number | null;
  handled: boolean;
  handled_reason: string | null;
  effects: unknown[];
}

const base = (eventId: string, accountId: string | null, seconds: number): P => ({
  event_id: eventId,
  event_created: iso(seconds),
  account_id: accountId,
  customer_id: null,
  subscription: null,
  transition: null,
  expected_version: null,
  handled: false,
  handled_reason: 'recorded',
  effects: [],
});

type Answer = {
  decided: boolean;
  handled: boolean | null;
  reason: string | null;
  effects: unknown[];
};

const call = (t: postgres.ReservedSql | Sql, p: P) =>
  // sql.json sends the value as jsonb; a JSON.stringify'd string would be sent as a jsonb string.
  t`select public.apply_stripe_event(${t.json(p as never)}) as r`;

/** A's call commits only after B's call has been seen waiting on a lock (or the watch ran out). */
async function race(sql: Sql, a: P, b: P) {
  const ta = await sql.reserve();
  const tb = await sql.reserve();
  try {
    const [{ pid }] = (await tb`select pg_backend_pid() as pid`) as unknown as [{ pid: number }];
    await ta`begin`;
    await ta`set local role service_role`;
    const [ra] = await call(ta, a);
    await tb`begin`;
    await tb`set local role service_role`;
    // Settled into a value at once, so a failure of B while A still holds its locks is not an
    // unhandled rejection; it is read where B's answer is.
    const pending = call(tb, b).then(
      (rows) => ({ ok: rows[0]!.r as Answer }),
      (error: unknown) => ({ error: error as { code?: string } }),
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
    await tb`commit`.catch(() => {});
    return { a: ra!.r as Answer, b: settled, waited };
  } finally {
    // A failed race leaves a transaction open; end it before the connection goes back to the pool.
    for (const t of [ta, tb]) {
      await t`rollback`.catch(() => {});
      t.release();
    }
  }
}

async function accountOf(sql: Sql, id: string) {
  const [a] = await sql`select state, entitlement_version from public.accounts where id = ${id}`;
  return { state: a!.state as string, version: a!.entitlement_version as number };
}

/** An account on Pro following a new subscription, its mirror marked at 100 s. */
async function onPro(sql: Sql) {
  const accountId = await signUp(sql);
  const sub = `sub_race${++seq}`;
  const id = evt();
  await ledger(sql, id);
  const transition = await transitionFor(sql, accountId, {
    type: 'checkout_completed',
    at: new Date(BASE + 100_000),
    plan: 'pro',
    subscriptionId: sub,
    subscriptionStatus: 'active',
    extras: { seats: 0, sites: 0 },
  });
  await sql.begin(async (t) => {
    await t`set local role service_role`;
    await call(t as never, {
      ...base(id, accountId, 100),
      subscription: { id: sub, gated: false, mirror: mirror(sub, 'active') },
      transition,
      handled: true,
      handled_reason: null,
    });
  });
  return { accountId, sub };
}

/** The older event: the subscription past due at 200 s, decided on version 1. */
async function olderPastDue(sql: Sql, accountId: string, sub: string): Promise<P> {
  const id = evt();
  await ledger(sql, id);
  return {
    ...base(id, accountId, 200),
    subscription: { id: sub, gated: true, mirror: mirror(sub, 'past_due') },
    transition: await transitionFor(sql, accountId, {
      type: 'subscription_updated',
      at: new Date(BASE + 200_000),
      subscriptionId: sub,
      status: 'past_due',
      plan: 'pro',
      cancelAtPeriodEnd: false,
      extras: { seats: 0, sites: 0 },
    }),
    handled: true,
    handled_reason: null,
  };
}

/** The newer event: active again at 300 s, which changes nothing: a confirm on version 1. */
async function newerUnchanged(sql: Sql, accountId: string, sub: string): Promise<P> {
  const id = evt();
  await ledger(sql, id);
  return {
    ...base(id, accountId, 300),
    subscription: { id: sub, gated: true, mirror: mirror(sub, 'active') },
    expected_version: 1,
    handled_reason: 'no entitlement change',
  };
}

describe.skipIf(!URL_ENV)('apply_stripe_event under two real transactions', () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const names = {
    real: `stripe_race_${suffix}`,
    ledger: `stripe_race_ledger_${suffix}`,
    subscription: `stripe_race_subscription_${suffix}`,
    account: `stripe_race_account_${suffix}`,
  };
  let admin: Sql;
  const dbs = {} as Record<keyof typeof names, Sql>;

  beforeAll(async () => {
    admin = postgres(URL_ENV!, { max: 1, onnotice: () => {} });
    dbs.real = await migrated(admin, names.real, null);
    dbs.ledger = await migrated(admin, names.ledger, 'ledger');
    dbs.subscription = await migrated(admin, names.subscription, 'subscription');
    dbs.account = await migrated(admin, names.account, 'account');
  }, 180_000);

  afterAll(async () => {
    for (const sql of Object.values(dbs)) await sql?.end({ timeout: 5 });
    for (const n of Object.values(names))
      await admin?.unsafe(`drop database if exists ${n} with (force)`);
    await admin?.end({ timeout: 5 });
  });

  // ── 1. two deliveries of one event ──

  async function sameEventTwice(sql: Sql) {
    const id = evt();
    await ledger(sql, id);
    const effects = [
      { kind: 'alert', reason: 'dispute', accountId: null, subscriptionId: null, source: id },
    ];
    const p: P = { ...base(id, null, 0), effects };
    return { r: await race(sql, p, { ...p, effects: [] }), effects };
  }

  it('one event twice: the second waits for the first, then answers its decision', async () => {
    const { r, effects } = await sameEventTwice(dbs.real);
    expect(r.waited, 'B waited on a lock while A held it').toBe(true);
    expect(r.a).toMatchObject({ decided: false, effects });
    expect(r.b).toEqual({
      ok: { decided: true, handled: false, reason: 'recorded', effects, version: null },
    });
  });

  it('one event twice through the machine: decided once, the account written once', async () => {
    const accountId = await signUp(dbs.real);
    const sub = `sub_race${++seq}`;
    const id = evt();
    await ledger(dbs.real, id);
    const p: P = {
      ...base(id, accountId, 100),
      subscription: { id: sub, gated: false, mirror: mirror(sub, 'active') },
      transition: await transitionFor(dbs.real, accountId, {
        type: 'checkout_completed',
        at: new Date(BASE + 100_000),
        plan: 'pro',
        subscriptionId: sub,
        subscriptionStatus: 'active',
        extras: { seats: 0, sites: 0 },
      }),
      handled: true,
      handled_reason: null,
    };
    const r = await race(dbs.real, p, p);
    expect(r.waited).toBe(true);
    expect([r.a.decided, 'ok' in r.b && r.b.ok.decided]).toEqual([false, true]);
    expect(await accountOf(dbs.real, accountId)).toEqual({ state: 'pro', version: 1 });
  });

  it('mutation check: without the ledger lock both calls decide', async () => {
    const { r } = await sameEventTwice(dbs.ledger);
    expect(r.a.decided).toBe(false);
    expect(r.b).toMatchObject({ ok: { decided: false } });
  });

  // ── 2. an older and a newer event on one subscription ──

  it('the newer holds the subscription: the older waits, then writes neither mirror nor transition', async () => {
    const { accountId, sub } = await onPro(dbs.real);
    const newer = await newerUnchanged(dbs.real, accountId, sub);
    const older = await olderPastDue(dbs.real, accountId, sub);
    const r = await race(dbs.real, newer, older);
    expect(r.waited).toBe(true);
    expect(r.a).toMatchObject({ decided: false, handled: false, reason: 'no entitlement change' });
    expect(r.b).toMatchObject({ ok: { decided: false, handled: false, reason: OLDER } });
    expect(await accountOf(dbs.real, accountId)).toEqual({ state: 'pro', version: 1 });
    const [s] = await dbs.real`select status from public.subscriptions where id = ${sub}`;
    expect(s!.status).toBe('active');
  });

  it('the older holds the subscription: the newer waits, then refuses its stale version (40001)', async () => {
    const { accountId, sub } = await onPro(dbs.real);
    const older = await olderPastDue(dbs.real, accountId, sub);
    const newer = await newerUnchanged(dbs.real, accountId, sub);
    const r = await race(dbs.real, older, newer);
    expect(r.waited).toBe(true);
    expect(r.a).toMatchObject({ decided: false, handled: true });
    expect(r.b).toMatchObject({ error: { code: '40001' } });
    // The webhook decides the newer again on past_due; here the older's write stands alone.
    expect(await accountOf(dbs.real, accountId)).toEqual({ state: 'past_due', version: 2 });
  });

  it('mutation check: without the subscription lock the older writes past_due after the newer', async () => {
    const { accountId, sub } = await onPro(dbs.subscription);
    const newer = await newerUnchanged(dbs.subscription, accountId, sub);
    const older = await olderPastDue(dbs.subscription, accountId, sub);
    const r = await race(dbs.subscription, newer, older);
    expect(r.b).toMatchObject({ ok: { decided: false, handled: true } });
    expect(await accountOf(dbs.subscription, accountId)).toEqual({ state: 'past_due', version: 2 });
  });

  // ── 3. a confirm and a commit on one account ──

  async function commitThenConfirm(sql: Sql) {
    const accountId = await signUp(sql);
    const commitId = evt();
    await ledger(sql, commitId);
    const commit: P = {
      ...base(commitId, accountId, 100),
      transition: await transitionFor(sql, accountId, {
        type: 'dispute_created',
        at: new Date(BASE + 100_000),
      }),
      handled: true,
      handled_reason: null,
    };
    const confirmId = evt();
    await ledger(sql, confirmId);
    const confirm: P = {
      ...base(confirmId, accountId, 100),
      expected_version: 0,
      handled_reason: 'not the current subscription',
    };
    return { accountId, r: await race(sql, commit, confirm) };
  }

  it('a commit holds the account: a confirm on the old version waits, then refuses it (40001)', async () => {
    const { r } = await commitThenConfirm(dbs.real);
    expect(r.waited).toBe(true);
    expect(r.a).toMatchObject({ decided: false, handled: true, version: 1 });
    expect(r.b).toMatchObject({ error: { code: '40001' } });
  });

  it('mutation check: without the account lock the confirm records a decision made on the old version', async () => {
    const { r } = await commitThenConfirm(dbs.account);
    expect(r.waited).toBe(false);
    expect(r.b).toMatchObject({ ok: { decided: false, handled: false } });
  });
});
