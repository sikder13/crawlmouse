import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, asRole, freshDb } from './helpers/pglite-migrations';
import {
  MIGRATION_003,
  before,
  insertRow,
  seedWorld,
  type NewTable,
  type Scope,
  type World,
} from './helpers/v2-check-tables';

/**
 * Who can read and write which rows of every public table migrations 003 and 006b create. The table
 * list is read from the catalog (what they add), never written out, so a table added later is covered without
 * anyone remembering to add it. What each table SHOULD expose is declared once, in READ_SCOPE, and the
 * first test fails when that declaration and the catalog disagree.
 *
 * Actors: the owner of account A, the owner of account B, and a developer seat on A scoped to A's
 * site1. Each account has two sites, with a row in every table for each site (and account-level rows
 * where a table has them).
 */

/**
 * - `site`: a member reads the rows of the sites their seat covers (is_member_for_site).
 * - `site_or_account`: as `site`, plus account-wide rows (site_id null) for any member.
 * - `account_managers`: owners and account managers of the account read every row; others none.
 * - `account`: every member of the account reads every row (is_member).
 * - `signed_in`: every signed-in user reads every row, whatever account (measurement_lineages names
 *   Crawlmouse's own builds, nothing of an account's).
 * - `none`: no client privilege at all.
 */
type ReadScope = 'site' | 'site_or_account' | 'account_managers' | 'account' | 'signed_in' | 'none';
const READ_SCOPE: Record<string, ReadScope> = {
  measurement_lineages: 'signed_in',
  crawl_batches: 'none',
  persist_chunks: 'none',
  sites: 'site',
  checks: 'site',
  page_results: 'site',
  link_edges: 'site',
  access_tests: 'site',
  site_fixes: 'none',
  fix_events: 'none',
  changes: 'site',
  evidence_blobs: 'site',
  alert_rules: 'site_or_account',
  alert_events: 'site',
  reports: 'site',
  report_schedules: 'site',
  share_links: 'none',
  api_keys: 'account_managers',
  deploy_hooks: 'site',
  seat_sites: 'account',
  check_ledger_links: 'none',
  // Members read counts through usage_counts() (v2-006b-data-foundations.test.ts), never a row.
  usage_events: 'none',
  // 027b: account settings, the deletion and its queue, the Slack destination. Service only.
  account_tokens: 'none',
  account_events: 'none',
  pending_erasures: 'none',
  deletion_cancellations: 'none',
  account_slack_destinations: 'none',
};

let db: PGlite;
let tables: NewTable[];
let A: World;
let B: World;
const pkCols: Record<string, string[]> = {};
/**
 * Tables whose rows belong to a site, read from the catalog: `sites` itself and every table whose
 * foreign keys reach it, directly or through another table (share_links through reports). A table that
 * reaches no site holds account rows.
 */
const perSite = new Set<string>();

beforeAll(async () => {
  const pre = await freshDb();
  await applyAllMigrations(pre, undefined, before(MIGRATION_003));
  const preTables = new Set(
    (
      await pre.query<{ n: string }>(
        `select tablename as n from pg_tables where schemaname = 'public'`,
      )
    ).rows.map((r) => r.n),
  );
  db = await freshDb();
  await applyAllMigrations(db);
  tables = (
    await db.query<{ n: string }>(
      `select tablename as n from pg_tables where schemaname = 'public' order by 1`,
    )
  ).rows
    .map((r) => r.n)
    .filter((t) => !preTables.has(t)) as NewTable[];
  for (const t of tables) {
    const { rows } = await db.query<{ col: string }>(
      `select a.attname as col from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
        where i.indrelid = ('public.' || $1)::regclass and i.indisprimary order by a.attnum`,
      [t],
    );
    pkCols[t] = rows.map((r) => r.col);
  }
  const { rows: reach } = await db.query<{ t: string }>(
    `with recursive fk(src, dst) as (
       select c.conrelid::regclass::text, c.confrelid::regclass::text from pg_constraint c
        where c.contype = 'f' and c.connamespace = 'public'::regnamespace
     ), reaches(t) as (
       select 'sites'
       union
       select fk.src from fk join reaches r on fk.dst = r.t
     )
     select t from reaches`,
  );
  for (const r of reach) perSite.add(r.t.replace(/^public\./, ''));
  A = await seedWorld(db, 'A');
  B = await seedWorld(db, 'B');
}, 240_000);

/** A date column (the partition key check_month) reads back as a Date; seeded keys hold YYYY-MM-DD. */
const keyOf = (row: Record<string, unknown>, cols: string[]) =>
  JSON.stringify(
    cols.map((c) =>
      row[c] instanceof Date ? (row[c] as Date).toISOString().slice(0, 10) : row[c],
    ),
  );

/** The seeded keys of `world` in `table` whose scope is in `scopes`. */
function seededKeys(world: World, table: NewTable, scopes: Scope[]): string[] {
  return world.seeded[table]
    .filter((r) => scopes.includes(r.scope))
    .map((r) => keyOf(r.pk, pkCols[table]!))
    .sort();
}

/** What `actor` should see of `owner`'s rows in `table`. */
function expected(
  table: NewTable,
  actor: 'owner' | 'scoped',
  sameAccount: boolean,
  owner: World,
): string[] {
  const scope = READ_SCOPE[table]!;
  const all: Scope[] = ['site1', 'site2', 'account'];
  if (scope === 'signed_in') return seededKeys(owner, table, all);
  if (!sameAccount) return [];
  switch (scope) {
    case 'none':
      return [];
    case 'account':
      return seededKeys(owner, table, all);
    case 'account_managers':
      return actor === 'owner' ? seededKeys(owner, table, all) : [];
    case 'site':
      return seededKeys(owner, table, actor === 'owner' ? all : ['site1']);
    case 'site_or_account':
      return seededKeys(owner, table, actor === 'owner' ? all : ['site1', 'account']);
  }
}

async function visibleKeys(userId: string, table: NewTable, world: World): Promise<string[]> {
  const cols = pkCols[table]!;
  const mine = new Set(seededKeys(world, table, ['site1', 'site2', 'account']));
  const rows = await asRole(
    db,
    'authenticated',
    userId,
    async (tx) =>
      (
        await tx.query<Record<string, unknown>>(
          `select ${cols.map((c) => `"${c}"`).join(', ')} from public.${table}`,
        )
      ).rows,
  );
  return rows
    .map((r) => keyOf(r, cols))
    .filter((k) => mine.has(k))
    .sort();
}

describe('the cross-account test covers what 003 creates', () => {
  it('READ_SCOPE names exactly the tables 003 creates', () => {
    expect(Object.keys(READ_SCOPE).sort()).toEqual(tables);
  });
  it('each account holds rows of both its sites in every site table, and account rows in the others', async () => {
    for (const t of tables) {
      // A table that reaches no site holds account rows, whatever its read scope.
      const siteScoped =
        perSite.has(t) && !['account', 'account_managers', 'signed_in'].includes(READ_SCOPE[t]!);
      for (const w of [A, B]) {
        const scopes = new Set(w.seeded[t].map((r) => r.scope));
        if (siteScoped) {
          expect(scopes.has('site1') && scopes.has('site2'), `${t}: rows of both sites`).toBe(true);
        } else {
          expect(scopes.has('account'), `${t}: an account row`).toBe(true);
        }
        // Every recorded key is a row the superuser can see in the table.
        const cols = pkCols[t]!;
        const present = new Set(
          (
            await db.query<Record<string, unknown>>(
              `select ${cols.map((c) => `"${c}"`).join(', ')} from public.${t}`,
            )
          ).rows.map((r) => keyOf(r, cols)),
        );
        for (const k of seededKeys(w, t, ['site1', 'site2', 'account']))
          expect(present.has(k), `${t}: seeded row ${k} is in the table`).toBe(true);
      }
    }
  });
});

describe('reads: every new table, every actor', () => {
  it.each(Object.keys(READ_SCOPE))('%s: anon is refused outright', async (table) => {
    await expect(
      asRole(db, 'anon', null, (tx) => tx.query(`select 1 from public.${table} limit 1`)),
    ).rejects.toThrow(/permission denied/);
  });

  it.each(Object.keys(READ_SCOPE))(
    '%s: a member of A reads A’s rows as planned and none of B’s',
    async (table) => {
      const t = table as NewTable;
      if (READ_SCOPE[t] === 'none') {
        await expect(
          asRole(db, 'authenticated', A.ownerId, (tx) =>
            tx.query(`select 1 from public.${t} limit 1`),
          ),
        ).rejects.toThrow(/permission denied/);
        return;
      }
      expect(await visibleKeys(A.ownerId, t, A)).toEqual(expected(t, 'owner', true, A));
      expect(await visibleKeys(A.ownerId, t, B)).toEqual(expected(t, 'owner', false, B));
      expect(await visibleKeys(B.ownerId, t, A)).toEqual(expected(t, 'owner', false, A));
    },
  );

  it.each(Object.keys(READ_SCOPE))(
    '%s: a seat on A scoped to site1 reads site1’s rows and none of site2’s or B’s',
    async (table) => {
      const t = table as NewTable;
      if (READ_SCOPE[t] === 'none') return; // refused outright, as above
      const seen = await visibleKeys(A.scopedUserId, t, A);
      expect(seen).toEqual(expected(t, 'scoped', true, A));
      if (READ_SCOPE[t] === 'site' || READ_SCOPE[t] === 'site_or_account')
        for (const k of seededKeys(A, t, ['site2'])) expect(seen).not.toContain(k);
      expect(await visibleKeys(A.scopedUserId, t, B)).toEqual(expected(t, 'scoped', false, B));
    },
  );

  it('the scoped seat loses site1 when its seat_sites row goes, and gains everything when unscoped', async () => {
    const W = await seedWorld(db, 'W');
    await db.query(`delete from public.seat_sites where seat_id = $1`, [W.scopedSeatId]);
    expect(await visibleKeys(W.scopedUserId, 'checks', W)).toEqual([]);
    await db.query(`update public.seats set client_scope_all = true where id = $1`, [
      W.scopedSeatId,
    ]);
    expect(await visibleKeys(W.scopedUserId, 'checks', W)).toEqual(
      seededKeys(W, 'checks', ['site1', 'site2']),
    );
  });

  it('a soft-deleted account’s sites are readable by none of its seats', async () => {
    const W = await seedWorld(db, 'D');
    await db.query(`update public.accounts set deleted_at = now() where id = $1`, [W.accountId]);
    for (const user of [W.ownerId, W.scopedUserId]) {
      expect(await visibleKeys(user, 'sites', W)).toEqual([]);
      expect(await visibleKeys(user, 'checks', W)).toEqual([]);
    }
  });

  it('a removed seat reads nothing, scoped or not', async () => {
    const W = await seedWorld(db, 'R');
    await db.query(`update public.seats set status = 'removed', removed_at = now() where id = $1`, [
      W.scopedSeatId,
    ]);
    expect(await visibleKeys(W.scopedUserId, 'sites', W)).toEqual([]);
  });

  it('a scoped seat on a staging site’s production site reads the staging site too', async () => {
    const W = await seedWorld(db, 'S');
    const staging = randomUUID();
    await db.query(
      `insert into public.sites (id, account_id, host, staging_of_site_id) values ($1, $2, $3, $4)`,
      [staging, W.accountId, `staging-${staging.slice(0, 8)}.example`, W.site1],
    );
    const seen = await asRole(
      db,
      'authenticated',
      W.scopedUserId,
      async (tx) =>
        (await tx.query<{ id: string }>(`select id from public.sites where id = $1`, [staging]))
          .rows,
    );
    expect(seen).toEqual([{ id: staging }]);
  });

  it('authenticated selecting site_fixes.packet is an error, not an empty result', async () => {
    await expect(
      asRole(db, 'authenticated', A.ownerId, (tx) =>
        tx.query(`select packet from public.site_fixes`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('anonymous sites are readable by no client, whatever the seat', async () => {
    const site = randomUUID();
    await db.query(
      `insert into public.sites (id, account_id, host) values ($1, null, 'anon.example')`,
      [site],
    );
    for (const user of [A.ownerId, A.scopedUserId, B.ownerId]) {
      const rows = await asRole(
        db,
        'authenticated',
        user,
        async (tx) => (await tx.query(`select id from public.sites where id = $1`, [site])).rows,
      );
      expect(rows).toEqual([]);
    }
  });
});

describe('writes: no client changes another account’s rows', () => {
  it.each(Object.keys(READ_SCOPE))(
    '%s: A’s owner cannot update or delete B’s rows',
    async (table) => {
      const t = table as NewTable;
      const cols = pkCols[t]!;
      const col = t === 'alert_rules' ? 'enabled' : cols[0]!;
      const bKeys = seededKeys(B, t, ['site1', 'site2', 'account']);
      for (const stmt of [
        `delete from public.${t}`,
        `update public.${t} set "${col}" = "${col}"`,
      ]) {
        // Run as A's owner, then count B's rows as the superuser in the same transaction, and roll
        // everything back so no test sees another's writes.
        const outcome = await db
          .transaction(async (tx) => {
            await tx.exec('savepoint attempt');
            await tx.exec('set local role authenticated');
            await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [A.ownerId]);
            let error: string | null = null;
            try {
              await tx.query(stmt);
            } catch (err) {
              error = String(err);
              await tx.exec('rollback to savepoint attempt');
            }
            await tx.exec('reset role');
            const left = (
              await tx.query<Record<string, unknown>>(
                `select ${cols.map((c) => `"${c}"`).join(', ')} from public.${t}`,
              )
            ).rows.map((r) => keyOf(r, cols));
            throw { error, left };
          })
          .catch((x: { error: string | null; left: string[] }) => x);
        // Only alert_rules grants a client write; every other table refuses the statement outright.
        if (t === 'alert_rules') expect(outcome.error, stmt).toBeNull();
        else expect(outcome.error, stmt).toMatch(/permission denied/);
        for (const k of bKeys) expect(outcome.left, `${stmt}: B row ${k}`).toContain(k);
      }
    },
  );

  it('A’s owner cannot write an alert rule into B, for B’s site or account-wide', async () => {
    for (const site of [B.site1, null]) {
      await expect(
        asRole(db, 'authenticated', A.ownerId, (tx) =>
          insertRow(tx, 'alert_rules', {
            account_id: B.accountId,
            site_id: site,
            kind: 'any_change',
            enabled: true,
            channels: ['email'],
          }),
        ),
      ).rejects.toThrow(/row-level security/);
    }
  });

  it('A’s owner cannot touch B’s alert rules: zero rows updated and deleted', async () => {
    const res = await asRole(db, 'authenticated', A.ownerId, async (tx) => ({
      upd: (
        await tx.query(`update public.alert_rules set enabled = false where account_id = $1`, [
          B.accountId,
        ])
      ).affectedRows,
      del: (await tx.query(`delete from public.alert_rules where account_id = $1`, [B.accountId]))
        .affectedRows,
    }));
    expect(res).toEqual({ upd: 0, del: 0 });
  });

  it('the scoped seat cannot change site2’s alert rule', async () => {
    const res = await asRole(db, 'authenticated', A.scopedUserId, async (tx) => ({
      upd: (
        await tx.query(`update public.alert_rules set enabled = false where site_id = $1`, [
          A.site2,
        ])
      ).affectedRows,
      del: (await tx.query(`delete from public.alert_rules where site_id = $1`, [A.site2]))
        .affectedRows,
    }));
    expect(res).toEqual({ upd: 0, del: 0 });
  });
});
