import { createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { hashToken, isToken, newToken } from '../lib/v2/account/tokens';
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
}, 120_000);
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

describe('one live email link per kind', () => {
  it('holds an account to one live link of each email kind, and lets the two kinds live together', async () => {
    const o = await owner('flight@example.com');
    const insert = (hash: string, kind: string) =>
      db.query(
        `insert into public.account_tokens (account_id, user_id, kind, token_hash, issued_at, new_email, old_email, expires_at)
         values ($1, $2, $3, $4, now(), 'new@example.com', 'flight@example.com', now() + interval '1 hour')`,
        [o.accountId, o.userId, kind, hash],
      );
    // A request creates both links at once (D3: the old address hears at request time).
    await insert('a'.repeat(64), 'email_change');
    await insert('b'.repeat(64), 'email_change_undo');
    for (const kind of ['email_change', 'email_change_undo']) {
      await expect(insert('c'.repeat(64), kind)).rejects.toThrow(
        /account_tokens_one_live_email_link_uq/,
      );
    }
    await db.query(`update public.account_tokens set used_at = now() where token_hash = $1`, [
      'a'.repeat(64),
    ]);
    await insert('d'.repeat(64), 'email_change');
  });
});

describe('the file', () => {
  it(
    'applies twice, and its rollback leaves the catalogue as it was',
    { timeout: 120_000 },
    async () => {
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
    },
  );
});

describe('a link is minted at send, never stored', () => {
  const create = (
    o: { accountId: string; userId: string },
    kind: string,
    expires = `now() + interval '1 hour'`,
  ) =>
    db.query<{ id: string }>(
      // A deletion link carries the sign-in address as request_account_deletion stores it.
      `select public.create_account_token($1, $2, $3, ${expires}, $4, $5, null,
         case when $3 like 'delete%' then (select u.email from public.users u where u.id = $2) end) as id`,
      kind.startsWith('email')
        ? [o.accountId, o.userId, kind, 'new@example.com', 'old@example.com']
        : [o.accountId, o.userId, kind, null, null],
    );
  const issue = (id: string) =>
    db.query<{ kind: string; token: string; recipient: string }>(
      `select * from public.issue_account_link($1)`,
      [id],
    );
  const row = async (id: string) =>
    (
      await db.query<Record<string, unknown>>(`select * from public.account_tokens where id = $1`, [
        id,
      ])
    ).rows[0]!;

  it('creates the row with nothing that confirms anything: no hash, not issued, no token-shaped value', async () => {
    const o = await owner('before@example.com');
    const id = (await create(o, 'delete_confirm')).rows[0]!.id;
    const r = await row(id);
    expect(r.token_hash).toBeNull();
    expect(r.issued_at).toBeNull();
    for (const v of Object.values(r)) expect(isToken(v)).toBe(false);
    // No hash of any token can find it: a lookup by hash never matches a null.
    const { rows } = await db.query(`select 1 from public.account_tokens where token_hash = $1`, [
      hashToken(newToken()),
    ]);
    expect(rows).toEqual([]);
  });

  it('mints a token whose sha256, computed here, is what the row now holds', async () => {
    const o = await owner('mint@example.com');
    const id = (await create(o, 'delete_confirm')).rows[0]!.id;
    const [link] = (await issue(id)).rows;
    expect(link).toMatchObject({ kind: 'delete_confirm', recipient: 'mint@example.com' });
    expect(isToken(link!.token)).toBe(true);
    const expected = createHash('sha256').update(link!.token, 'utf8').digest('hex');
    expect((await row(id)).token_hash).toBe(expected);
    expect((await row(id)).issued_at).not.toBeNull();
  });

  it('a retried send gets a fresh token, and the earlier one no longer matches', async () => {
    const o = await owner('retry@example.com');
    const id = (await create(o, 'delete_confirm')).rows[0]!.id;
    const first = (await issue(id)).rows[0]!.token;
    const second = (await issue(id)).rows[0]!.token;
    expect(second).not.toBe(first);
    const match = async (t: string) =>
      (await db.query(`select 1 from public.account_tokens where token_hash = $1`, [hashToken(t)]))
        .rows.length;
    expect(await match(first)).toBe(0);
    expect(await match(second)).toBe(1);
  });

  it('answers nothing for a used, revoked or expired row', async () => {
    const o = await owner('dead@example.com');
    const used = (await create(o, 'delete_confirm')).rows[0]!.id;
    await issue(used);
    await db.query(`update public.account_tokens set used_at = now() where id = $1`, [used]);
    const expired = (await create(o, 'delete_restore')).rows[0]!.id;
    await db.query(
      `update public.account_tokens set expires_at = created_at + interval '1 millisecond' where id = $1`,
      [expired],
    );
    const revoked = (await create(o, 'email_change')).rows[0]!.id;
    await db.query(`update public.account_tokens set revoked_at = now() where id = $1`, [revoked]);
    for (const id of [used, expired, revoked]) expect((await issue(id)).rows).toEqual([]);
  });

  it('sends an email change to the new address and its undo to the old one', async () => {
    const o = await owner('route@example.com');
    const change = (await create(o, 'email_change')).rows[0]!.id;
    expect((await issue(change)).rows[0]!.recipient).toBe('new@example.com');
    await db.query(`update public.account_tokens set used_at = now() where id = $1`, [change]);
    const undo = (await create(o, 'email_change_undo')).rows[0]!.id;
    expect((await issue(undo)).rows[0]!.recipient).toBe('old@example.com');
  });

  it('revokes a live token of the same kind for the account when a new one is created', async () => {
    const o = await owner('again@example.com');
    const first = (await create(o, 'delete_confirm')).rows[0]!.id;
    await create(o, 'delete_confirm');
    expect((await row(first)).revoked_at).not.toBeNull();
    expect((await issue(first)).rows).toEqual([]);
  });

  it('issues the deletion email’s restore link with its confirm link, and not on its own', async () => {
    const o = await owner('pair@example.org');
    const confirm = (await create(o, 'delete_confirm')).rows[0]!.id;
    const restore = (
      await db.query<{ id: string }>(
        `select public.create_account_token($1, $2, 'delete_restore', now() + interval '8 days', null, null, $3,
          (select u.email from public.users u where u.id = $2)) as id`,
        [o.accountId, o.userId, confirm],
      )
    ).rows[0]!.id;
    const links = (await issue(confirm)).rows;
    expect(links.map((l) => l.kind)).toEqual(['delete_confirm', 'delete_restore']);
    expect(new Set(links.map((l) => l.recipient))).toEqual(new Set(['pair@example.org']));
    expect((await row(restore)).token_hash).toBe(hashToken(links[1]!.token));
    // Once the confirm link is used, asking for it again issues neither.
    await db.query(`update public.account_tokens set used_at = now() where id = $1`, [confirm]);
    expect((await issue(confirm)).rows).toEqual([]);
  });

  it('grants the client roles nothing on the link functions', async () => {
    const { rows } = await db.query<{ role: string; what: string }>(
      `select r.role, f.what from (values ('anon'), ('authenticated')) r(role),
         (values ('public.create_account_token(uuid, uuid, text, timestamptz, text, text, uuid, text)'),
                 ('public.issue_account_link(uuid)')) f(what)
        where has_function_privilege(r.role, f.what, 'execute')`,
    );
    expect(rows).toEqual([]);
  });
});
