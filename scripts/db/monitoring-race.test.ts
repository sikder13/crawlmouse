import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Two real transactions racing in migration 20261113000001 (CC-28): two workers claiming one mail
 * (`claim_email_send`, D1) and two scheduler ticks claiming one due site (`claim_due_sites`, D4), on
 * a real Postgres. Run like scripts/db/sites-race.test.ts: against TRIAL_RACE_DB_URL (a Postgres on
 * this machine), required when TRIAL_RACE_REQUIRED=1, skipped otherwise, because PGlite has one
 * backend and cannot hold two transactions open at once.
 *
 * In each race transaction A makes its call and stays open while B makes its own; then A commits and
 * B finishes. The same races run against a database built from the migration with the guard taken
 * out (the claim's unique key replaced by a check-then-insert; the site row lock removed), where both
 * calls must win: those are the mutation checks, run whenever the file runs.
 */

const URL_ENV = process.env.TRIAL_RACE_DB_URL;
if (!URL_ENV && process.env.TRIAL_RACE_REQUIRED === '1') {
  throw new Error('TRIAL_RACE_REQUIRED=1 but TRIAL_RACE_DB_URL is not set');
}
// It creates databases and cluster-wide roles, so it runs only against a Postgres on this machine.
if (URL_ENV && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(URL_ENV).hostname)) {
  throw new Error('TRIAL_RACE_DB_URL must name a local Postgres (localhost, 127.0.0.1 or [::1])');
}

const MIGRATION = '20261113000001_v2_028_monitoring.sql';
/** The ledger's unique key on the idempotency key. */
const UNIQUE_KEY =
  'idempotency_key text not null unique check (length(idempotency_key) between 1 and 200),\n  kind text not null check (kind in';
/** The claim's insert of a new sending row, which the unique key makes wait on a concurrent one. */
const SENDING_INSERT =
  "    values (p_key, p_kind, p_hash, p_account, 'sending', 1, p_now, p_now)\n    on conflict (idempotency_key) do nothing;\n";
/** claim_due_sites's lock on the rows it claims. */
const SITE_LOCK = '     limit p_limit\n       for update of s skip locked\n';

const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 120_000;

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

/** The migration with each `[from, to]` applied, refusing to build when a `from` is not there. */
const editing =
  (...pairs: [string, string][]) =>
  (text: string): string =>
    pairs.reduce((t, [from, to]) => {
      if (!t.includes(from))
        throw new Error(`the text to edit is not in ${MIGRATION}: ${from.slice(0, 40)}`);
      return t.replace(from, to);
    }, text);

type Call<T> = (t: postgres.ReservedSql) => Promise<T>;

/** A's call is made and A stays open while B's call runs; then A commits, then B. */
async function race<T>(sql: Sql, a: Call<T>, b: Call<T>) {
  const ta = await sql.reserve();
  const tb = await sql.reserve();
  try {
    await ta`begin`;
    await ta`set local role service_role`;
    const ra = await a(ta);
    await tb`begin`;
    await tb`set local role service_role`;
    const pending = b(tb).then(
      (outcome) => ({ outcome }),
      (error: unknown) => ({ error }),
    );
    // Give B time to reach A's row before A commits.
    await new Promise((r) => setTimeout(r, 500));
    await ta`commit`;
    const settled = await pending;
    if ('error' in settled) throw settled.error;
    await tb`commit`;
    return { a: ra, b: settled.outcome };
  } finally {
    for (const t of [ta, tb]) {
      await t`rollback`.catch(() => {});
      t.release();
    }
  }
}

const claimMail =
  (key: string): Call<string> =>
  async (t) => {
    const [x] =
      await t`select public.claim_email_send(${key}, 'alert', ${'a'.repeat(64)}, null, now()) as r`;
    return (x!.r as { outcome: string }).outcome;
  };

const slot = () => ({
  bucket: `race:${randomUUID()}`,
  window_start: '2026-11-13T00:00:00.000Z',
  limit: 1000,
});

const claimSites =
  (s: ReturnType<typeof slot>): Call<string[]> =>
  async (t) =>
    (await t`select site_id from public.claim_due_sites(now(), 50, ${t.json(s as never)})`).map(
      (r) => r.site_id as string,
    );

/** A paid account with one weekly site that fell due an hour ago. */
async function dueSite(sql: Sql): Promise<string> {
  const [u] =
    await sql`insert into auth.users (id, email) values (gen_random_uuid(), ${`race-${randomUUID()}@example.com`}) returning id`;
  const [a] = await sql`select default_account_id as id from public.users where id = ${u!.id}`;
  await sql`update public.accounts
               set state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
                   trial_ends_at = now() + interval '7 days', trial_used_at = now(),
                   state_history = state_history || jsonb_build_array(
                     jsonb_build_object('state', 'pro_trial', 'since', now()))
             where id = ${a!.id}`;
  const id = randomUUID();
  await sql`insert into public.sites (id, account_id, host, schedule_cadence, schedule_iso_weekday,
                                      schedule_hour_local)
            values (${id}, ${a!.id}, ${`${id.slice(0, 8)}.example`}, 'weekly', 1, 6)`;
  await sql`update public.sites set next_check_at = now() - interval '1 hour' where id = ${id}`;
  return id;
}

describe.skipIf(!URL_ENV)('migration 028 under two real transactions', () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const names = {
    real: `monitoring_race_${suffix}`,
    unkeyed: `monitoring_race_unkeyed_${suffix}`,
    unlocked: `monitoring_race_unlocked_${suffix}`,
  };
  let admin: Sql;
  let real: Sql;
  let unkeyed: Sql;
  let unlocked: Sql;

  beforeAll(async () => {
    admin = postgres(URL_ENV!, { max: 1, onnotice: () => {} });
    real = await migrated(admin, names.real);
    unkeyed = await migrated(
      admin,
      names.unkeyed,
      editing(
        [UNIQUE_KEY, UNIQUE_KEY.replace('not null unique check', 'not null check')],
        [
          SENDING_INSERT,
          "    select p_key, p_kind, p_hash, p_account, 'sending', 1, p_now, p_now\n" +
            '     where not exists (select 1 from public.email_sends e where e.idempotency_key = p_key);\n',
        ],
      ),
    );
    unlocked = await migrated(admin, names.unlocked, editing([SITE_LOCK, '     limit p_limit\n']));
  }, 3 * HOOK_TIMEOUT_MS);

  afterAll(async () => {
    for (const s of [real, unkeyed, unlocked]) await s?.end({ timeout: 5 });
    for (const n of Object.values(names))
      await admin?.unsafe(`drop database if exists ${n} with (force)`);
    await admin?.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  it(
    'two workers claiming one mail: one goes, the other is told busy, and one row is written',
    async () => {
      const key = `race:${randomUUID()}`;
      const r = await race(real, claimMail(key), claimMail(key));
      expect(r).toEqual({ a: 'go', b: 'busy' });
      const [n] =
        await real`select count(*)::int as n from public.email_sends where idempotency_key = ${key}`;
      expect(n!.n).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'mutation: without the unique key, both workers go (the race this file exists to catch)',
    async () => {
      const key = `race:${randomUUID()}`;
      expect(await race(unkeyed, claimMail(key), claimMail(key))).toEqual({ a: 'go', b: 'go' });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'two ticks claiming at once: the site is claimed by one, and one slot is taken',
    async () => {
      const site = await dueSite(real);
      const s = slot();
      const r = await race(real, claimSites(s), claimSites(s));
      expect([...r.a, ...r.b].filter((x) => x === site)).toEqual([site]);
      const [c] =
        await real`select request_count as n from public.rate_limits where bucket_key = ${s.bucket}`;
      expect(c!.n).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'mutation: without the row lock, both ticks claim the site',
    async () => {
      const site = await dueSite(unlocked);
      const s = slot();
      const r = await race(unlocked, claimSites(s), claimSites(s));
      expect([...r.a, ...r.b].filter((x) => x === site)).toEqual([site, site]);
    },
    TEST_TIMEOUT_MS,
  );
});

/**
 * The Slack ledger under two real transactions (D5; review r1, test quality B1): two workers claiming
 * one alert's Slack message (`claim_slack_send`, a replayed `check.finished` or a step retried while
 * the first still runs). Its own databases, so it stands apart from the races above: the migration as
 * written, and one built with the claim's guard taken out (the unique key replaced by a check-then-
 * insert), where both workers must go.
 *
 * Each race also records whether B's call was still waiting when A committed. In the real database it
 * must be (B waits on A's uncommitted key, then reads it); in the mutation database it must not be (no
 * key to wait on). So a pass shows the window was hit, not only that B ran after A.
 */
const SLACK_UNIQUE_KEY =
  'idempotency_key text not null unique check (length(idempotency_key) between 1 and 200),\n  account_id uuid references public.accounts (id) on delete set null,\n  status text not null check (status in';
const SLACK_SENDING_INSERT =
  "  values (p_key, p_account, 'sending', 1, p_now, p_now)\n  on conflict (idempotency_key) do nothing;\n";

/** A's call is made and A stays open while B's runs; then A commits, then B. */
async function slackRace(sql: Sql, key: string) {
  const claim = async (t: postgres.ReservedSql) => {
    const [x] = await t`select public.claim_slack_send(${key}, null, now()) as r`;
    return (x!.r as { outcome: string }).outcome;
  };
  const ta = await sql.reserve();
  const tb = await sql.reserve();
  try {
    await ta`begin`;
    await ta`set local role service_role`;
    const a = await claim(ta);
    await tb`begin`;
    await tb`set local role service_role`;
    let settled = false;
    const pending = claim(tb).then(
      (outcome) => {
        settled = true;
        return { outcome };
      },
      (error: unknown) => {
        settled = true;
        return { error };
      },
    );
    await new Promise((r) => setTimeout(r, 500));
    const waitingAtCommit = !settled;
    await ta`commit`;
    const b = await pending;
    if ('error' in b) throw b.error;
    await tb`commit`;
    return { a, b: b.outcome, waitingAtCommit };
  } finally {
    for (const t of [ta, tb]) {
      await t`rollback`.catch(() => {});
      t.release();
    }
  }
}

describe.skipIf(!URL_ENV)('migration 028: the Slack ledger under two real transactions', () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const names = {
    real: `monitoring_race_slack_${suffix}`,
    unkeyed: `monitoring_race_slack_unkeyed_${suffix}`,
  };
  let admin: Sql;
  let real: Sql;
  let unkeyed: Sql;

  beforeAll(async () => {
    admin = postgres(URL_ENV!, { max: 1, onnotice: () => {} });
    real = await migrated(admin, names.real);
    unkeyed = await migrated(
      admin,
      names.unkeyed,
      editing(
        [
          SLACK_UNIQUE_KEY,
          SLACK_UNIQUE_KEY.replace('not null unique check', 'not null check'),
        ],
        [
          SLACK_SENDING_INSERT,
          "  select p_key, p_account, 'sending', 1, p_now, p_now\n" +
            '   where not exists (select 1 from public.slack_sends e where e.idempotency_key = p_key);\n',
        ],
      ),
    );
  }, 2 * HOOK_TIMEOUT_MS);

  afterAll(async () => {
    for (const s of [real, unkeyed]) await s?.end({ timeout: 5 });
    for (const n of Object.values(names))
      await admin?.unsafe(`drop database if exists ${n} with (force)`);
    await admin?.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  it(
    'two workers claiming one Slack message: B waits for A, then is told busy, and one row is written',
    async () => {
      const key = `alert:${randomUUID()}:slack`;
      expect(await slackRace(real, key)).toEqual({ a: 'go', b: 'busy', waitingAtCommit: true });
      const [n] =
        await real`select count(*)::int as n from public.slack_sends where idempotency_key = ${key}`;
      expect(n!.n).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'mutation: without the unique key, B does not wait and both workers go (two posts)',
    async () => {
      const key = `alert:${randomUUID()}:slack`;
      expect(await slackRace(unkeyed, key)).toEqual({ a: 'go', b: 'go', waitingAtCommit: false });
    },
    TEST_TIMEOUT_MS,
  );
});
