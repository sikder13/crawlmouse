import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogSnapshot } from './helpers/catalog-snapshot';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { before, seedWorld, type World } from './helpers/v2-check-tables';

/**
 * Migration 20261112000001 section B (CC-26b D5): is_member_for_fix, mark_fix_done, and the grants of
 * both and of the redefined persist_built_check. What persist_built_check withholds is tested through
 * its one caller, on a check the engine built (lib/v2/pipeline/watermark.test.ts); the race between a
 * mark and a persist needs two backends and runs on a real Postgres (scripts/db/fixes-race.test.ts).
 * PGlite has one backend, so every case here runs its statements in turn.
 */

const MIGRATION = '20261112000001_v2_026b_sites_fixes.sql';
const ROLLBACK = '20261112000001_v2_026b_sites_fixes.revert.sql';

let db: PGlite;
let w: World;
let other: World;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  w = await seedWorld(db, 'fixes');
  other = await seedWorld(db, 'other');
}, 120_000);
afterAll(async () => {
  await db?.close();
});

const fixOf = (world: World, scope: 'site1' | 'site2') =>
  world.seeded.site_fixes.find((r) => r.scope === scope)!.pk.id as string;

async function markDone(fix: string, seat: string): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ r: Record<string, unknown> }>(
    `select public.mark_fix_done($1, $2) as r`,
    [fix, seat],
  );
  return rows[0]!.r;
}

async function fixState(fix: string) {
  const { rows } = await db.query<{ status: string; rank: number | null }>(
    `select status, rank from public.site_fixes where id = $1`,
    [fix],
  );
  return rows[0]!;
}

async function events(fix: string) {
  const { rows } = await db.query<{
    id: string;
    kind: string;
    by_seat_id: string | null;
    check_id: string | null;
    at: Date;
  }>(
    `select id, kind, by_seat_id, check_id, at from public.fix_events where fix_id = $1 order by at, id`,
    [fix],
  );
  return rows;
}

/** A fresh open fix on `site` of `world`, a copy of its seeded fix with another id and fingerprint. */
async function openFix(world: World, scope: 'site1' | 'site2', status = 'open'): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into public.site_fixes
       select (jsonb_populate_record(f, jsonb_build_object(
                 'id', $1::uuid, 'fingerprint', md5($1::text), 'number', 1000 + floor(random() * 1e6),
                 'status', $3::text,
                 'last_state', case when $3 = 'unable_to_verify' then 'indeterminate'
                                    when $3 = 'verified_resolved' then 'not_detected'
                                    else 'detected' end,
                 'rank', case when $3 = 'verified_resolved' then null else 1 end))).*
         from public.site_fixes f where f.id = $2`,
    [id, fixOf(world, scope), status],
  );
  return id;
}

describe('mark_fix_done', () => {
  it('sets marked_done and appends its marked_done event by the seat, in the same call', async () => {
    const fix = await openFix(w, 'site1');
    const before = await fixState(fix);
    const answer = await markDone(fix, w.ownerSeatId);
    expect(answer).toMatchObject({ outcome: 'marked' });
    expect(await fixState(fix)).toEqual({ status: 'marked_done', rank: before.rank });
    const ev = await events(fix);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      id: answer.event_id,
      kind: 'marked_done',
      by_seat_id: w.ownerSeatId,
      check_id: null,
    });
    expect(new Date(String(answer.at)).getTime()).toBe(ev[0]!.at.getTime());
  });

  it.each(['reopened', 'unable_to_verify'])('marks a %s fix', async (status) => {
    const fix = await openFix(w, 'site1', status);
    expect(await markDone(fix, w.scopedSeatId)).toMatchObject({ outcome: 'marked' });
    expect((await fixState(fix)).status).toBe('marked_done');
  });

  it('answers already for a fix marked done, and writes nothing', async () => {
    const fix = await openFix(w, 'site1');
    await markDone(fix, w.ownerSeatId);
    const ev = await events(fix);
    expect(await markDone(fix, w.ownerSeatId)).toEqual({ outcome: 'already' });
    expect(await events(fix)).toEqual(ev);
  });

  it('refuses a verified fix, and writes nothing', async () => {
    const fix = await openFix(w, 'site1', 'verified_resolved');
    expect(await markDone(fix, w.ownerSeatId)).toEqual({
      outcome: 'refused',
      status: 'verified_resolved',
    });
    expect(await fixState(fix)).toEqual({ status: 'verified_resolved', rank: null });
    expect(await events(fix)).toEqual([]);
  });

  it('answers not_found for no such fix', async () => {
    expect(await markDone(randomUUID(), w.ownerSeatId)).toEqual({ outcome: 'not_found' });
  });

  it('answers removed for a fix of a removed site, and writes nothing', async () => {
    const world = await seedWorld(db, 'removed');
    const fix = fixOf(world, 'site2');
    await db.query(`update public.sites set removed_at = now() where id = $1`, [world.site2]);
    expect(await markDone(fix, world.ownerSeatId)).toEqual({ outcome: 'removed' });
    expect((await fixState(fix)).status).toBe('open');
  });

  it('refuses a seat of another account, and a seat no longer active', async () => {
    const fix = await openFix(w, 'site1');
    await expect(markDone(fix, other.ownerSeatId)).rejects.toThrow(/not an active seat/);
    const world = await seedWorld(db, 'left');
    const theirs = await openFix(world, 'site1');
    await db.query(`update public.seats set status = 'removed', removed_at = now() where id = $1`, [
      world.scopedSeatId,
    ]);
    await expect(markDone(theirs, world.scopedSeatId)).rejects.toThrow(/not an active seat/);
    expect((await fixState(fix)).status).toBe('open');
    expect((await fixState(theirs)).status).toBe('open');
  });

  it('dates the mark after the fix’s latest event when that is not earlier than now', async () => {
    const fix = await openFix(w, 'site1');
    // A check's event dated ahead of the database's clock (the worker's clock runs ahead of it).
    const ahead = new Date(Date.now() + 3_600_000);
    const check = w.seeded.checks.find((r) => r.scope === 'site1')!.pk.id as string;
    await db.query(
      `insert into public.fix_events (id, fix_id, at, kind, check_id)
       values (gen_random_uuid(), $1, $2, 'reopened', $3)`,
      [fix, ahead.toISOString(), check],
    );
    await db.query(`update public.site_fixes set status = 'reopened' where id = $1`, [fix]);
    await markDone(fix, w.ownerSeatId);
    const ev = await events(fix);
    expect(ev.map((e) => e.kind)).toEqual(['reopened', 'marked_done']);
    expect(ev[1]!.at.getTime()).toBe(ahead.getTime() + 1);
  });
});

describe('is_member_for_fix', () => {
  const asks = (userId: string, fix: string) =>
    asRole(db, 'authenticated', userId, async (tx) => {
      const { rows } = await tx.query<{ m: boolean }>(`select public.is_member_for_fix($1) as m`, [
        fix,
      ]);
      return rows[0]!.m;
    });

  it('is true for a member whose scope covers the fix’s site, and false otherwise', async () => {
    expect(await asks(w.ownerId, fixOf(w, 'site1'))).toBe(true);
    expect(await asks(w.ownerId, fixOf(w, 'site2'))).toBe(true);
    expect(await asks(w.scopedUserId, fixOf(w, 'site1'))).toBe(true);
    // The developer seat is scoped to site1.
    expect(await asks(w.scopedUserId, fixOf(w, 'site2'))).toBe(false);
    expect(await asks(other.ownerId, fixOf(w, 'site1'))).toBe(false);
    expect(await asks(w.ownerId, randomUUID())).toBe(false);
  });
});

describe('grants', () => {
  const can = async (role: string, signature: string) => {
    const { rows } = await db.query<{ ok: boolean }>(
      `select has_function_privilege($1, $2, 'EXECUTE') as ok`,
      [role, signature],
    );
    return rows[0]!.ok;
  };
  it.each([
    ['public.is_member_for_fix(uuid)', ['authenticated', 'service_role']],
    ['public.mark_fix_done(uuid, uuid)', ['service_role']],
    ['public.persist_built_check(jsonb)', ['service_role']],
  ])('%s is executable by %j only', async (signature, roles) => {
    for (const role of ['anon', 'authenticated', 'service_role'])
      expect(await can(role, signature), role).toBe(roles.includes(role));
    const { rows } = await db.query<{ owner: string; definer: boolean; config: string[] }>(
      `select pg_get_userbyid(p.proowner) as owner, p.prosecdef as definer, p.proconfig as config
         from pg_proc p where p.oid = $1::regprocedure`,
      [signature],
    );
    expect(rows[0]).toEqual({
      owner: 'postgres',
      definer: true,
      config: ['search_path=pg_catalog, pg_temp'],
    });
  });
});

describe('fix_email_requests', () => {
  it('has row security on and no privilege for a client role; service_role reads and writes it', async () => {
    const { rows } = await db.query<{ rls: boolean }>(
      `select relrowsecurity as rls from pg_class where oid = 'public.fix_email_requests'::regclass`,
    );
    expect(rows[0]!.rls).toBe(true);
    for (const role of ['anon', 'authenticated'])
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const { rows: held } = await db.query<{ ok: boolean }>(
          `select has_table_privilege($1, 'public.fix_email_requests', $2) as ok`,
          [role, privilege],
        );
        expect(held[0]!.ok, `${role} ${privilege}`).toBe(false);
      }
    const { rows: svc } = await db.query<{ ok: boolean }>(
      `select has_table_privilege('service_role', 'public.fix_email_requests', 'SELECT, INSERT, UPDATE') as ok`,
    );
    expect(svc[0]!.ok).toBe(true);
  });

  it('goes with its account', async () => {
    const world = await seedWorld(db, 'email');
    const id = randomUUID();
    await db.query(
      `insert into public.fix_email_requests (id, fix_id, account_id, requested_by_seat_id, to_email)
       values ($1, $2, $3, $4, 'dev@agency.example')`,
      [id, fixOf(world, 'site1'), world.accountId, world.ownerSeatId],
    );
    await db.query(`delete from public.accounts where id = $1`, [world.accountId]);
    const { rows } = await db.query(`select 1 from public.fix_email_requests where id = $1`, [id]);
    expect(rows).toEqual([]);
  });
});

describe('the migration applies twice and reverts section B to migration 008', () => {
  const persistDef = async (d: PGlite) =>
    (
      await d.query<{ def: string; acl: string }>(
        `select pg_get_functiondef(p.oid) as def, p.proacl::text as acl
           from pg_proc p where p.oid = 'public.persist_built_check(jsonb)'::regprocedure`,
      )
    ).rows[0]!;
  const exists = async (d: PGlite, name: string) =>
    (
      await d.query<{ n: number }>(
        `select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
          where s.nspname = 'public' and p.proname = $1`,
        [name],
      )
    ).rows[0]!.n;

  it('re-applying it changes nothing in the catalog', async () => {
    const d = await freshDb();
    try {
      await applyAllMigrations(d);
      const once = await catalogSnapshot(d);
      await d.exec(readMigration(MIGRATION));
      expect(await catalogSnapshot(d)).toEqual(once);
    } finally {
      await d.close();
    }
  }, 120_000);

  it('the revert restores 008’s persist_built_check, body and grants, and drops the new functions', async () => {
    const d = await freshDb();
    try {
      await applyAllMigrations(d, undefined, before(MIGRATION));
      const pre = await persistDef(d);
      await d.exec(readMigration(MIGRATION));
      expect((await persistDef(d)).def).not.toBe(pre.def); // anti-vacuity
      expect(await exists(d, 'mark_fix_done')).toBe(1);
      for (let n = 0; n < 2; n++) {
        await d.exec(readRollback(ROLLBACK));
        expect(await persistDef(d)).toEqual(pre);
        expect(await exists(d, 'mark_fix_done')).toBe(0);
        expect(await exists(d, 'is_member_for_fix')).toBe(0);
        const { rows } = await d.query<{ t: string | null }>(
          `select to_regclass('public.fix_email_requests')::text as t`,
        );
        expect(rows[0]!.t).toBeNull();
      }
    } finally {
      await d.close();
    }
  }, 120_000);
});
