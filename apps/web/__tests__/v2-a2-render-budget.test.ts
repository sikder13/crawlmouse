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

const reserve = (check: string, phase: number, ms: number, limit: number) =>
  asRole(db, 'service_role', null, async (tx) => {
    const { rows } = await tx.query<{ ok: boolean }>(
      'select public.reserve_render_ms($1, $2, $3, $4) as ok',
      [check, phase, ms, limit],
    );
    return rows[0]!.ok;
  });
const settle = (check: string, phase: number, used: number) =>
  asRole(db, 'service_role', null, (tx) =>
    tx.query('select public.settle_render_ms($1, $2, $3)', [check, phase, used]),
  );
const committed = async () => {
  const { rows } = await db.query<{ ms: string | null }>(
    'select sum(committed_ms)::text as ms from public.render_budget_days',
  );
  return Number(rows[0]!.ms ?? 0);
};

describe('reserving today’s browser time', () => {
  it('grants up to the cap and refuses past it, counting nothing for a refusal', async () => {
    expect(await reserve(randomUUID(), 1, 600, 1000)).toBe(true);
    expect(await reserve(randomUUID(), 1, 400, 1000)).toBe(true);
    expect(await committed()).toBe(1000);
    expect(await reserve(randomUUID(), 1, 1, 1000)).toBe(false);
    expect(await committed()).toBe(1000);
  });

  it.each([
    ['no time', 0, 1000],
    ['a negative time', -5, 1000],
    ['a cap of zero', 10, 0],
  ])('refuses %s and writes nothing', async (_n, ms, limit) => {
    expect(await reserve(randomUUID(), 1, ms, limit)).toBe(false);
    const { rows } = await db.query('select 1 from public.render_reservations');
    expect(rows).toHaveLength(0);
    expect(await committed()).toBe(0);
  });

  it('counts a retried step’s reservation once', async () => {
    const check = randomUUID();
    expect(await reserve(check, 1, 600, 1000)).toBe(true);
    expect(await reserve(check, 1, 600, 1000)).toBe(true);
    expect(await committed()).toBe(600);
  });

  it('counts a check’s two phases as two reservations', async () => {
    const check = randomUUID();
    await reserve(check, 1, 300, 1000);
    await reserve(check, 2, 200, 1000);
    expect(await committed()).toBe(500);
  });

  it('reopens a settled phase when its step is retried, and holds the cap while doing so', async () => {
    const check = randomUUID();
    await reserve(check, 1, 600, 1000);
    await settle(check, 1, 100);
    expect(await committed()).toBe(100);
    // Another check takes the room the settle gave back.
    await reserve(randomUUID(), 1, 800, 1000);
    expect(await reserve(check, 1, 600, 1000)).toBe(false);
    expect(await committed()).toBe(900);
  });

  it('a retry that fits holds its full reservation again', async () => {
    const check = randomUUID();
    await reserve(check, 1, 600, 1000);
    await settle(check, 1, 100);
    expect(await reserve(check, 1, 600, 1000)).toBe(true);
    expect(await committed()).toBe(600);
    await settle(check, 1, 250);
    expect(await committed()).toBe(250);
  });
});

describe('settling', () => {
  it('gives back what was not used, and adds what ran over', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await reserve(a, 1, 600, 5000);
    await reserve(b, 1, 100, 5000);
    await settle(a, 1, 250);
    await settle(b, 1, 180);
    expect(await committed()).toBe(430);
  });

  it('counts a repeated settle once, and ignores one with no reservation', async () => {
    const check = randomUUID();
    await reserve(check, 1, 600, 5000);
    await settle(check, 1, 200);
    await settle(check, 1, 200);
    await settle(randomUUID(), 1, 999);
    expect(await committed()).toBe(200);
  });

  it('lands on the day it reserved, across midnight UTC', async () => {
    const check = randomUUID();
    await reserve(check, 1, 600, 5000);
    await db.exec(`
      update public.render_budget_days set day = day - 1;
      update public.render_reservations set day = day - 1;
      insert into public.render_budget_days (day, committed_ms)
        values ((now() at time zone 'utc')::date, 50);
    `);
    await settle(check, 1, 100);
    const { rows } = await db.query<{ day_offset: number; ms: string }>(`
      select ((now() at time zone 'utc')::date - day) as day_offset, committed_ms::text as ms
      from public.render_budget_days order by day
    `);
    expect(rows).toEqual([
      { day_offset: 1, ms: '100' },
      { day_offset: 0, ms: '50' },
    ]);
  });

  it('never takes a day below zero', async () => {
    const check = randomUUID();
    await reserve(check, 1, 600, 5000);
    await db.exec('update public.render_budget_days set committed_ms = 10');
    await settle(check, 1, 0);
    expect(await committed()).toBe(0);
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
        tx.query('select public.reserve_render_ms($1, 1, 1, 1)', [randomUUID()]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, role, null, (tx) =>
        tx.query('select public.settle_render_ms($1, 1, 1)', [randomUUID()]),
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
    expect(await reserve(randomUUID(), 1, 10, 100)).toBe(true);
  });
});
