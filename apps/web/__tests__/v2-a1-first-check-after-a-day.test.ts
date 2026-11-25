import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAllMigrations,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { personalAccount, signUp } from './helpers/v2-check-tables';

/**
 * Migration 20261125000001 (D-18, QA's production dashboard walk): a site's first scheduled check is
 * not before a day after the site was added. On production, a site added at 03:38 UTC with a weekly
 * schedule was due at 06:32 the same day. Each case picks a schedule whose slot under 028's rule falls
 * within hours of now, proves that it does (so the case can fail), then reads what the trigger set.
 */

const MIGRATION = '20261125000001_v2_a1_first_check_after_a_day.sql';
const ROLLBACK = '20261125000001_v2_a1_first_check_after_a_day.revert.sql';
const DAY = 86_400_000;

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => db.close());

async function proAccount(timezone = 'UTC') {
  const userId = await signUp(db, `first-${randomUUID()}@example.com`);
  const { accountId } = await personalAccount(db, userId);
  await db.query(
    `update public.accounts
        set timezone = $2, state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
            trial_ends_at = now() + interval '7 days', trial_used_at = now(),
            state_history = state_history || jsonb_build_array(
              jsonb_build_object('state', 'pro_trial', 'since', now()))
      where id = $1`,
    [accountId, timezone],
  );
  return accountId;
}

/** A weekly slot (UTC) a little over two hours from now: 028's rule would run it today or tonight. */
function soonSlot() {
  const t = new Date(Date.now() + 2 * 3_600_000 + 5 * 60_000);
  return { weekday: t.getUTCDay() || 7, hour: t.getUTCHours() };
}

async function oldRule(weekday: number, hour: number, from: string): Promise<number> {
  const { rows } = await db.query<{ v: Date }>(
    `select public.next_check_after('weekly', $1::smallint, $2::smallint, 0::smallint, 'UTC', $3::timestamptz) v`,
    [weekday, hour, from],
  );
  return rows[0]!.v.getTime();
}

async function row(id: string) {
  const { rows } = await db.query<{ next_check_at: Date | null; created_at: Date }>(
    `select next_check_at, created_at from public.sites where id = $1`,
    [id],
  );
  return rows[0]!;
}

async function addSite(accountId: string | null, weekday: number, hour: number) {
  const id = randomUUID();
  await db.query(
    `insert into public.sites (id, account_id, host, schedule_cadence, schedule_iso_weekday,
                               schedule_hour_local, schedule_offset_min)
     values ($1, $2, $3, $4, $5, $6, 0)`,
    [
      id,
      accountId,
      `${id.slice(0, 8)}.example`,
      accountId === null ? null : 'weekly',
      accountId === null ? null : weekday,
      accountId === null ? null : hour,
    ],
  );
  return id;
}

describe('a site’s first scheduled check is a day or more after it was added (D-18)', () => {
  it('a site added with a schedule: its slot today is passed over, and the next is a week on', async () => {
    const { weekday, hour } = soonSlot();
    const id = await addSite(await proAccount(), weekday, hour);
    const r = await row(id);
    // 028's rule: the same slot within a few hours of the site's first audit.
    const before = await oldRule(weekday, hour, r.created_at.toISOString());
    expect(before - r.created_at.getTime()).toBeLessThan(3 * 3_600_000);
    // Now: at least a day after it was added; the same weekday and hour, the next week.
    expect(r.next_check_at!.getTime() - r.created_at.getTime()).toBeGreaterThanOrEqual(DAY);
    expect(r.next_check_at!.getTime() - before).toBe(7 * DAY);
  });

  it('a site an account keeps after its first audit: the same, on the update that keeps it', async () => {
    const { weekday, hour } = soonSlot();
    const id = await addSite(null, weekday, hour);
    expect((await row(id)).next_check_at).toBeNull();
    const accountId = await proAccount();
    await db.query(
      `update public.sites
          set account_id = $2, schedule_cadence = 'weekly', schedule_iso_weekday = $3,
              schedule_hour_local = $4
        where id = $1`,
      [id, accountId, weekday, hour],
    );
    const r = await row(id);
    expect(r.next_check_at!.getTime() - r.created_at.getTime()).toBeGreaterThanOrEqual(DAY);
  });

  it('a site added more than a day ago is scheduled from now, as before', async () => {
    const accountId = await proAccount();
    const id = randomUUID();
    const { weekday, hour } = soonSlot();
    await db.query(
      `insert into public.sites (id, account_id, host, schedule_cadence, schedule_iso_weekday,
                                 schedule_hour_local, schedule_offset_min, created_at)
       values ($1, $2, $3, 'weekly', $4, $5, 0, now() - interval '3 days')`,
      [id, accountId, `${id.slice(0, 8)}.example`, weekday, hour],
    );
    const r = await row(id);
    expect(r.next_check_at!.getTime()).toBe(await oldRule(weekday, hour, new Date().toISOString()));
  });

  it('a zone change keeps the day: a site added just now is not moved into today', async () => {
    const { weekday, hour } = soonSlot();
    const accountId = await proAccount('America/New_York');
    // In New York the slot's hour is five hours later than in UTC; written in UTC terms it is soon.
    const id = await addSite(accountId, weekday, hour);
    await db.query(`update public.accounts set timezone = 'UTC' where id = $1`, [accountId]);
    const r = await row(id);
    expect(r.next_check_at!.getTime() - r.created_at.getTime()).toBeGreaterThanOrEqual(DAY);
  });
});

describe('the migration applies twice and its revert puts 028’s functions back', () => {
  it('re-applies, reverts twice to 028’s definitions character for character, and re-applies', async () => {
    const own = await freshDb();
    const defs = async () =>
      (
        await own.query<{ d: string }>(
          `select pg_get_functiondef(p.oid) d from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('sites_schedule_next', 'accounts_timezone_reschedule')
            order by p.proname`,
        )
      ).rows.map((r) => r.d);
    try {
      await applyAllMigrations(own, undefined, (f) => f < MIGRATION);
      const before = await defs();
      await own.exec(readMigration(MIGRATION));
      const during = await defs();
      expect(during).not.toEqual(before);
      await own.exec(readMigration(MIGRATION));
      expect(await defs()).toEqual(during);
      await own.exec(readRollback(ROLLBACK));
      await own.exec(readRollback(ROLLBACK));
      expect(await defs()).toEqual(before);
      await own.exec(readMigration(MIGRATION));
      expect(await defs()).toEqual(during);
    } finally {
      await own.close();
    }
  }, 300_000);
});
