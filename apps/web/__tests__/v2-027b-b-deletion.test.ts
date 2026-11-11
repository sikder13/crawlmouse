import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken, newToken } from '../lib/v2/account/tokens';
import {
  applyAllMigrations,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { FIX_EMAIL_REQUESTS } from './helpers/v2-027b-standins';
import { personalAccount, signUp } from './helpers/v2-check-tables';

/**
 * Migration 027b section B, the in-app deletion (D4): request, confirm, the restore window, and the
 * purge's queue. The erasure's own rules are held by scripts/ops/erase-account.test.ts.
 */

const MIGRATION = '20261112000002_v2_027b_account.sql';
const ROLLBACK = '20261112000002_v2_027b_account.revert.sql';

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  await db.exec(FIX_EMAIL_REQUESTS);
}, 300_000);
afterAll(async () => db.close());

let serial = 0;

/** A person alone on their personal account, with one site. */
async function owner(withSite = true) {
  const email = `del-${++serial}@example.com`;
  const userId = await signUp(db, email);
  const { accountId } = await personalAccount(db, userId);
  const host = `Site-${serial}.example`;
  if (withSite) {
    await db.query(`insert into public.sites (account_id, host) values ($1, $2)`, [
      accountId,
      host,
    ]);
  }
  return { userId, accountId, email, host };
}

type Owner = Awaited<ReturnType<typeof owner>>;

async function json<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T> {
  const { rows } = await db.query<{ r: T }>(sql, params);
  return rows[0]!.r;
}

/** The mailer's issue of the deletion email's links: the confirmation row and its paired restore row. */
async function issue(confirmTokenId: string) {
  const { rows } = await db.query<{ kind: string; token: string; recipient: string }>(
    `select * from public.issue_account_link($1)`,
    [confirmTokenId],
  );
  const by = (kind: string) => rows.find((r) => r.kind === kind)?.token ?? '';
  return { confirm: by('delete_confirm'), restore: by('delete_restore'), rows };
}

/** A request, and (when it is accepted) the two links as the mailer issues them. */
async function request(o: Owner, hostname = o.host) {
  const r = await json<{ ok: boolean; code?: string; confirmTokenId?: string }>(
    `select public.request_account_deletion($1, $2, $3) as r`,
    [o.accountId, o.userId, hostname],
  );
  return { r, ...(r.ok ? await issue(r.confirmTokenId!) : { confirm: '', restore: '' }) };
}

const confirm = (raw: string, now = 'now()') =>
  json<{ ok: boolean; code?: string; accounts?: string[]; purgeAfter?: string }>(
    `select public.confirm_account_deletion($1, ${now}) as r`,
    [hashToken(raw)],
  );
const restore = (raw: string, now = 'now()') =>
  json<{ ok: boolean; code?: string; resume?: string[] }>(
    `select public.restore_account($1, ${now}) as r`,
    [hashToken(raw)],
  );
const n = async (sql: string, params: unknown[] = []) =>
  Number(Object.values((await db.query<Record<string, unknown>>(sql, params)).rows[0]!)[0]);
const marked = (accountId: string) =>
  n(`select count(*) from public.accounts where id = $1 and deletion_confirmed_at is not null`, [
    accountId,
  ]);

describe('request_account_deletion', () => {
  it('takes the primary site’s host in any case, and the sign-in address when there is no site', async () => {
    const o = await owner();
    expect((await request(o, 'nope.example')).r).toEqual({ ok: false, code: 'hostname_mismatch' });
    expect((await request(o, `  ${o.host.toUpperCase()} `)).r.ok).toBe(true);
    const bare = await owner(false);
    expect((await request(bare, 'site.example')).r.code).toBe('hostname_mismatch');
    expect((await request(bare, bare.email.toUpperCase())).r.ok).toBe(true);
  });

  it('issues the two links with their expiries, revokes the earlier pair, and records the request', async () => {
    const o = await owner();
    const first = await request(o);
    const second = await request(o);
    const { rows } = await db.query<{ kind: string; live: boolean; hours: number }>(
      `select kind, revoked_at is null as live,
              round(extract(epoch from expires_at - created_at) / 3600)::int as hours
         from public.account_tokens where user_id = $1 order by created_at, kind`,
      [o.userId],
    );
    expect(rows).toEqual([
      { kind: 'delete_confirm', live: false, hours: 24 },
      { kind: 'delete_restore', live: false, hours: 192 },
      { kind: 'delete_confirm', live: true, hours: 24 },
      { kind: 'delete_restore', live: true, hours: 192 },
    ]);
    expect((await confirm(first.confirm)).code).toBe('invalid_link');
    expect(
      await n(`select count(*) from public.account_events where account_id = $1 and kind = $2`, [
        o.accountId,
        'delete_requested',
      ]),
    ).toBe(2);
    expect(await marked(o.accountId)).toBe(0);
    expect(second.r.ok).toBe(true);
  });

  it('refuses while an email change is in flight, with others seated, and with a v1 plan', async () => {
    const o = await owner();
    await db.query(
      `insert into public.account_tokens (account_id, user_id, kind, token_hash, issued_at, new_email, old_email, expires_at)
       values ($1, $2, 'email_change_undo', $3, now(), 'new@example.com', $4, now() + interval '7 days')`,
      [o.accountId, o.userId, 'e'.repeat(60) + String(1000 + serial), o.email],
    );
    expect((await request(o)).r.code).toBe('email_change_pending');

    const crowded = await owner();
    const other = await signUp(db, `member-${serial}@example.com`);
    await db.query(
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
       values ($1, $2, 'm@example.com', 'developer', 'active', now())`,
      [crowded.accountId, other],
    );
    expect((await request(crowded)).r.code).toBe('others_seated');

    const v1 = await owner();
    await db.query(`update public.users set pro_until = now() + interval '1 day' where id = $1`, [
      v1.userId,
    ]);
    expect((await request(v1)).r.code).toBe('v1_subscription');
    expect(
      await n(`select count(*) from public.account_tokens where user_id = $1`, [v1.userId]),
    ).toBe(0);
  });

  it('raises for someone who is not the account’s active owner', async () => {
    const o = await owner();
    const stranger = await owner();
    await expect(
      db.query(`select public.request_account_deletion($1, $2, $3)`, [
        o.accountId,
        stranger.userId,
        o.host,
      ]),
    ).rejects.toThrow(/not the owner/);
  });
});

describe('confirm_account_deletion', () => {
  it('sends both links to the sign-in address at the request, even after an email change in between', async () => {
    const o = await owner();
    const r = await json<{ ok: boolean; confirmTokenId: string }>(
      `select public.request_account_deletion($1, $2, $3) as r`,
      [o.accountId, o.userId, o.host],
    );
    // An email change confirmed after the request, before the mailer sends.
    await db.query(`update auth.users set email = 'moved@example.net' where id = $1`, [o.userId]);
    await db.query(`update public.users set email = 'moved@example.net' where id = $1`, [o.userId]);
    const { rows } = await issue(r.confirmTokenId);
    expect(rows.map((x) => [x.kind, x.recipient])).toEqual([
      ['delete_confirm', o.email],
      ['delete_restore', o.email],
    ]);
  });

  it('refuses while an email change is in flight, and leaves the change’s links alone', async () => {
    const o = await owner();
    const { confirm: raw } = await request(o);
    const undo = (
      await db.query<{ id: string }>(
        `insert into public.account_tokens (account_id, user_id, kind, token_hash, issued_at, new_email, old_email, expires_at)
         values ($1, $2, 'email_change_undo', $3, now(), 'new@example.com', $4, now() + interval '7 days') returning id`,
        [o.accountId, o.userId, hashToken(newToken()), o.email],
      )
    ).rows[0]!.id;
    expect((await confirm(raw)).code).toBe('email_change_pending');
    expect(await marked(o.accountId)).toBe(0);
    expect(
      await n(`select count(*) from public.account_tokens where id = $1 and revoked_at is null`, [
        undo,
      ]),
    ).toBe(1);
    await db.query(`update public.account_tokens set used_at = now() where id = $1`, [undo]);
    expect((await confirm(raw)).ok).toBe(true);
  });

  it('a row the mailer never issued holds nothing that confirms or restores, and cannot be consumed', async () => {
    const o = await owner();
    const r = await json<{ ok: boolean; confirmTokenId: string }>(
      `select public.request_account_deletion($1, $2, $3) as r`,
      [o.accountId, o.userId, o.host],
    );
    const { rows } = await db.query<Record<string, unknown>>(
      `select token_hash, issued_at, paired_with = $2 as paired, kind
         from public.account_tokens where user_id = $1 order by kind`,
      [o.userId, r.confirmTokenId],
    );
    expect(rows).toEqual([
      { token_hash: null, issued_at: null, paired: null, kind: 'delete_confirm' },
      { token_hash: null, issued_at: null, paired: true, kind: 'delete_restore' },
    ]);
    // The only values such a row could be matched by: an absent hash, and any token at all.
    for (const hash of ['', hashToken(newToken())]) {
      expect(
        (
          await json<{ code: string }>(`select public.confirm_account_deletion($1, now()) as r`, [
            hash,
          ])
        ).code,
      ).toBe('invalid_link');
    }
    expect(await marked(o.accountId)).toBe(0);
    // Issued once, it works; issued again (a retried send), the first token stops matching.
    const first = await issue(r.confirmTokenId);
    const second = await issue(r.confirmTokenId);
    expect((await confirm(first.confirm)).code).toBe('invalid_link');
    expect((await confirm(second.confirm)).ok).toBe(true);
  });

  it('marks every account the person alone holds, queues them for seven days, ends their sessions, and keeps the Auth user', async () => {
    const o = await owner();
    // A second account the person alone holds, and one they share (not marked).
    const { rows } = await db.query<{ id: string }>(
      `insert into public.accounts (kind, state, tier, seat_limit, site_limit, state_history)
       values ('agency', 'free', 'free', 1, 1, '[{"state":"free","since":"2026-01-01T00:00:00.000Z"}]'),
              ('agency', 'free', 'free', 2, 1, '[{"state":"free","since":"2026-01-01T00:00:00.000Z"}]')
       returning id`,
    );
    const [agency, shared] = [rows[0]!.id, rows[1]!.id];
    const someone = await signUp(db, `shared-${serial}@example.com`);
    await db.query(
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at) values
         ($1, $3, 'x@example.com', 'owner', 'active', now()),
         ($2, $3, 'x@example.com', 'developer', 'active', now()),
         ($2, $4, 'y@example.com', 'owner', 'active', now())`,
      [agency, shared, o.userId, someone],
    );
    const session = crypto.randomUUID();
    await db.query(`insert into auth.sessions (id, user_id) values ($1, $2)`, [session, o.userId]);
    await db.query(`insert into auth.refresh_tokens (user_id, session_id) values ($1, $2)`, [
      o.userId,
      session,
    ]);

    const { confirm: raw } = await request(o);
    const before = await n(`select extract(epoch from now())`);
    const r = await confirm(raw);
    expect(r.ok).toBe(true);
    expect([...r.accounts!].sort()).toEqual([o.accountId, agency].sort());
    expect(await marked(o.accountId)).toBe(1);
    expect(await marked(agency)).toBe(1);
    expect(await marked(shared)).toBe(0);
    const q = await db.query<{ accounts: string[]; days: number }>(
      `select accounts, round(extract(epoch from purge_after - confirmed_at) / 86400)::int as days
         from public.pending_erasures where user_id = $1`,
      [o.userId],
    );
    expect(q.rows[0]!.days).toBe(7);
    expect([...q.rows[0]!.accounts].sort()).toEqual([o.accountId, agency].sort());
    expect(Date.parse(r.purgeAfter!) / 1000 - before).toBeGreaterThan(7 * 86400 - 60);
    expect(await n(`select count(*) from auth.sessions where user_id = $1`, [o.userId])).toBe(0);
    expect(await n(`select count(*) from auth.refresh_tokens where user_id = $1`, [o.userId])).toBe(
      0,
    );
    // D4: signing in is stopped by the ban; the Auth user, and with it the data, stays until the purge.
    expect(await n(`select count(*) from auth.users where id = $1`, [o.userId])).toBe(1);
    expect(await n(`select count(*) from public.users where id = $1`, [o.userId])).toBe(1);
    expect(
      await n(
        `select count(*) from public.account_events where kind = 'delete_confirmed' and actor_user_id = $1`,
        [o.userId],
      ),
    ).toBe(2);
    // Used once.
    expect((await confirm(raw)).code).toBe('invalid_link');
  });

  it('a second confirm for the same person (a link from each account they hold) is refused, not an error', async () => {
    const o = await owner();
    const { rows } = await db.query<{ id: string }>(
      `insert into public.accounts (kind, state, tier, seat_limit, site_limit, state_history)
       values ('agency', 'free', 'free', 1, 1, '[{"state":"free","since":"2026-01-01T00:00:00.000Z"}]')
       returning id`,
    );
    const second = rows[0]!.id;
    await db.query(
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
       values ($1, $2, 'x@example.com', 'owner', 'active', now())`,
      [second, o.userId],
    );
    const first = await request(o);
    const other = await request({ ...o, accountId: second }, o.email);
    expect(other.r.ok).toBe(true);
    expect((await confirm(first.confirm)).ok).toBe(true);
    expect(await confirm(other.confirm)).toEqual({ ok: false, code: 'already_confirmed' });
  });

  it('takes a confirmation token only: a restore token, an expired one and an unknown one change nothing', async () => {
    const o = await owner();
    const { confirm: raw, restore: restoreRaw } = await request(o);
    expect((await confirm(restoreRaw)).code).toBe('invalid_link');
    expect((await confirm(newToken())).code).toBe('invalid_link');
    expect((await confirm(raw, `now() + interval '25 hours'`)).code).toBe('invalid_link');
    expect(await marked(o.accountId)).toBe(0);
    expect((await confirm(raw)).ok).toBe(true);
  });

  it('refuses when someone joined after the request, and the link still works once they leave', async () => {
    const o = await owner();
    const { confirm: raw } = await request(o);
    const other = await signUp(db, `late-${serial}@example.com`);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
       values ($1, $2, 'l@example.com', 'developer', 'active', now()) returning id`,
      [o.accountId, other],
    );
    expect((await confirm(raw)).code).toBe('others_seated');
    expect(await marked(o.accountId)).toBe(0);
    await db.query(`delete from public.seats where id = $1`, [rows[0]!.id]);
    expect((await confirm(raw)).ok).toBe(true);
  });
});

describe('restore_account', () => {
  async function confirmed() {
    const o = await owner();
    const links = await request(o);
    expect((await confirm(links.confirm)).ok).toBe(true);
    return { o, ...links };
  }

  it('inside the window, clears the marks and the queue row, and names only the subscriptions it stopped', async () => {
    const { o, restore: raw } = await confirmed();
    expect(
      await json<boolean>(`select public.record_deletion_cancel($1, $2, 'sub_ours', true) as r`, [
        o.userId,
        o.accountId,
      ]),
    ).toBe(true);
    await db.query(`select public.record_deletion_cancel($1, $2, 'sub_theirs', false)`, [
      o.userId,
      o.accountId,
    ]);
    const r = await restore(raw, `now() + interval '6 days 23 hours'`);
    expect(r).toMatchObject({ ok: true, resume: ['sub_ours'] });
    expect(await marked(o.accountId)).toBe(0);
    expect(
      await n(`select count(*) from public.pending_erasures where user_id = $1`, [o.userId]),
    ).toBe(0);
    expect(
      await n(`select count(*) from public.deletion_cancellations where user_id = $1`, [o.userId]),
    ).toBe(0);
    expect(
      await n(
        `select count(*) from public.account_events where account_id = $1 and kind = 'delete_restored'`,
        [o.accountId],
      ),
    ).toBe(1);
    expect((await restore(raw)).code).toBe('invalid_link');
    // A cancel step that runs after the restore records nothing, so it cancels nothing.
    expect(
      await json<boolean>(`select public.record_deletion_cancel($1, $2, 'sub_late', true) as r`, [
        o.userId,
        o.accountId,
      ]),
    ).toBe(false);
  });

  it('after the window, and with a confirmation token, changes nothing', async () => {
    const { o, confirm: confirmRaw, restore: raw } = await confirmed();
    expect((await restore(raw, `now() + interval '7 days 1 minute'`)).code).toBe('window_closed');
    expect((await restore(confirmRaw)).code).toBe('invalid_link');
    expect(await marked(o.accountId)).toBe(1);
    expect(
      await n(`select count(*) from public.pending_erasures where user_id = $1`, [o.userId]),
    ).toBe(1);
  });

  it('before the confirm, says so and leaves the link usable', async () => {
    const o = await owner();
    const { restore: raw, confirm: confirmRaw } = await request(o);
    expect((await restore(raw)).code).toBe('not_confirmed');
    expect((await confirm(confirmRaw)).ok).toBe(true);
    expect((await restore(raw)).ok).toBe(true);
  });
});

describe('read_deletion_link', () => {
  it('shows the accounts and the window without using the link', async () => {
    const o = await owner();
    const { confirm: raw, restore: restoreRaw } = await request(o);
    const read = (kind: string, token: string, now = 'now()') =>
      json<{ ok: boolean; code?: string; accounts?: unknown; purgeAfter?: string | null }>(
        `select public.read_deletion_link($1, $2, ${now}) as r`,
        [kind, hashToken(token)],
      );
    expect(await read('delete_confirm', raw)).toEqual({
      ok: true,
      userId: o.userId,
      purgeAfter: null,
      accounts: [{ id: o.accountId, host: o.host.toLowerCase() }],
    });
    expect((await read('delete_confirm', restoreRaw)).code).toBe('invalid_link');
    expect((await read('delete_restore', restoreRaw)).code).toBe('not_confirmed');
    await confirm(raw);
    expect((await read('delete_confirm', raw)).code).toBe('invalid_link');
    const r = await read('delete_restore', restoreRaw);
    expect(r).toMatchObject({ ok: true, accounts: [{ id: o.accountId }] });
    expect(r.purgeAfter).toBeTruthy();
    expect((await read('delete_restore', restoreRaw, `now() + interval '8 days'`)).code).toBe(
      'invalid_link',
    );
    expect(
      (await read('delete_restore', restoreRaw, `now() + interval '7 days 1 minute'`)).code,
    ).toBe('window_closed');
    expect(await marked(o.accountId)).toBe(1);
  });
});

describe('the purge’s queue', () => {
  it('a person not yet attempted comes before 51 refused ones waiting longer', async () => {
    const refused = Array.from({ length: 51 }, () => crypto.randomUUID());
    for (const id of refused) {
      await db.query(
        `insert into public.pending_erasures (user_id, accounts, confirmed_at, purge_after, attempts, last_attempt_at)
         values ($1, array[gen_random_uuid()], now() - interval '30 days', now() - interval '23 days', 3, now())`,
        [id],
      );
    }
    const fresh = crypto.randomUUID();
    await db.query(
      `insert into public.pending_erasures (user_id, accounts, confirmed_at, purge_after)
       values ($1, array[gen_random_uuid()], now() - interval '8 days', now() - interval '1 day')`,
      [fresh],
    );
    const { rows } = await db.query<{ user_id: string }>(
      `select user_id from public.due_erasures(now(), 50)`,
    );
    expect(rows.map((r) => r.user_id)).toContain(fresh);
    await db.query(`delete from public.pending_erasures where user_id = any($1)`, [
      [...refused, fresh],
    ]);
  });

  it('erase_person_apply refuses inside the window, runs after it, and finish_erasure waits for the Auth user', async () => {
    const o = await owner();
    const { confirm: raw, restore: restoreRaw } = await request(o);
    await confirm(raw);
    const plan = await json(`select public.erase_person_plan($1, null) as r`, [o.userId]);
    const apply = () =>
      db.query(`select public.erase_person_apply($1, null, $2::jsonb, true)`, [
        o.userId,
        JSON.stringify(plan),
      ]);
    expect(
      await n(`select count(*) from public.due_erasures(now(), 1000) where user_id = $1`, [
        o.userId,
      ]),
    ).toBe(0);
    await expect(apply()).rejects.toThrow(/no erasure of this person is due/);
    expect(await n(`select count(*) from public.accounts where id = $1`, [o.accountId])).toBe(1);

    // The window ends.
    await db.query(
      `update public.pending_erasures set confirmed_at = confirmed_at - interval '8 days',
              purge_after = purge_after - interval '8 days' where user_id = $1`,
      [o.userId],
    );
    expect(
      await n(`select count(*) from public.due_erasures(now(), 1000) where user_id = $1`, [
        o.userId,
      ]),
    ).toBe(1);
    await apply();
    expect(await n(`select count(*) from public.accounts where id = $1`, [o.accountId])).toBe(0);
    // The restore token went with the account.
    expect((await restore(restoreRaw)).code).toBe('invalid_link');
    await expect(db.query(`select public.finish_erasure($1)`, [o.userId])).rejects.toThrow(
      /Auth user is still there/,
    );
    expect(
      await n(`select count(*) from public.pending_erasures where user_id = $1`, [o.userId]),
    ).toBe(1);
    await db.query(`select public.record_erasure_attempt($1)`, [o.userId]);
    expect(
      await n(`select attempts from public.pending_erasures where user_id = $1`, [o.userId]),
    ).toBe(1);
    await db.query(`delete from auth.users where id = $1`, [o.userId]);
    await db.query(`select public.finish_erasure($1)`, [o.userId]);
    expect(
      await n(`select count(*) from public.pending_erasures where user_id = $1`, [o.userId]),
    ).toBe(0);
  });
});

/** Section B's functions, read from the file's own `create or replace function` lines. */
const SECTION_B = (() => {
  const sql = readMigration(MIGRATION);
  const b = sql.slice(sql.indexOf('═══ B:'), sql.indexOf('═══ end B'));
  return [...b.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]!);
})();

describe('the catalogue', () => {
  it('section B defines the functions this file tests', () => {
    expect(SECTION_B).toEqual([
      'erase_rules',
      'erase_person_accounts',
      'erase_person_refusals',
      'erase_person_counts',
      'erase_person_plan',
      'erase_person_apply',
      'erase_auth_audit_log',
      'deletion_hostname',
      'deletion_refusal',
      'email_change_live',
      'request_account_deletion',
      'read_deletion_link',
      'confirm_account_deletion',
      'restore_account',
      'record_deletion_cancel',
      'erasure_pending',
      'due_erasures',
      'record_erasure_attempt',
      'finish_erasure',
    ]);
  });

  it('no client role can execute one; the helpers are granted to no role; each is owned by postgres with the search_path', async () => {
    const { rows } = await db.query<{
      name: string;
      owner: string;
      config: string[] | null;
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(
      `select p.proname as name, pg_get_userbyid(p.proowner) as owner, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)
        order by 1`,
      [SECTION_B],
    );
    expect(rows.map((r) => r.name).sort()).toEqual([...SECTION_B].sort());
    const helpers = new Set([
      'erase_rules',
      'erase_person_refusals',
      'deletion_refusal',
      'email_change_live',
    ]);
    for (const r of rows) {
      expect({ name: r.name, anon: r.anon, authenticated: r.authenticated }).toEqual({
        name: r.name,
        anon: false,
        authenticated: false,
      });
      expect(`${r.name}:${r.service}`).toBe(`${r.name}:${!helpers.has(r.name)}`);
      expect(`${r.name}:${r.config?.join()}`).toBe(
        `${r.name}:search_path=pg_catalog, public, pg_temp`,
      );
      expect(r.owner).toBe('postgres');
    }
  });

  it('grants no client role anything on deletion_cancellations', async () => {
    const { rows } = await db.query<{ ok: boolean }>(
      `select has_table_privilege(r, 'public.deletion_cancellations', 'select,insert,update,delete') ok
         from unnest(array['anon', 'authenticated']) r`,
    );
    expect(rows.map((r) => r.ok)).toEqual([false, false]);
  });

  it('applies twice, and its rollback removes section B', async () => {
    const twice = await freshDb();
    try {
      await applyAllMigrations(twice);
      await twice.exec(readMigration(MIGRATION));
      await twice.exec(readRollback(ROLLBACK));
      const left = await twice.query<{ n: number }>(
        `select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`,
        [SECTION_B],
      );
      expect(left.rows[0]!.n).toBe(0);
      expect(
        (
          await twice.query<{ t: string | null }>(
            `select to_regclass('public.deletion_cancellations')::text t`,
          )
        ).rows[0]!.t,
      ).toBeNull();
    } finally {
      await twice.close();
    }
  }, 300_000);
});
