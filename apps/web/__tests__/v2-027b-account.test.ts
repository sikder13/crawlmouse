import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { personalAccount, signUp } from './helpers/v2-check-tables';

/**
 * Migration 027b's shared section (docs/specs/v2/27b-account-wiring.md): the deletion mark, the token,
 * event and pending-erasure tables, users.previous_emails, and the three membership functions
 * redefined to refuse a marked account. Sections A, B and C have their own files.
 */

const MIGRATION = '20261112000002_v2_027b_account.sql';
const ROLLBACK = '20261112000002_v2_027b_account.revert.sql';

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
});
afterAll(async () => db.close());

async function owner(email: string) {
  const userId = await signUp(db, email);
  const { accountId } = await personalAccount(db, userId);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.sites (account_id, host) values ($1, $2) returning id`,
    [accountId, `${email.split('@')[0]}.example`],
  );
  return { userId, accountId, siteId: rows[0]!.id };
}

const asUser = <T>(userId: string, sql: string, params: unknown[]) =>
  asRole(db, 'authenticated', userId, async (tx) => (await tx.query<T>(sql, params)).rows[0]!);

describe('the deletion mark', () => {
  it('makes is_member, member_role and is_member_for_site refuse the account, and clearing it restores them', async () => {
    const o = await owner('mark@example.com');
    const read = async () => ({
      member: (
        await asUser<{ v: boolean }>(o.userId, `select public.is_member($1) v`, [o.accountId])
      ).v,
      role: (
        await asUser<{ v: string | null }>(o.userId, `select public.member_role($1) v`, [
          o.accountId,
        ])
      ).v,
      site: (
        await asUser<{ v: boolean }>(o.userId, `select public.is_member_for_site($1) v`, [o.siteId])
      ).v,
      rows: (
        await asUser<{ n: number }>(
          o.userId,
          `select count(*)::int n from public.accounts where id = $1`,
          [o.accountId],
        )
      ).n,
    });
    expect(await read()).toEqual({ member: true, role: 'owner', site: true, rows: 1 });

    await db.query(
      `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days' where id = $1`,
      [o.accountId],
    );
    expect(await read()).toEqual({ member: false, role: null, site: false, rows: 0 });

    await db.query(
      `update public.accounts set deletion_confirmed_at = null, purge_after = null where id = $1`,
      [o.accountId],
    );
    expect(await read()).toEqual({ member: true, role: 'owner', site: true, rows: 1 });
  });

  it('is set and cleared as a pair, with the purge after the confirm', async () => {
    const o = await owner('pair@example.com');
    for (const set of [
      `deletion_confirmed_at = now()`,
      `purge_after = now()`,
      `deletion_confirmed_at = now(), purge_after = now() - interval '1 second'`,
    ]) {
      await expect(
        db.query(`update public.accounts set ${set} where id = $1`, [o.accountId]),
      ).rejects.toThrow(/accounts_deletion_pair/);
    }
  });

  it('keeps the search_path 20261108000002 set on the three functions', async () => {
    const { rows } = await db.query<{ name: string; config: string[] }>(
      `select p.proname as name, p.proconfig as config from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('is_member', 'member_role', 'is_member_for_site') order by 1`,
    );
    expect(rows.map((r) => [r.name, r.config])).toEqual([
      ['is_member', ['search_path=pg_catalog, public, pg_temp']],
      ['is_member_for_site', ['search_path=pg_catalog, public, pg_temp']],
      ['member_role', ['search_path=pg_catalog, public, pg_temp']],
    ]);
  });
});

describe('what the clients can reach', () => {
  it('grants anon and authenticated nothing on the new tables, the new columns or end_user_sessions', async () => {
    const { rows } = await db.query<{ role: string; what: string; ok: boolean }>(
      `select r.role, t.what,
              case when t.kind = 'table' then has_table_privilege(r.role, t.what, 'select,insert,update,delete')
                   when t.kind = 'column' then has_column_privilege(r.role, split_part(t.what, '#', 1), split_part(t.what, '#', 2), 'select')
                   else has_function_privilege(r.role, t.what, 'execute') end as ok
         from (values ('anon'), ('authenticated')) r(role),
              (values ('table', 'public.account_tokens'), ('table', 'public.account_events'),
                      ('table', 'public.pending_erasures'),
                      ('column', 'public.accounts#deletion_confirmed_at'), ('column', 'public.accounts#purge_after'),
                      ('column', 'public.users#previous_emails'),
                      ('function', 'public.end_user_sessions(uuid, uuid)')) t(kind, what)`,
    );
    expect(rows.filter((r) => r.ok)).toEqual([]);
  });
});

describe('one email change in flight', () => {
  it('refuses a second live email-change token for the account, and allows one once the first is used', async () => {
    const o = await owner('flight@example.com');
    const insert = (hash: string, kind = 'email_change') =>
      db.query(
        `insert into public.account_tokens (account_id, user_id, kind, token_hash, new_email, old_email, expires_at)
         values ($1, $2, $3, $4, 'new@example.com', 'flight@example.com', now() + interval '1 hour')`,
        [o.accountId, o.userId, kind, hash],
      );
    await insert('a'.repeat(64));
    await expect(insert('b'.repeat(64), 'email_change_undo')).rejects.toThrow(
      /account_tokens_one_email_change_uq/,
    );
    await db.query(`update public.account_tokens set used_at = now() where token_hash = $1`, [
      'a'.repeat(64),
    ]);
    await insert('c'.repeat(64), 'email_change_undo');
  });
});

describe('the file', () => {
  it('applies twice, and its rollback leaves the catalogue as it was', async () => {
    const twice = await freshDb();
    try {
      await applyAllMigrations(twice);
      await twice.exec(readMigration(MIGRATION));
      await twice.exec(readRollback(ROLLBACK));
      const { rows } = await twice.query<{ n: number }>(
        `select count(*)::int n from information_schema.columns
          where (table_name = 'accounts' and column_name in ('deletion_confirmed_at', 'purge_after'))
             or (table_name = 'users' and column_name = 'previous_emails')
             or table_name in ('account_tokens', 'account_events', 'pending_erasures')`,
      );
      expect(rows[0]!.n).toBe(0);
      const fn = await twice.query<{ src: string }>(
        `select prosrc as src from pg_proc where proname = 'is_member' and pronamespace = 'public'::regnamespace`,
      );
      expect(fn.rows[0]!.src).not.toMatch(/deletion_confirmed_at/);
    } finally {
      await twice.close();
    }
  });
});

describe('issuing and taking a link', () => {
  const RAW = 'A'.repeat(43);
  const issue = (
    o: { accountId: string; userId: string },
    kind: string,
    hash: string,
    expires = `now() + interval '1 hour'`,
  ) =>
    db.query<{ id: string }>(
      `select public.issue_account_token($1, $2, $3, $4, $5, ${expires}, $6, $7) as id`,
      kind.startsWith('email')
        ? [o.accountId, o.userId, kind, hash, RAW, 'new@example.com', 'old@example.com']
        : [o.accountId, o.userId, kind, hash, RAW, null, null],
    );
  const secrets = async () =>
    (await db.query<{ n: number }>(`select count(*)::int n from vault.secrets`)).rows[0]!.n;

  it('stores the hash on the row and the raw token only in Vault, and the mailer can take it once', async () => {
    const o = await owner('take@example.com');
    const before = await secrets();
    const id = (await issue(o, 'delete_confirm', '1'.repeat(64))).rows[0]!.id;
    const row = await db.query<{ token_hash: string; name: string }>(
      `select t.token_hash, s.name from public.account_tokens t join vault.secrets s on s.id = t.link_secret_id where t.id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ token_hash: '1'.repeat(64), name: `account_link:${id}` });
    expect(await secrets()).toBe(before + 1);

    const first = await db.query(`select * from public.take_account_link($1)`, [id]);
    expect(first.rows).toEqual([
      { kind: 'delete_confirm', token: RAW, recipient: 'take@example.com' },
    ]);
    expect(await secrets()).toBe(before);
    expect((await db.query(`select * from public.take_account_link($1)`, [id])).rows).toEqual([]);
  });

  it('sends an email change to the new address and its undo to the old one', async () => {
    const o = await owner('route@example.com');
    const change = (await issue(o, 'email_change', '2'.repeat(64))).rows[0]!.id;
    expect(
      (await db.query(`select recipient from public.take_account_link($1)`, [change])).rows,
    ).toEqual([{ recipient: 'new@example.com' }]);
    await db.query(`update public.account_tokens set used_at = now() where id = $1`, [change]);
    const undo = (await issue(o, 'email_change_undo', '3'.repeat(64))).rows[0]!.id;
    expect(
      (await db.query(`select recipient from public.take_account_link($1)`, [undo])).rows,
    ).toEqual([{ recipient: 'old@example.com' }]);
  });

  it('revokes a live token of the same kind for the account when a new one is issued', async () => {
    const o = await owner('again@example.com');
    const first = (await issue(o, 'delete_confirm', '4'.repeat(64))).rows[0]!.id;
    await issue(o, 'delete_confirm', '5'.repeat(64));
    const { rows } = await db.query<{ revoked: boolean }>(
      `select revoked_at is not null as revoked from public.account_tokens where id = $1`,
      [first],
    );
    expect(rows[0]!.revoked).toBe(true);
    expect((await db.query(`select * from public.take_account_link($1)`, [first])).rows).toEqual(
      [],
    );
  });

  it('refuses a raw value newToken() would not make', async () => {
    const o = await owner('raw@example.com');
    await expect(
      db.query(
        `select public.issue_account_token($1, $2, 'delete_confirm', $3, 'short', now() + interval '1 hour')`,
        [o.accountId, o.userId, '6'.repeat(64)],
      ),
    ).rejects.toThrow(/raw token/);
  });

  it('leaves no secret behind when an account goes, or when the sweep finds a dead link', async () => {
    const o = await owner('cascade@example.com');
    const before = await secrets();
    await issue(o, 'delete_confirm', '7'.repeat(64));
    const dead = (await issue(o, 'delete_restore', '8'.repeat(64), `now() + interval '1 second'`))
      .rows[0]!.id;
    expect(await secrets()).toBe(before + 2);
    await db.query(
      `update public.account_tokens set expires_at = created_at + interval '1 millisecond' where id = $1`,
      [dead],
    );
    expect(
      (await db.query<{ n: number }>(`select public.sweep_account_links() n`)).rows[0]!.n,
    ).toBe(1);
    expect(await secrets()).toBe(before + 1);
    await db.query(`delete from public.accounts where id = $1`, [o.accountId]);
    expect(await secrets()).toBe(before);
  });

  it('grants the client roles nothing on Vault or on the link functions', async () => {
    const { rows } = await db.query<{ role: string; what: string }>(
      `select r.role, w.what from (values ('anon'), ('authenticated')) r(role),
         (values ('vault.secrets'), ('vault.decrypted_secrets')) w(what)
        where has_table_privilege(r.role, w.what, 'select,insert,update,delete')
       union all
       select r.role, f.what from (values ('anon'), ('authenticated')) r(role),
         (values ('public.issue_account_token(uuid, uuid, text, text, text, timestamptz, text, text)'),
                 ('public.take_account_link(uuid)'), ('public.sweep_account_links()')) f(what)
        where has_function_privilege(r.role, f.what, 'execute')`,
    );
    expect(rows).toEqual([]);
  });
});
