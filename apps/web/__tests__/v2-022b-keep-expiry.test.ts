/**
 * Migration 022b section D in PGlite with every migration applied: who may call its seven
 * functions, what kind they are, what `keep_check` and `move_check_paths` refuse, what
 * `checks.copied_for` holds after `note_check_copy` and `keep_check`, and that the migration and
 * its revert each run twice. Their use by the claim and the expiry is in
 * lib/v2/pipeline/keep.test.ts and expire.test.ts.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, readMigration, readRollback } from './helpers/pglite-migrations';
import { accountOf, anonymousCheck, doorDb, signUp } from './v2/_lib/door-pglite';

const MIGRATION = '20261111000001_v2_022b_public_checks.sql';
const REVERT = '20261111000001_v2_022b_public_checks.revert.sql';

const FUNCTIONS = [
  'note_check_copy(uuid, uuid)',
  'keep_check(uuid, uuid, uuid, text, integer, integer, jsonb)',
  'move_check_paths(uuid, uuid, jsonb)',
  'unkept_site_expired(uuid, timestamp with time zone, timestamp with time zone)',
  'expired_unkept_sites(timestamp with time zone, timestamp with time zone, uuid, integer)',
  'delete_expired_unkept_sites(uuid[], timestamp with time zone, timestamp with time zone)',
  'unsettled_kept_checks(timestamp with time zone, uuid, integer)',
] as const;

let db: PGlite;
let n = 0;
beforeAll(async () => {
  db = await doorDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

async function keeper() {
  const user = await signUp(db, `sql-${++n}@example.com`);
  const account = await accountOf(db, user);
  const { rows } = await db.query<{ id: string }>(
    `select id from public.seats where account_id = $1 and role = 'owner'`,
    [account.id],
  );
  return { accountId: account.id, seatId: rows[0]!.id };
}
const later = () => new Date(Date.now() + 60 * 60 * 1000);
const keep = (checkId: string, who: { accountId: string; seatId: string }, paths: unknown) =>
  asRole(db, 'service_role', null, async (tx) => {
    const { rows } = await tx.query<{ r: string }>(
      `select public.keep_check($1::uuid, $2::uuid, $3::uuid, 'monthly', 1, 9, $4::jsonb) as r`,
      [checkId, who.accountId, who.seatId, JSON.stringify(paths)],
    );
    return rows[0]!.r;
  });
const siteRow = async (siteId: string) =>
  (
    await db.query<Record<string, unknown>>(
      `select account_id, owner_seat_id, schedule_cadence, schedule_iso_weekday, schedule_hour_local
         from public.sites where id = $1`,
      [siteId],
    )
  ).rows[0]!;

describe('section D’s functions: kind, search_path and grants', () => {
  it('are the seven the migration’s header names, each SECURITY INVOKER with search_path pg_catalog, public, pg_temp', async () => {
    const { rows } = await db.query<{ signature: string; definer: boolean; config: string[] }>(
      `select format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) as signature,
              p.prosecdef as definer, p.proconfig as config
         from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.proname = any($1::text[])`,
      [FUNCTIONS.map((f) => f.slice(0, f.indexOf('(')))],
    );
    expect(rows).toHaveLength(FUNCTIONS.length);
    for (const row of rows) {
      expect(row.definer, row.signature).toBe(false);
      expect(row.config, row.signature).toEqual(['search_path=pg_catalog, public, pg_temp']);
    }
  });

  it.each(FUNCTIONS)(
    '%s: service_role may execute it; anon, authenticated and PUBLIC may not',
    async (f) => {
      const { rows } = await db.query<{
        service: boolean;
        anon: boolean;
        authed: boolean;
        pub: boolean;
      }>(
        `select has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') as service,
              has_function_privilege('anon', $1::regprocedure, 'EXECUTE') as anon,
              has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') as authed,
              exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                       where p.oid = $1::regprocedure and a.grantee = 0) as pub`,
        [`public.${f}`],
      );
      expect(rows[0]).toEqual({ service: true, anon: false, authed: false, pub: false });
    },
  );

  it('a signed-in member cannot keep a check by calling keep_check', async () => {
    const who = await keeper();
    const { checkId, siteId } = await anonymousCheck(db, `direct-${++n}.example`, later());
    const user = await signUp(db, `direct-${n}@example.com`);
    await expect(
      asRole(db, 'authenticated', user, (tx) =>
        tx.query(
          `select public.keep_check($1::uuid, $2::uuid, $3::uuid, null, null, null, '[]'::jsonb)`,
          [checkId, who.accountId, who.seatId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect((await siteRow(siteId)).account_id).toBeNull();
  });
});

describe('keep_check', () => {
  it('writes what the claim’s takeSite wrote: account, owner seat, the three schedule columns, updated_at; and clears the expiry', async () => {
    const who = await keeper();
    const { checkId, siteId } = await anonymousCheck(db, `take-${++n}.example`, later());
    await db.query(`update public.sites set updated_at = now() - interval '1 day' where id = $1`, [
      siteId,
    ]);
    expect(await keep(checkId, who, [])).toBe('taken');
    expect(await siteRow(siteId)).toEqual({
      account_id: who.accountId,
      owner_seat_id: who.seatId,
      schedule_cadence: 'monthly',
      schedule_iso_weekday: 1,
      schedule_hour_local: 9,
    });
    const { rows } = await db.query<{ fresh: boolean; expires_at: Date | null }>(
      `select s.updated_at > now() - interval '1 minute' as fresh, c.expires_at
         from public.sites s join public.checks c on c.site_id = s.id where c.id = $1`,
      [checkId],
    );
    expect(rows[0]).toEqual({ fresh: true, expires_at: null });
  });

  it('answers not_unowned for an unknown check and for a site that has an account, writing nothing', async () => {
    const who = await keeper();
    const other = await keeper();
    expect(await keep('00000000-0000-4000-8000-000000000000', who, [])).toBe('not_unowned');
    const { checkId, siteId } = await anonymousCheck(db, `owned-${++n}.example`, later());
    expect(await keep(checkId, who, [])).toBe('taken');
    expect(await keep(checkId, other, [])).toBe('not_unowned');
    expect((await siteRow(siteId)).account_id).toBe(who.accountId);
  });

  it('answers expired at the instant of expires_at and after, writing nothing; a check with no expiry is taken', async () => {
    const who = await keeper();
    const past = await anonymousCheck(db, `past-${++n}.example`, new Date(Date.now() - 1));
    expect(await keep(past.checkId, who, [])).toBe('expired');
    expect((await siteRow(past.siteId)).account_id).toBeNull();
    const never = await anonymousCheck(db, `never-${++n}.example`, null);
    expect(await keep(never.checkId, who, [])).toBe('taken');
  });

  it('answers host_kept when the account keeps that host, leaving the site unowned and its check expiring', async () => {
    const who = await keeper();
    const host = `same-${++n}.example`;
    const first = await anonymousCheck(db, host, later());
    const second = await anonymousCheck(db, host, later());
    expect(await keep(first.checkId, who, [])).toBe('taken');
    expect(await keep(second.checkId, who, [])).toBe('host_kept');
    expect((await siteRow(second.siteId)).account_id).toBeNull();
    const { rows } = await db.query<{ expires_at: Date | null }>(
      `select expires_at from public.checks where id = $1`,
      [second.checkId],
    );
    expect(rows[0]!.expires_at).not.toBeNull();
  });

  it('rewrites the paths a pair names and leaves a path no pair names; a bad pair rolls the whole claim back', async () => {
    const who = await keeper();
    const { checkId, siteId } = await anonymousCheck(db, `paths-${++n}.example`, later());
    const anon = `anon/${siteId}/${checkId}`;
    const mine = `${who.accountId}/${siteId}/${checkId}`;
    for (const batch of [0, 1]) {
      await db.query(
        `insert into public.crawl_batches (check_id, batch, kind, nonce, status, posted_at, finished_at, result_path)
         values ($1, $2, 'crawl', 'nonce-nonce-nonce-0000', 'done', now(), now(), $3)`,
        [checkId, batch, `${anon}/batch-${batch}.json.gz`],
      );
    }
    await db.query(`update public.checks set map_path = $2 where id = $1`, [
      checkId,
      `${anon}/map.json.gz`,
    ]);
    const stored = async () =>
      (
        await db.query<{ p: string }>(
          `select result_path as p from public.crawl_batches where check_id = $1
           union all select map_path from public.checks where id = $1 order by 1`,
          [checkId],
        )
      ).rows.map((r) => r.p);

    const stranger = await keeper();
    const outside = [
      // Only the account differs: the same name, in another account's directory of this check.
      [
        {
          old_path: `${anon}/batch-0.json.gz`,
          new_path: `${stranger.accountId}/${siteId}/${checkId}/batch-0.json.gz`,
        },
      ],
      // Only the source differs: the same name, read from another site's directory.
      [
        {
          old_path: `anon/${who.accountId}/${checkId}/batch-0.json.gz`,
          new_path: `${mine}/batch-0.json.gz`,
        },
      ],
      [
        {
          old_path: `${anon}/batch-0.json.gz`,
          new_path: `other/${siteId}/${checkId}/batch-0.json.gz`,
        },
      ],
      [{ old_path: `${anon}/batch-0.json.gz`, new_path: `${mine}/batch-1.json.gz` }],
      [{ old_path: `anon/${siteId}/another/batch-0.json.gz`, new_path: `${mine}/batch-0.json.gz` }],
      [{ old_path: `${anon}/`, new_path: `${mine}/` }],
      [{ old_path: `${anon}/batch-0.json.gz` }],
      { old_path: `${anon}/batch-0.json.gz`, new_path: `${mine}/batch-0.json.gz` },
    ];
    for (const paths of outside) {
      await expect(keep(checkId, who, paths), JSON.stringify(paths)).rejects.toMatchObject({
        code: '22023',
      });
      expect((await siteRow(siteId)).account_id, JSON.stringify(paths)).toBeNull();
    }

    expect(
      await keep(checkId, who, [
        { old_path: `${anon}/batch-0.json.gz`, new_path: `${mine}/batch-0.json.gz` },
        { old_path: `${anon}/map.json.gz`, new_path: `${mine}/map.json.gz` },
        { old_path: `${anon}/seeds.json.gz`, new_path: `${mine}/seeds.json.gz` },
      ]),
    ).toBe('taken');
    expect(await stored()).toEqual(
      [`${mine}/batch-0.json.gz`, `${anon}/batch-1.json.gz`, `${mine}/map.json.gz`].sort(),
    );
  });
});

describe('checks.copied_for', () => {
  const note = (checkId: string, accountId: string | null) =>
    asRole(db, 'service_role', null, async (tx) => {
      const { rows } = await tx.query<{ r: boolean }>(
        `select public.note_check_copy($1::uuid, $2::uuid) as r`,
        [checkId, accountId],
      );
      return rows[0]!.r;
    });
  const copiedFor = async (checkId: string) =>
    (
      await db.query<{ copied_for: string[] }>(
        `select copied_for from public.checks where id = $1`,
        [checkId],
      )
    ).rows[0]!.copied_for;

  it('is empty on a new check; note_check_copy adds an account once, in the order noted, and answers false for no such check', async () => {
    const a = await keeper();
    const b = await keeper();
    const { checkId } = await anonymousCheck(db, `noted-${++n}.example`, later());
    const other = await anonymousCheck(db, `noted-${++n}.example`, later());
    expect(await copiedFor(checkId)).toEqual([]);
    expect(await note(checkId, a.accountId)).toBe(true);
    expect(await note(checkId, b.accountId)).toBe(true);
    expect(await note(checkId, a.accountId)).toBe(true);
    expect(await copiedFor(checkId)).toEqual([a.accountId, b.accountId]);
    expect(await copiedFor(other.checkId)).toEqual([]);
    expect(await note('00000000-0000-4000-8000-000000000000', a.accountId)).toBe(false);
    await expect(note(checkId, null)).rejects.toMatchObject({ code: '22004' });
    expect(await copiedFor(checkId)).toEqual([a.accountId, b.accountId]);
  });

  it('keep_check takes the keeping account out and leaves the others; a refused keep leaves the list as it was', async () => {
    const winner = await keeper();
    const loser = await keeper();
    const { checkId } = await anonymousCheck(db, `strays-${++n}.example`, later());
    await note(checkId, loser.accountId);
    await note(checkId, winner.accountId);
    expect(await keep(checkId, winner, [])).toBe('taken');
    expect(await copiedFor(checkId)).toEqual([loser.accountId]);
    expect(await keep(checkId, loser, [])).toBe('not_unowned');
    expect(await copiedFor(checkId)).toEqual([loser.accountId]);

    const past = await anonymousCheck(db, `strays-${++n}.example`, new Date(Date.now() - 1));
    await note(past.checkId, loser.accountId);
    expect(await keep(past.checkId, loser, [])).toBe('expired');
    expect(await copiedFor(past.checkId)).toEqual([loser.accountId]);
  });

  it('no client role reads or writes it', async () => {
    const { rows } = await db.query<{ role: string; granted: boolean }>(
      `select r.role, has_column_privilege(r.role, 'public.checks', 'copied_for', p.priv) as granted
         from unnest(array['anon', 'authenticated']) as r(role),
              unnest(array['SELECT', 'INSERT', 'UPDATE']) as p(priv)`,
    );
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.granted)).toEqual([]);
  });
});

describe('the migration and its revert', () => {
  const NAMES = FUNCTIONS.map((f) => f.slice(0, f.indexOf('(')));
  const sectionD = async (own: PGlite) => {
    const functions = await own.query<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.proname = any($1::text[]) order by 1`,
      [NAMES],
    );
    const columns = await own.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'checks'
          and column_name in ('notify_email', 'copied_for') order by 1`,
    );
    const index = await own.query(
      `select 1 from pg_indexes where schemaname = 'public' and indexname = 'sites_unkept_idx'`,
    );
    return {
      functions: functions.rows.map((r) => r.name),
      columns: columns.rows.map((r) => r.column_name),
      index: index.rows.length,
    };
  };

  it('applies twice and reverts twice, and applies again after the revert', async () => {
    const own = await doorDb();
    try {
      const applied = {
        functions: [...NAMES].sort(),
        columns: ['copied_for', 'notify_email'],
        index: 1,
      };
      expect(await sectionD(own)).toEqual(applied);
      const { checkId } = await anonymousCheck(own, 'rerun.example', later());
      await own.query(`select public.note_check_copy($1::uuid, gen_random_uuid())`, [checkId]);
      await own.exec(readMigration(MIGRATION));
      expect(await sectionD(own)).toEqual(applied);
      // A second run keeps what the column held.
      expect(
        await own.query(`select 1 from public.checks where cardinality(copied_for) = 1`),
      ).toMatchObject({ rows: [{}] });

      await own.exec(readRollback(REVERT));
      expect(await sectionD(own)).toEqual({ functions: [], columns: [], index: 0 });
      await own.exec(readRollback(REVERT));
      expect(await sectionD(own)).toEqual({ functions: [], columns: [], index: 0 });

      await own.exec(readMigration(MIGRATION));
      expect(await sectionD(own)).toEqual(applied);
    } finally {
      await own.close();
    }
  }, 120_000);
});

describe('move_check_paths', () => {
  it('refuses an account that does not keep the check’s site, and rewrites for the one that does', async () => {
    const who = await keeper();
    const other = await keeper();
    const { checkId, siteId } = await anonymousCheck(db, `move-${++n}.example`, later());
    const pair = (accountId: string) => [
      {
        old_path: `anon/${siteId}/${checkId}/map.json.gz`,
        new_path: `${accountId}/${siteId}/${checkId}/map.json.gz`,
      },
    ];
    await db.query(`update public.checks set map_path = $2 where id = $1`, [
      checkId,
      pair(who.accountId)[0]!.old_path,
    ]);
    const move = (accountId: string) =>
      asRole(db, 'service_role', null, async (tx) => {
        const { rows } = await tx.query<{ moved: number }>(
          `select public.move_check_paths($1::uuid, $2::uuid, $3::jsonb) as moved`,
          [checkId, accountId, JSON.stringify(pair(accountId))],
        );
        return rows[0]!.moved;
      });
    // Nobody keeps the site yet.
    await expect(move(who.accountId)).rejects.toMatchObject({ code: 'P0002' });
    expect(await keep(checkId, who, [])).toBe('taken');
    await expect(move(other.accountId)).rejects.toMatchObject({ code: 'P0002' });
    expect(await move(who.accountId)).toBe(1);
    expect(await move(who.accountId)).toBe(0);
  });
});
