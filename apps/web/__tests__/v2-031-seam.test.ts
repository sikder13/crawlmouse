import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEAT_ACTIONS, SEAT_GUARD, type SeatAction } from '../lib/v2/agency/guard';
import {
  addSeat,
  keptSite,
  makePaid,
  person,
  type Person,
} from '../lib/v2/account/sites-test-support';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';

/**
 * Migration 031's section S (docs/specs/v2/31-agency.md §3): `seat_may`, and the seat_sites policy.
 * One agency account with an owner, an unscoped account manager, a developer scoped to one of two
 * client sites, a removed seat and a stranger.
 */

const MIGRATION = '20261114000002_v2_031_agency.sql';
const ROLLBACK = '20261114000002_v2_031_agency.revert.sql';

type Role = 'owner' | 'account_manager' | 'developer';

/**
 * The roles table of the locked Seats artboard (Final-Ag-Seats.dc.html, "What each role can do"),
 * written out by hand: the answers SQL and `SEAT_GUARD` are compared with.
 */
const ARTBOARD: Record<SeatAction, Role[]> = {
  // "See audits and packets": an export is a copy of what the seat already reads.
  export_report: ['owner', 'account_manager', 'developer'],
  // "Edit and send client reports"
  share_report: ['owner', 'account_manager'],
  schedule_report: ['owner', 'account_manager'],
  // "Add or remove client sites"
  add_site: ['owner', 'account_manager'],
  edit_site: ['owner', 'account_manager'],
  remove_site: ['owner', 'account_manager'],
  // "Branding, seats, billing"
  invite_seat: ['owner'],
  change_seat: ['owner'],
  remove_seat: ['owner'],
  buy_seats: ['owner'],
  // No row of the artboard: the account's alerts follow Settings, the owner's and managers'.
  edit_account_alerts: ['owner', 'account_manager'],
};

let db: PGlite;
let owner: Person;
let manager: Person;
let developer: Person;
let removed: Person;
let stranger: Person;
let site1: string;
let site2: string;
let developerSeat: string;
let managerSeat: string;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  owner = await person(db, 'owner');
  await makePaid(db, owner.accountId, 'agency');
  site1 = (await keptSite(db, owner.accountId)).id;
  site2 = (await keptSite(db, owner.accountId)).id;
  manager = await person(db, 'manager');
  developer = await person(db, 'developer');
  removed = await person(db, 'removed');
  stranger = await person(db, 'stranger');
  managerSeat = await addSeat(db, owner.accountId, manager, 'account_manager');
  developerSeat = await addSeat(db, owner.accountId, developer, 'developer', [site1]);
  const gone = await addSeat(db, owner.accountId, removed, 'account_manager');
  await db.query(`update public.seats set status = 'removed', removed_at = now() where id = $1`, [
    gone,
  ]);
}, 120_000);
afterAll(async () => db.close());

const may = (userId: string, action: string, account = owner.accountId) =>
  asRole(db, 'authenticated', userId, async (tx) => {
    const { rows } = await tx.query<{ v: boolean }>(`select public.seat_may($1, $2) v`, [
      account,
      action,
    ]);
    return rows[0]!.v;
  });

describe('seat_may', () => {
  it('answers every role and action as the Seats artboard’s table does, and as SEAT_GUARD does', async () => {
    const people: Record<Role, Person> = { owner, account_manager: manager, developer };
    const sql: Record<string, Role[]> = {};
    for (const action of SEAT_ACTIONS) {
      sql[action] = [];
      for (const role of ['owner', 'account_manager', 'developer'] as const) {
        if (await may(people[role].id, action)) sql[action]!.push(role);
      }
    }
    expect(sql).toEqual(ARTBOARD);
    const table: Record<string, Role[]> = {};
    for (const action of SEAT_ACTIONS) {
      table[action] = (['owner', 'account_manager', 'developer'] as const).filter((role) =>
        SEAT_GUARD[role].includes(action),
      );
    }
    expect(table).toEqual(ARTBOARD);
  });

  it('refuses a removed seat and a stranger every action', async () => {
    for (const who of [removed, stranger]) {
      const allowed: string[] = [];
      for (const action of SEAT_ACTIONS) if (await may(who.id, action)) allowed.push(action);
      expect(allowed).toEqual([]);
    }
  });

  it('refuses the owner of another account', async () => {
    expect(await may(stranger.id, 'invite_seat', stranger.accountId)).toBe(true);
    expect(await may(stranger.id, 'invite_seat', owner.accountId)).toBe(false);
  });

  it('refuses every seat of an account marked for deletion, and answers again when the mark is cleared', async () => {
    await db.query(
      `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days' where id = $1`,
      [owner.accountId],
    );
    try {
      expect(await may(owner.id, 'invite_seat')).toBe(false);
      expect(await may(developer.id, 'export_report')).toBe(false);
    } finally {
      await db.query(
        `update public.accounts set deletion_confirmed_at = null, purge_after = null where id = $1`,
        [owner.accountId],
      );
    }
    expect(await may(owner.id, 'invite_seat')).toBe(true);
  });

  it('raises on an action it does not list, and on null', async () => {
    await expect(may(owner.id, 'invite_seats')).rejects.toThrow(/invite_seats is not an action/);
    await expect(
      asRole(db, 'authenticated', owner.id, (tx) =>
        tx.query(`select public.seat_may($1, null)`, [owner.accountId]),
      ),
    ).rejects.toThrow(/null is not an action/);
  });

  it('is executable by authenticated and service_role, and by neither anon nor public', async () => {
    const { rows } = await db.query<{ role: string; can: boolean }>(
      `select r.role, has_function_privilege(r.role, 'public.seat_may(uuid, text)', 'EXECUTE') can
         from (values ('anon'), ('authenticated'), ('service_role'), ('public')) r(role) order by 1`,
    );
    expect(rows).toEqual([
      { role: 'anon', can: false },
      { role: 'authenticated', can: true },
      { role: 'public', can: false },
      { role: 'service_role', can: true },
    ]);
  });

  it('runs as its caller with a pinned search_path', async () => {
    const { rows } = await db.query<{ definer: boolean; config: string[] }>(
      `select prosecdef definer, proconfig config from pg_proc where oid = 'public.seat_may(uuid, text)'::regprocedure`,
    );
    expect(rows).toEqual([{ definer: false, config: ['search_path=pg_catalog, pg_temp'] }]);
  });
});

describe('seat_sites', () => {
  const visible = (userId: string) =>
    asRole(db, 'authenticated', userId, async (tx) => {
      const { rows } = await tx.query<{ seat_id: string; site_id: string }>(
        `select seat_id, site_id from public.seat_sites where account_id = $1 order by 1, 2`,
        [owner.accountId],
      );
      return rows;
    });

  it('shows a scoped seat the rows of the sites it covers and no other', async () => {
    const other = await person(db, 'other-dev');
    const otherSeat = await addSeat(db, owner.accountId, other, 'developer', [site2]);
    const both = await person(db, 'both-dev');
    const bothSeat = await addSeat(db, owner.accountId, both, 'developer', [site1, site2]);
    const all = [
      { seat_id: developerSeat, site_id: site1 },
      { seat_id: otherSeat, site_id: site2 },
      { seat_id: bothSeat, site_id: site1 },
      { seat_id: bothSeat, site_id: site2 },
    ].sort((a, b) => (a.seat_id + a.site_id).localeCompare(b.seat_id + b.site_id));
    const key = (r: { seat_id: string; site_id: string }) => r.seat_id + r.site_id;
    const sorted = (rows: { seat_id: string; site_id: string }[]) =>
      [...rows].sort((a, b) => key(a).localeCompare(key(b)));

    expect(sorted(await visible(owner.id))).toEqual(all);
    expect(sorted(await visible(manager.id))).toEqual(all);
    expect(sorted(await visible(developer.id))).toEqual(all.filter((r) => r.site_id === site1));
    expect(sorted(await visible(other.id))).toEqual(all.filter((r) => r.site_id === site2));
    expect(await visible(removed.id)).toEqual([]);
    expect(await visible(stranger.id)).toEqual([]);
    expect(managerSeat).not.toBe(developerSeat);
  });
});

describe('seats', () => {
  const visible = (userId: string) =>
    asRole(db, 'authenticated', userId, async (tx) => {
      const { rows } = await tx.query<{ invited_email: string }>(
        `select invited_email from public.seats where account_id = $1 order by 1`,
        [owner.accountId],
      );
      return rows.map((r) => r.invited_email);
    });

  it('shows a seat scoped to some clients its own row and the owner’s; an unscoped seat reads them all', async () => {
    await db.query(
      `insert into public.seats (account_id, invited_email, role, status, client_scope_all)
       values ($1, 'pending@example.com', 'developer', 'invited', true)`,
      [owner.accountId],
    );
    const everyone = (
      await db.query<{ invited_email: string }>(
        `select invited_email from public.seats where account_id = $1 order by 1`,
        [owner.accountId],
      )
    ).rows.map((r) => r.invited_email);
    expect(everyone).toContain('pending@example.com');
    expect(everyone).toContain(manager.email);

    expect(await visible(owner.id)).toEqual(everyone);
    expect(await visible(manager.id)).toEqual(everyone);
    expect(await visible(developer.id)).toEqual([developer.email, owner.email].sort());
    expect(await visible(removed.id)).toEqual([]);
    expect(await visible(stranger.id)).toEqual([]);
  });

  it('member_covers_all is true for an unscoped active seat only, and not executable by anon', async () => {
    const covers = (userId: string) =>
      asRole(db, 'authenticated', userId, async (tx) => {
        const { rows } = await tx.query<{ v: boolean }>(`select public.member_covers_all($1) v`, [
          owner.accountId,
        ]);
        return rows[0]!.v;
      });
    expect({
      owner: await covers(owner.id),
      manager: await covers(manager.id),
      developer: await covers(developer.id),
      removed: await covers(removed.id),
      stranger: await covers(stranger.id),
    }).toEqual({ owner: true, manager: true, developer: false, removed: false, stranger: false });
    const { rows } = await db.query<{ anon: boolean; definer: boolean; config: string[] }>(
      `select has_function_privilege('anon', p.oid, 'EXECUTE') anon, p.prosecdef definer, p.proconfig config
         from pg_proc p where p.oid = 'public.member_covers_all(uuid)'::regprocedure`,
    );
    expect(rows).toEqual([
      { anon: false, definer: true, config: ['search_path=pg_catalog, pg_temp'] },
    ]);
  });
});

describe('the migration', () => {
  it('applies twice, reverts to the earlier seat_sites and seats policies without its functions, and applies again', async () => {
    const policies = async () =>
      Object.fromEntries(
        (
          await db.query<{ tablename: string; qual: string }>(
            `select tablename, qual from pg_policies
              where policyname in ('seat_sites_member_read', 'seats_member_read') order by 1`,
          )
        ).rows.map((r) => [r.tablename, r.qual]),
      );
    const functions = async () =>
      (
        await db.query<{ proname: string }>(
          `select proname from pg_proc where proname in ('seat_may', 'member_covers_all') order by 1`,
        )
      ).rows.map((r) => r.proname);
    const applied = async () => {
      const p = await policies();
      expect(p.seat_sites).toContain('is_member_for_site');
      expect(p.seats).toContain('member_covers_all');
      expect(await functions()).toEqual(['member_covers_all', 'seat_may']);
    };
    await db.exec(readMigration(MIGRATION));
    await applied();
    await db.exec(readRollback(ROLLBACK));
    expect(await policies()).toEqual({
      seat_sites: 'is_member(account_id)',
      seats: 'is_member(account_id)',
    });
    expect(await functions()).toEqual([]);
    await db.exec(readRollback(ROLLBACK));
    await db.exec(readMigration(MIGRATION));
    await applied();
  });
});
