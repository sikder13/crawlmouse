/**
 * The daily render budget (V2R A2, PR 4): reserve and settle on PGlite with every migration.
 * PGlite has one connection, so two calls truly at once are tested on a real Postgres:
 * scripts/db/render-budget-race.test.ts.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asRole, readMigration, readRollback } from './helpers/pglite-migrations';
import { doorDb } from './v2/_lib/door-pglite';

const MIGRATION = '20261123000001_v2_a2_render_budget.sql';
const REVERT = '20261123000001_v2_a2_render_budget.revert.sql';

let db: PGlite;
beforeAll(async () => {
  db = await doorDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec('truncate public.render_reservations; truncate public.render_budget_days;');
});

const reserve = (check: string, ms: number, limit: number) =>
  asRole(db, 'service_role', null, async (tx) => {
    const { rows } = await tx.query<{ id: string | null }>(
      'select public.reserve_render_ms($1, $2, $3) as id',
      [check, ms, limit],
    );
    return rows[0]!.id;
  });
const settle = (reservation: string, used: number | null) =>
  asRole(db, 'service_role', null, (tx) =>
    tx.query('select public.settle_render_ms($1, $2)', [reservation, used]),
  );
const committed = async () => {
  const { rows } = await db.query<{ ms: string | null }>(
    'select sum(committed_ms)::text as ms from public.render_budget_days',
  );
  return Number(rows[0]!.ms ?? 0);
};
const reservations = async () => {
  const { rows } = await db.query<{ n: number }>(
    'select count(*)::int as n from public.render_reservations',
  );
  return rows[0]!.n;
};

describe('reserving today’s browser time', () => {
  it('grants up to the cap and refuses past it, counting nothing for a refusal', async () => {
    expect(await reserve(randomUUID(), 600, 1000)).toEqual(expect.any(String));
    expect(await reserve(randomUUID(), 400, 1000)).toEqual(expect.any(String));
    expect(await committed()).toBe(1000);
    expect(await reserve(randomUUID(), 1, 1000)).toBeNull();
    expect(await committed()).toBe(1000);
    expect(await reservations()).toBe(2);
  });

  it.each([
    ['no time', 0, 1000],
    ['a negative time', -5, 1000],
    ['a cap of zero', 10, 0],
  ])('refuses %s and writes nothing', async (_n, ms, limit) => {
    expect(await reserve(randomUUID(), ms, limit)).toBeNull();
    expect(await reservations()).toBe(0);
    expect(await committed()).toBe(0);
  });
});

describe('a render step that is retried', () => {
  it('counts what each attempt spent, not only the last', async () => {
    const check = randomUUID();
    const first = (await reserve(check, 600, 5000))!;
    await settle(first, 100);
    const second = (await reserve(check, 600, 5000))!;
    expect(second).not.toBe(first);
    await settle(second, 250);
    expect(await committed()).toBe(350);
  });

  it('keeps a whole reservation counted when its attempt died before settling', async () => {
    const check = randomUUID();
    await reserve(check, 240, 5000);
    const second = (await reserve(check, 240, 5000))!;
    await settle(second, 240);
    expect(await committed()).toBe(480);
  });

  it('holds the cap against a retry, whatever it asks for', async () => {
    const check = randomUUID();
    await reserve(check, 100, 1000);
    await reserve(randomUUID(), 900, 1000);
    expect(await reserve(check, 280, 1000)).toBeNull();
    expect(await committed()).toBe(1000);
  });

  it('three attempts of five checks cannot pass the cap unseen', async () => {
    let granted = 0;
    for (let c = 0; c < 5; c++) {
      const check = randomUUID();
      for (let attempt = 0; attempt < 3; attempt++) {
        const id = await reserve(check, 120, 1000);
        if (id === null) continue;
        granted += 120;
        await settle(id, 120);
      }
    }
    expect(granted).toBeLessThanOrEqual(1000);
    expect(await committed()).toBe(granted);
  });

  it('charges a retry to the day it runs, under that day’s cap', async () => {
    const check = randomUUID();
    await reserve(check, 600, 1000);
    await db.exec(`
      update public.render_budget_days set day = day - 1;
      update public.render_reservations set day = day - 1;
      insert into public.render_budget_days (day, committed_ms)
        values ((now() at time zone 'utc')::date, 900);
    `);
    expect(await reserve(check, 200, 1000)).toBeNull();
    const id = (await reserve(check, 100, 1000))!;
    await settle(id, 100);
    const { rows } = await db.query<{ day_offset: number; ms: string }>(`
      select ((now() at time zone 'utc')::date - day) as day_offset, committed_ms::text as ms
      from public.render_budget_days order by day
    `);
    expect(rows).toEqual([
      { day_offset: 1, ms: '600' },
      { day_offset: 0, ms: '1000' },
    ]);
  });
});

describe('settling', () => {
  it('gives back what was not used, and adds what ran over', async () => {
    const a = (await reserve(randomUUID(), 600, 5000))!;
    const b = (await reserve(randomUUID(), 100, 5000))!;
    await settle(a, 250);
    await settle(b, 180);
    expect(await committed()).toBe(430);
  });

  it('counts a repeated settle once, and ignores an unknown reservation', async () => {
    const id = (await reserve(randomUUID(), 600, 5000))!;
    await settle(id, 200);
    await settle(id, 200);
    await settle(id, 50);
    await settle(randomUUID(), 999);
    expect(await committed()).toBe(200);
  });

  it('lands on the day it reserved, across midnight UTC', async () => {
    const id = (await reserve(randomUUID(), 600, 5000))!;
    await db.exec(`
      update public.render_budget_days set day = day - 1;
      update public.render_reservations set day = day - 1;
      insert into public.render_budget_days (day, committed_ms)
        values ((now() at time zone 'utc')::date, 50);
    `);
    await settle(id, 100);
    const { rows } = await db.query<{ day_offset: number; ms: string }>(`
      select ((now() at time zone 'utc')::date - day) as day_offset, committed_ms::text as ms
      from public.render_budget_days order by day
    `);
    expect(rows).toEqual([
      { day_offset: 1, ms: '100' },
      { day_offset: 0, ms: '50' },
    ]);
  });

  it('keeps the whole reservation counted when the time used is unknown', async () => {
    const id = (await reserve(randomUUID(), 600, 5000))!;
    await settle(id, null);
    expect(await committed()).toBe(600);
    // And it stays open: a later settle with a real figure still closes it once.
    await settle(id, 250);
    expect(await committed()).toBe(250);
  });

  it('never takes a day below zero', async () => {
    const id = (await reserve(randomUUID(), 600, 5000))!;
    await db.exec('update public.render_budget_days set committed_ms = 10');
    await settle(id, 0);
    expect(await committed()).toBe(0);
  });
});

describe('keeping the reservations table small', () => {
  it('removes the 100 oldest rows past a week, settled or not, and leaves the totals', async () => {
    await db.exec(`
      insert into public.render_budget_days (day, committed_ms) values ('2020-01-01', 777);
      insert into public.render_reservations (check_id, day, reserved_ms, used_ms, created_at)
      select gen_random_uuid(), '2020-01-01', 10, case when i % 2 = 0 then 5 end,
             now() - interval '30 days' + (i || ' seconds')::interval
      from generate_series(1, 150) i;
      insert into public.render_reservations (check_id, day, reserved_ms, created_at)
      values (gen_random_uuid(), '2020-01-01', 10, now() - interval '6 days');
    `);
    await reserve(randomUUID(), 10, 1000);
    const { rows } = await db.query<{ old: number; recent: number; oldest: number }>(`
      select count(*) filter (where created_at < now() - interval '7 days')::int as old,
             count(*) filter (where created_at >= now() - interval '7 days')::int as recent,
             extract(epoch from (min(created_at) - (now() - interval '30 days')))::int as oldest
      from public.render_reservations
    `);
    expect(rows[0]!.old).toBe(50);
    expect(rows[0]!.recent).toBe(2);
    // The 100 oldest went, so the oldest left is the 101st.
    expect(rows[0]!.oldest).toBe(101);
    const { rows: day } = await db.query<{ ms: string }>(
      `select committed_ms::text as ms from public.render_budget_days where day = '2020-01-01'`,
    );
    expect(day[0]!.ms).toBe('777');
  });
  it('keeps a reservation that is less than a week old', async () => {
    await db.exec(`
      insert into public.render_reservations (check_id, day, reserved_ms, created_at)
      values (gen_random_uuid(), '2020-01-01', 10, now() - interval '6 days');
    `);
    await reserve(randomUUID(), 10, 1000);
    expect(await reservations()).toBe(2);
  });
});

describe('who can reach it', () => {
  it.each(['anon', 'authenticated'] as const)('%s can neither read nor call', async (role) => {
    await expect(
      asRole(db, role, null, (tx) => tx.query('select * from public.render_budget_days')),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, role, null, (tx) => tx.query('select * from public.render_reservations')),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, role, null, (tx) =>
        tx.query('select public.reserve_render_ms($1, 1, 1)', [randomUUID()]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, role, null, (tx) =>
        tx.query('select public.settle_render_ms($1, 1)', [randomUUID()]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('the rollback', () => {
  it('removes what the migration added, and the migration applies again', async () => {
    await db.exec(readRollback(REVERT));
    const { rows } = await db.query(`
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('render_budget_days', 'render_reservations')
    `);
    expect(rows).toHaveLength(0);
    await db.exec(readMigration(MIGRATION));
    expect(await reserve(randomUUID(), 10, 100)).toEqual(expect.any(String));
  });
});
