import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect } from 'vitest';
import {
  asRole,
  readMigration,
  readRollback,
} from '../../apps/web/__tests__/helpers/pglite-migrations';
import { rateLimitWindowStart } from '../../apps/web/lib/rate-limit-window';
import { reset } from './reset';
import { exitCode, seed } from './seed';
import { qaResetStore } from './store';
import {
  HAS_INTERNAL_MARKER,
  migratedBase,
  PGLITE_TIMEOUT,
  withMarker,
  world,
  type World,
} from './test-support';

/**
 * CC-38 D2 on PGlite with every migration: `qa_reset`'s refusals (all inside the SQL function), what
 * it leaves alone, and qa:reset's restore of the starting set.
 *   pnpm --filter @crawlmouse/scripts exec vitest run qa/reset.pglite.test.ts
 */

let base: PGlite;
beforeAll(async () => {
  if (HAS_INTERNAL_MARKER) base = await migratedBase();
}, 300_000);

const MIGRATION = '20261117000002_v2_038_qa.sql';
const ROLLBACK = '20261117000002_v2_038_qa.revert.sql';

/** The seeded set with `qa+agency` given its plan's limits, as the webhook leaves them, and seeded again. */
async function seeded(): Promise<World & { resetDeps: Parameters<typeof reset>[0] }> {
  const w = await world(base);
  await seed(w.deps);
  await w.db.query(
    `update public.accounts a set site_limit = 6, seat_limit = 2 from public.qa_accounts q
      where q.account_id = a.id and q.qa_key = 'agency' and a.kind = 'agency'`,
  );
  const steps = await seed(w.deps);
  expect(exitCode(steps)).toBe(0);
  return { ...w, resetDeps: { ...w.deps, reset: qaResetStore(w.sb) } };
}

/** A person who signed up on their own, with one site: a customer. */
async function customer(w: World, email: string, host: string): Promise<string> {
  const userId = await w.signUp(email);
  const seat = (await w.deps.store.personal(userId))!;
  expect(await w.deps.store.addSite(seat, host, userId)).toEqual({ outcome: 'created' });
  return seat.accountId;
}

/** The account's rows the reset could reach, as text. */
async function rowsOf(db: PGlite, accountId: string): Promise<string> {
  const r = await db.query<{ t: string }>(
    `select pg_catalog.json_build_object(
       'account', (select row_to_json(a) from public.accounts a where a.id = $1),
       'sites', (select json_agg(s order by s.id) from public.sites s where s.account_id = $1),
       'seats', (select json_agg(s order by s.id) from public.seats s where s.account_id = $1),
       'checks', (select json_agg(c order by c.id) from public.checks c
                   join public.sites s on s.id = c.site_id where s.account_id = $1)
     )::text t`,
    [accountId],
  );
  return r.rows[0]!.t;
}

/**
 * The set as a customer sees it, without ids: each account's live sites, with each site's checks
 * (trigger and status) and schedule, and its seats.
 */
async function shape(db: PGlite): Promise<unknown> {
  const r = await db.query(
    `select q.qa_key, a.kind,
            (select json_agg(json_build_object(
                       'host', s.host,
                       'checks', (select json_agg(c.trigger || ':' || c.status order by c.trigger, c.status)
                                    from public.checks c where c.site_id = s.id),
                       'schedule', json_build_array(s.schedule_cadence, s.schedule_iso_weekday,
                                                    s.schedule_hour_local))
                     order by s.host)
               from public.sites s
              where s.account_id = a.id and s.removed_at is null) sites,
            (select json_agg(json_build_object(
                       'email', u.email, 'role', st.role, 'status', st.status,
                       'scope', (select json_agg(si.host order by si.host)
                                   from public.seat_sites ss join public.sites si on si.id = ss.site_id
                                  where ss.seat_id = st.id))
                     order by u.email)
               from public.seats st join public.users u on u.id = st.user_id
              where st.account_id = a.id) seats
       from public.qa_accounts q join public.accounts a on a.id = q.account_id
      order by q.qa_key, a.kind`,
  );
  return r.rows;
}

async function qaResetError(db: PGlite, accountId: string): Promise<string | undefined> {
  try {
    await asRole(db, 'service_role', null, (tx) =>
      tx.query('select public.qa_reset($1)', [accountId]),
    );
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

describe('qa_reset: refusals, inside the function', () => {
  withMarker(
    'refuses a customer account: no qa_accounts row, internal false',
    async () => {
      const w = await world(base);
      const theirs = await customer(w, 'someone@example.test', 'someone.example.test');
      const before = await rowsOf(w.db, theirs);
      expect(await qaResetError(w.db, theirs)).toBe('42501');
      expect(await rowsOf(w.db, theirs)).toBe(before);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    'refuses an internal account that has no qa_accounts row',
    async () => {
      const w = await world(base);
      const ours = await customer(w, 'staff@example.test', 'staff.example.test');
      await w.db.query('update public.accounts set internal = true where id = $1', [ours]);
      const before = await rowsOf(w.db, ours);
      expect(await qaResetError(w.db, ours)).toBe('42501');
      expect(await rowsOf(w.db, ours)).toBe(before);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    'refuses a qa_accounts row whose account is not internal',
    async () => {
      const w = await world(base);
      const theirs = await customer(w, 'other@example.test', 'other.example.test');
      await w.db.query(`insert into public.qa_accounts (account_id, qa_key) values ($1, 'free')`, [
        theirs,
      ]);
      const before = await rowsOf(w.db, theirs);
      expect(await qaResetError(w.db, theirs)).toBe('42501');
      expect(await rowsOf(w.db, theirs)).toBe(before);

      // Through qa:reset: that row is reported refused and its account untouched; and, qa:seed never
      // having run here, the restore half makes no user of its own.
      const users = await w.db.query('select id from auth.users order by id');
      const steps = await reset({ ...w.deps, reset: qaResetStore(w.sb) });
      expect((await w.db.query('select id from auth.users order by id')).rows).toEqual(users.rows);
      expect(steps).toContainEqual(
        expect.objectContaining({ key: 'free', step: 'reset', outcome: 'refused' }),
      );
      expect(await rowsOf(w.db, theirs)).toBe(before);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    'anon and authenticated can neither run qa_reset nor read qa_accounts',
    async () => {
      const w = await world(base);
      const userId = await w.signUp('reader@example.test');
      const accountId = (await w.deps.store.personal(userId))!.accountId;
      for (const role of ['anon', 'authenticated'] as const) {
        const sub = role === 'anon' ? null : userId;
        await expect(
          asRole(w.db, role, sub, (tx) => tx.query('select public.qa_reset($1)', [accountId])),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          asRole(w.db, role, sub, (tx) => tx.query('select * from public.qa_accounts')),
        ).rejects.toMatchObject({ code: '42501' });
      }
      const g = await w.db.query<{ who: string; exec: boolean; sel: boolean }>(
        `select r who, has_function_privilege(r, 'public.qa_reset(uuid)', 'execute') exec,
              has_table_privilege(r, 'public.qa_accounts', 'select') sel
         from unnest(array['anon', 'authenticated', 'service_role']) r order by r`,
      );
      expect(g.rows).toEqual([
        { who: 'anon', exec: false, sel: false },
        { who: 'authenticated', exec: false, sel: false },
        { who: 'service_role', exec: true, sel: true },
      ]);
      // The service role's grant is exactly the seed's two calls: it cannot rewrite or drop a marker.
      const w2 = await w.db.query<{ priv: string; has: boolean }>(
        `select p priv, has_table_privilege('service_role', 'public.qa_accounts', p) has
         from unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p order by p`,
      );
      expect(w2.rows).toEqual([
        { priv: 'delete', has: false },
        { priv: 'insert', has: true },
        { priv: 'select', has: true },
        { priv: 'truncate', has: false },
        { priv: 'update', has: false },
      ]);
    },
    PGLITE_TIMEOUT,
  );
});

describe('qa_reset: a deleted account', () => {
  withMarker(
    'refuses a marked, internal account whose deleted_at is set, and changes none of its rows',
    async () => {
      const w = await seeded();
      const free = (
        await w.db.query<{ id: string }>(
          `select account_id id from public.qa_accounts where qa_key = 'free'`,
        )
      ).rows[0]!.id;
      await w.db.query('update public.accounts set deleted_at = now() where id = $1', [free]);
      const before = await rowsOf(w.db, free);
      expect(JSON.parse(before).sites).toHaveLength(1);
      expect(await qaResetError(w.db, free)).toBe('42501');
      expect(await rowsOf(w.db, free)).toBe(before);
    },
    PGLITE_TIMEOUT,
  );
});

describe('qa:reset', () => {
  withMarker(
    'while crawls are paused it resets nothing, so the set is not left empty',
    async () => {
      const w = await seeded();
      const before = await shape(w.db);
      w.pause(true);
      const steps = await reset(w.resetDeps);
      expect(steps).toEqual([
        {
          key: 'run',
          step: 'reset',
          outcome: 'refused',
          detail: 'crawls are paused (CRAWL_PAUSED); nothing was reset',
        },
      ]);
      expect(await shape(w.db)).toEqual(before);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    'a capped first client in a reset asks for no first audit of a site it did not add',
    async () => {
      const w = await seeded();
      const windowStart = rateLimitWindowStart(Date.now(), 60 * 60 * 1000).toISOString();
      for (let i = 0; i < 5; i++) {
        await w.db.query(`select public.increment_rate_limit($1, $2::timestamptz)`, [
          'domain:client-1.lab.nahltech.com',
          windowStart,
        ]);
      }
      const steps = await reset(w.resetDeps);
      const agency = steps.filter((s) => s.key === 'agency');
      expect(agency.find((s) => s.step === 'site')?.outcome).toBe('refused');
      expect(agency.filter((s) => s.step === 'first audit')).toEqual([]);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    'three resets in a row refuse nothing, and each leaves a fresh seed’s set',
    async () => {
      const w = await seeded();
      const fresh = await shape(w.db);
      for (let i = 0; i < 3; i++) {
        const steps = await reset(w.resetDeps);
        expect(steps.filter((s) => s.outcome === 'refused')).toEqual([]);
        expect(await shape(w.db)).toEqual(fresh);
      }
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    'a used set, with a fix marked done, a report and its share link, goes back to a fresh seed’s set',
    async () => {
      const w = await seeded();
      const fresh = await shape(w.db);
      // qa+agency's first client: a fix its first check found, marked done, a client report covering
      // the check and a share link to the report. (The check stays queued: the rows the reset must
      // take are the fix, its event, the report and the link, and no constraint ties them to a
      // finished check.)
      const site = (
        await w.db.query<{
          id: string;
          account_id: string;
          owner_seat_id: string;
          check_id: string;
        }>(
          `select s.id, s.account_id, s.owner_seat_id, c.id check_id from public.sites s
             join public.accounts a on a.id = s.account_id
             join public.qa_accounts q on q.account_id = a.id
             join public.checks c on c.site_id = s.id
            where q.qa_key = 'agency' and a.kind = 'agency' and s.host = 'client-1.lab.nahltech.com'`,
        )
      ).rows[0]!;
      const fix = await w.db.query<{ id: string }>(
        `insert into public.site_fixes (site_id, fingerprint, number, type, section, title,
            recommendation_class, status, last_state, last_measured_check_id, first_seen_check_id,
            confidence, affected_pages, rank, effect)
         values ($1, 'fp-qa-1', 1, 'orphan_pages', 'structure', 'Orphan pages', 'best_practice',
                 'marked_done', 'detected', $2, $2, 'confirmed', 3, 1, '{"ai_readability": 1, "technical_seo": 1}'::jsonb)
         returning id`,
        [site.id, site.check_id],
      );
      await w.db.query(
        `insert into public.fix_events (fix_id, at, kind, by_seat_id) values ($1, now(), 'marked_done', $2)`,
        [fix.rows[0]!.id, site.owner_seat_id],
      );
      const report = await w.db.query<{ id: string }>(
        `insert into public.reports (account_id, site_id, kind, format, status, made_by, covers_check_ids,
            owner_seat_id)
         values ($1, $2, 'client_report', 'html', 'ready', 'user', array[$3::uuid], $4) returning id`,
        [site.account_id, site.id, site.check_id, site.owner_seat_id],
      );
      await w.db.query(
        `insert into public.share_links (token_hash, report_id, expires_at)
         values ($1, $2, now() + interval '7 days')`,
        ['ab'.repeat(32), report.rows[0]!.id],
      );

      const steps = await reset(w.resetDeps);
      expect(exitCode(steps)).toBe(0);
      expect(await shape(w.db)).toEqual(fresh);
      const left = await w.db.query<{ n: number }>(
        `select (select count(*)::int from public.site_fixes where id = $1)
              + (select count(*)::int from public.fix_events where fix_id = $1)
              + (select count(*)::int from public.reports where id = $2)
              + (select count(*)::int from public.share_links where report_id = $2) n`,
        [fix.rows[0]!.id, report.rows[0]!.id],
      );
      expect(left.rows).toEqual([{ n: 0 }]);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    'returns the set to a fresh seed’s sites and seats, through a real delete',
    async () => {
      const w = await seeded();
      const fresh = await shape(w.db);
      const oldSites = (await w.db.query<{ id: string }>('select id from public.sites')).rows;
      const devSeat = await w.db.query(
        `select st.id from public.seats st join public.users u on u.id = st.user_id
          where u.email = 'qa+agency-dev@example.test' and st.role = 'developer'`,
      );
      expect(devSeat.rows).toHaveLength(1);

      const steps = await reset(w.resetDeps);
      expect(exitCode(steps)).toBe(0);
      expect(await shape(w.db)).toEqual(fresh);
      // A no-op would pass the comparison above: every old site and check, and the old seat, are gone.
      const ids = oldSites.map((r) => r.id);
      const left = await w.db.query<{ n: number }>(
        `select (select count(*)::int from public.sites where id = any($1::uuid[]))
              + (select count(*)::int from public.checks where site_id = any($1::uuid[]))
              + (select count(*)::int from public.seats where id = $2) n`,
        [ids, (devSeat.rows[0] as { id: string }).id],
      );
      expect(left.rows).toEqual([{ n: 0 }]);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    'leaves the accounts rows byte for byte, and another account entirely',
    async () => {
      const w = await seeded();
      const theirs = await customer(w, 'bystander@example.test', 'bystander.example.test');
      const accountsBefore = await w.db.query(
        'select id, row_to_json(a)::text t from public.accounts a order by id',
      );
      const theirsBefore = await rowsOf(w.db, theirs);
      await reset(w.resetDeps);
      expect(
        (await w.db.query('select id, row_to_json(a)::text t from public.accounts a order by id'))
          .rows,
      ).toEqual(accountsBefore.rows);
      expect(await rowsOf(w.db, theirs)).toBe(theirsBefore);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    'an account no longer internal is refused by both halves: not reset, not re-marked, not re-seeded',
    async () => {
      const w = await seeded();
      const pro = (
        await w.db.query<{ id: string }>(
          `select a.id from public.accounts a join public.qa_accounts q on q.account_id = a.id
            where q.qa_key = 'pro'`,
        )
      ).rows[0]!.id;
      await w.db.query('update public.accounts set internal = false where id = $1', [pro]);
      const before = await rowsOf(w.db, pro);
      const steps = await reset(w.resetDeps);
      const ofPro = steps.filter((s) => s.key === 'pro').map((s) => [s.step, s.outcome]);
      expect(ofPro).toContainEqual(['reset', 'refused']);
      expect(ofPro).toContainEqual(['stopped', 'refused']);
      expect(ofPro.filter(([, o]) => o === 'done')).toEqual([]);
      expect(await rowsOf(w.db, pro)).toBe(before);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    'makes no agency account when the one it looks for is not found',
    async () => {
      const w = await seeded();
      // The demo user's agency account no longer goes by the set's name, so the restore cannot find it.
      await w.db.query(
        `update public.accounts a set name = 'Renamed' from public.qa_accounts q
        where q.account_id = a.id and q.qa_key = 'demo' and a.kind = 'agency'`,
      );
      const accounts = await w.db.query('select id from public.accounts order by id');
      const steps = await reset(w.resetDeps);
      expect(steps).toContainEqual(
        expect.objectContaining({ key: 'demo', step: 'stopped', outcome: 'refused' }),
      );
      expect((await w.db.query('select id from public.accounts order by id')).rows).toEqual(
        accounts.rows,
      );
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    'writes no qa_accounts row: an account whose row is gone stays without one',
    async () => {
      const w = await seeded();
      // The agency user's personal account holds no site, so the seed itself would adopt it again.
      const gone = await w.db.query<{ account_id: string }>(
        `delete from public.qa_accounts q using public.accounts a
        where a.id = q.account_id and q.qa_key = 'agency' and a.kind = 'personal'
        returning q.account_id`,
      );
      expect(gone.rows).toHaveLength(1);
      const steps = await reset(w.resetDeps);
      expect(steps).toContainEqual(
        expect.objectContaining({ key: 'agency', step: 'stopped', outcome: 'refused' }),
      );
      const row = await w.db.query('select 1 from public.qa_accounts where account_id = $1', [
        gone.rows[0]!.account_id,
      ]);
      expect(row.rows).toEqual([]);
    },
    PGLITE_TIMEOUT,
  );

  withMarker(
    'an account-wide alert rule that has fired does not block the reset',
    async () => {
      const w = await seeded();
      const fired = await w.db.query<{ account_id: string; check_id: string }>(
        `select a.id account_id, c.id check_id from public.accounts a
         join public.qa_accounts q on q.account_id = a.id
         join public.sites s on s.account_id = a.id join public.checks c on c.site_id = s.id
        where q.qa_key = 'agency' and a.kind = 'agency' limit 1`,
      );
      const { account_id, check_id } = fired.rows[0]!;
      await w.db.query(
        `insert into public.alert_rules (account_id, site_id, kind, last_fired_at, last_fired_check_id)
       values ($1, null, 'any_change', now(), $2)`,
        [account_id, check_id],
      );
      const steps = await reset(w.resetDeps);
      expect(exitCode(steps)).toBe(0);
      const rule = await w.db.query(
        `select last_fired_at, last_fired_check_id from public.alert_rules where account_id = $1`,
        [account_id],
      );
      expect(rule.rows).toEqual([{ last_fired_at: null, last_fired_check_id: null }]);
    },
    PGLITE_TIMEOUT,
  );
});

describe('migration 20261117000002', () => {
  withMarker(
    'its rollback applies, and the migration applies again after it',
    async () => {
      const w = await world(base);
      const present = async () =>
        (
          await w.db.query<{ t: string | null; f: string | null }>(
            `select to_regclass('public.qa_accounts')::text t,
                  to_regprocedure('public.qa_reset(uuid)')::text f`,
          )
        ).rows[0];
      expect(await present()).toEqual({ t: 'qa_accounts', f: 'qa_reset(uuid)' });
      await w.db.exec(readRollback(ROLLBACK));
      expect(await present()).toEqual({ t: null, f: null });
      await w.db.exec(readMigration(MIGRATION));
      await w.db.exec(readMigration(MIGRATION));
      expect(await present()).toEqual({ t: 'qa_accounts', f: 'qa_reset(uuid)' });
    },
    PGLITE_TIMEOUT,
  );
});
