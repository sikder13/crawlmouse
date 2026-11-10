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
 * on a lock, commits A, and then lets B finish. What serialises each path is also removed in a
 * database built from an edited copy of the migration, where the same race must come out wrong:
 * those are the mutation checks, run whenever the file runs. On the subscription path the insert is
 * the protection for a new row and the lock covers a row that exists (spec 03, "Concurrency"), so its
 * checks vary both what is removed and whether the row exists before the race: on a new row the
 * newer event's insert creates it inside the race.
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
/**
 * How a mutated database differs from the migration. Each `for update` names a lock it leaves out;
 * `insert` leaves out the subscription row's `insert … on conflict do nothing`, the only statement
 * that creates the row; `guardEarly` keeps both but runs the locking read and the guard before the
 * insert, then locks the row again so a call that creates it still writes its mark. Run one call
 * after the other it decides as the migration does (the serial control below); only a call racing
 * a concurrent creator of the row reads no row and skips the guard.
 */
const EDITS = {
  ledger: { find: '     for update of e;\n', with: ';\n' },
  subscription: { find: '       for update of s;\n', with: ';\n' },
  account: { find: '       for update of a;\n', with: ';\n' },
  insert: {
    find: /^      insert into public\.subscriptions \(id, account_id,[\s\S]*?on conflict \(id\) do nothing;\n/m,
    with: '',
  },
  guardEarly: {
    find: /^(    if v_m is not null then\n      insert into public\.subscriptions [\s\S]*?on conflict \(id\) do nothing;\n    end if;\n)([\s\S]*?v_m_prices := null;\n    end if;\n)/m,
    with: '$2$1    perform 1 from public.subscriptions s where s.id = v_sub_id for update of s;\n    v_sub_found := found;\n',
  },
} as const;
/** How long to watch for B waiting. Below the function's 5 s lock_timeout, so B never times out. */
const WAIT_WATCH_MS = 2000;
const OLDER = "older than the subscription's last event";

type Sql = postgres.Sql;
type Edit = keyof typeof EDITS;

function urlFor(base: string, database: string): string {
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

/** A fresh database with the Supabase stand-ins and every migration, ours without `edits`. */
async function migrated(admin: Sql, name: string, edits: readonly Edit[]) {
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
    if (f === MIGRATION) {
      for (const e of edits) {
        const { find, with: replacement } = EDITS[e];
        const count =
          typeof find === 'string'
            ? text.split(find).length - 1
            : (text.match(new RegExp(find, 'gm')) ?? []).length;
        if (count !== 1) throw new Error(`the ${e} edit does not match the migration exactly once`);
        text = text.replace(find, replacement);
      }
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

interface Lock {
  relname: string | null;
  mode: string;
  granted: boolean;
}

/** The table-level lock modes B held on a table while it waited (row locks are not recorded). */
const heldOn = (locks: Lock[], table: string) =>
  locks.filter((l) => l.granted && l.relname === table).map((l) => l.mode);

/**
 * A's call commits only after B's call has been seen waiting on a lock (or the watch ran out).
 * `locks` is what B held at that moment, which says where in the function it was waiting.
 */
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
    let locks: Lock[] = [];
    for (const until = Date.now() + WAIT_WATCH_MS; Date.now() < until && !waited; ) {
      const [w] =
        await sql`select exists (select 1 from pg_locks where pid = ${pid} and not granted) as w`;
      waited = w!.w as boolean;
      if (waited) {
        locks = (await sql`select c.relname, l.mode, l.granted from pg_locks l
                             left join pg_class c on c.oid = l.relation
                            where l.pid = ${pid} and l.locktype = 'relation'`) as unknown as Lock[];
      }
      if (!waited) await new Promise((r) => setTimeout(r, 25));
    }
    await ta`commit`;
    const settled = await pending;
    await tb`commit`.catch(() => {});
    return { a: ra!.r as Answer, b: settled, waited, locks };
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

/**
 * An account on Pro following a new subscription. With `row`, the checkout carries the mirror, as
 * the webhook's does, and writes the subscription row marked at 100 s. Without it the account
 * changes by the transition alone and no subscription row exists, so the next call carrying a mirror
 * is the one that creates it. That call is set-up only: the webhook's checkout names its
 * subscription and carries the mirror (apps/web/lib/billing/stripe-normalise.ts).
 */
async function onPro(sql: Sql, row = true) {
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
      subscription: row ? { id: sub, gated: false, mirror: mirror(sub, 'active') } : null,
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
    insert: `stripe_race_insert_${suffix}`,
    unguarded: `stripe_race_unguarded_${suffix}`,
    account: `stripe_race_account_${suffix}`,
    guardEarly: `stripe_race_guard_early_${suffix}`,
  };
  let admin: Sql;
  const dbs = {} as Record<keyof typeof names, Sql>;

  beforeAll(async () => {
    admin = postgres(URL_ENV!, { max: 1, onnotice: () => {} });
    dbs.real = await migrated(admin, names.real, []);
    dbs.ledger = await migrated(admin, names.ledger, ['ledger']);
    dbs.subscription = await migrated(admin, names.subscription, ['subscription']);
    dbs.insert = await migrated(admin, names.insert, ['insert']);
    dbs.unguarded = await migrated(admin, names.unguarded, ['subscription', 'insert']);
    dbs.account = await migrated(admin, names.account, ['account']);
    dbs.guardEarly = await migrated(admin, names.guardEarly, ['guardEarly']);
  }, 240_000);

  afterAll(async () => {
    for (const sql of Object.values(dbs)) await sql?.end({ timeout: 5 });
    for (const n of Object.values(names))
      await admin?.unsafe(`drop database if exists ${n} with (force)`);
    await admin?.end({ timeout: 5 });
    // Its own timeout: on a local Postgres 17 the first drop took most of vitest's default 10 s.
  }, 120_000);

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

  /**
   * The newer event holds the subscription; the older one races it. `row` is the subscription row
   * before the race:
   * - 'new': none. The account went to Pro without a mirror, so the newer's insert creates the row
   *   and A holds it uncommitted while B runs.
   * - 'existing': written and committed before the race, by the setup's checkout, or, in the
   *   databases without the insert (where no call creates a row), by the statement below.
   */
  async function olderAfterNewer(sql: Sql, row: 'new' | 'existing', serial = false) {
    const { accountId, sub } = await onPro(sql, row === 'existing');
    if (row === 'existing') {
      await sql`insert into public.subscriptions (id, account_id, status, plan, interval, price_ids,
                  current_period_end, last_event_created)
                values (${sub}, ${accountId}, 'active', 'pro', 'month', ${['price_crawlmouse_pro_monthly']},
                        ${iso(30 * 86_400)}, ${iso(100)})
                on conflict (id) do nothing`;
    }
    const before = await subscriptionRow(sql, sub);
    if ((before === null) !== (row === 'new'))
      throw new Error(`the ${row} set-up left the row ${before ? 'present' : 'absent'}`);
    const newer = await newerUnchanged(sql, accountId, sub);
    const older = await olderPastDue(sql, accountId, sub);
    if (!serial) return { accountId, sub, r: await race(sql, newer, older) };
    // The control: the newer commits before the older starts.
    const one = async (p: P) =>
      sql.begin(async (t) => {
        await t`set local role service_role`;
        return (await call(t as never, p))[0]!.r as Answer;
      });
    const a = await one(newer);
    return {
      accountId,
      sub,
      r: { a, b: { ok: await one(older) }, waited: false, locks: [] as Lock[] },
    };
  }

  // Where B waits in a new-row race: inside the insert, on the conflicting key, which holds
  // RowExclusiveLock on subscriptions. It has not reached the locking read (RowShareLock on
  // subscriptions). No lock on accounts separates that wait from one in the insert's foreign-key check,
  // which takes RowShareLock on accounts, and from one at the account lock further on.
  const waitedInTheInsert = (locks: Lock[]) => {
    expect(heldOn(locks, 'subscriptions')).toContain('RowExclusiveLock');
    expect(heldOn(locks, 'subscriptions')).not.toContain('RowShareLock');
    expect(heldOn(locks, 'accounts')).toEqual([]);
  };

  async function subscriptionRow(sql: Sql, sub: string) {
    return (await sql`select status from public.subscriptions where id = ${sub}`)[0] ?? null;
  }

  // What serialises this path (spec 03, "Concurrency"): the insert … on conflict, the only statement
  // that creates a subscription row, which waits for a concurrent writer of that row; and the row
  // lock, which can lock only a row that exists.
  it('on a brand-new subscription the newer creates the row; the older waits in its insert, then is refused', async () => {
    const { accountId, sub, r } = await olderAfterNewer(dbs.real, 'new');
    expect(r.waited).toBe(true);
    waitedInTheInsert(r.locks);
    expect(r.a).toMatchObject({ decided: false, handled: false, reason: 'no entitlement change' });
    expect(r.b).toMatchObject({ ok: { decided: false, handled: false, reason: OLDER } });
    expect(await accountOf(dbs.real, accountId)).toEqual({ state: 'pro', version: 1 });
    expect(await subscriptionRow(dbs.real, sub)).toMatchObject({ status: 'active' });
  });

  it('without the lock, on a brand-new subscription, the insert alone prevents the race', async () => {
    // B's insert waits for A's uncommitted row; once A commits it does nothing, and B's next read
    // sees A's row and its mark.
    const { accountId, sub, r } = await olderAfterNewer(dbs.subscription, 'new');
    expect(r.waited).toBe(true);
    waitedInTheInsert(r.locks);
    expect(r.b).toMatchObject({ ok: { decided: false, handled: false, reason: OLDER } });
    expect(await accountOf(dbs.subscription, accountId)).toEqual({ state: 'pro', version: 1 });
    expect(await subscriptionRow(dbs.subscription, sub)).toMatchObject({ status: 'active' });
  });

  it('control: with the guard before the insert, one call after the other, the older is refused', async () => {
    const { accountId, r } = await olderAfterNewer(dbs.guardEarly, 'new', true);
    expect(r.b).toMatchObject({ ok: { decided: false, handled: false, reason: OLDER } });
    expect(await accountOf(dbs.guardEarly, accountId)).toEqual({ state: 'pro', version: 1 });
  });

  it('mutation check: with the guard before the insert, on a brand-new subscription, the older writes past_due after the newer', async () => {
    // B's guard reads no committed row and passes; its insert then waits for A's row, too late.
    const { accountId, r } = await olderAfterNewer(dbs.guardEarly, 'new');
    expect(r.waited).toBe(true);
    expect(r.b).toMatchObject({ ok: { decided: false, handled: true } });
    expect(await accountOf(dbs.guardEarly, accountId)).toEqual({ state: 'past_due', version: 2 });
  });

  it('without the lock, on a row that exists, the insert waits on the newer’s update of it and the older is refused', async () => {
    const { accountId, r } = await olderAfterNewer(dbs.subscription, 'existing');
    expect(r.waited).toBe(true);
    expect(r.b).toMatchObject({ ok: { decided: false, handled: false, reason: OLDER } });
    expect(await accountOf(dbs.subscription, accountId)).toEqual({ state: 'pro', version: 1 });
  });

  it('mutation check: without the insert no call creates the row, so no guard runs and the older writes past_due', async () => {
    // A serial run ends the same way; what this shows is that nothing else creates the row.
    const { accountId, sub, r } = await olderAfterNewer(dbs.insert, 'new');
    expect(r.b).toMatchObject({ ok: { decided: false, handled: true } });
    expect(await accountOf(dbs.insert, accountId)).toEqual({ state: 'past_due', version: 2 });
    expect(await subscriptionRow(dbs.insert, sub)).toBeNull();
  });

  it('without the insert, on a row that already exists, the lock alone prevents the race', async () => {
    const { accountId, sub, r } = await olderAfterNewer(dbs.insert, 'existing');
    expect(r.waited).toBe(true);
    expect(r.b).toMatchObject({ ok: { decided: false, handled: false, reason: OLDER } });
    expect(await accountOf(dbs.insert, accountId)).toEqual({ state: 'pro', version: 1 });
    expect(await subscriptionRow(dbs.insert, sub)).toMatchObject({ status: 'active' });
  });

  it('mutation check: without the insert and the lock, on a row that exists, the older writes past_due after the newer', async () => {
    const { accountId, r } = await olderAfterNewer(dbs.unguarded, 'existing');
    expect(r.b).toMatchObject({ ok: { decided: false, handled: true } });
    expect(await accountOf(dbs.unguarded, accountId)).toEqual({ state: 'past_due', version: 2 });
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
    // B's plain read of the version does not wait, and passes on version 0. B does wait afterwards:
    // writing its ledger row's account_id takes FOR KEY SHARE on the account, which A's FOR UPDATE
    // blocks. That wait comes after the decision, so it protects nothing (spec 03, "Concurrency").
    const { r } = await commitThenConfirm(dbs.account);
    expect(r.waited).toBe(true);
    // B waits while writing its ledger row (RowExclusiveLock on stripe_events), after deciding. With
    // the account lock in place it waits before writing anything.
    expect(heldOn(r.locks, 'stripe_events')).toContain('RowExclusiveLock');
    expect(r.a).toMatchObject({ decided: false, handled: true, version: 1 });
    expect(r.b).toMatchObject({ ok: { decided: false, handled: false } });
  });
});
