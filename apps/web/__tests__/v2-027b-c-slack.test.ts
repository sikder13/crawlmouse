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
 * Migration 027b, section C (docs/specs/v2/27b-account-wiring.md, D7): the account's Slack
 * webhook URL, kept as a Vault secret, with its last four characters on a table no client reads.
 * The PGlite Vault stand-in stores the secret as given, so "the stored secret equals the URL" reads
 * the stand-in's plaintext; the cipher itself is Supabase's.
 */

const MIGRATION = '20261112000002_v2_027b_account.sql';
const ROLLBACK = '20261112000002_v2_027b_account.revert.sql';
const URL_A = 'https://hooks.slack.com/services/T0000/B0000/abcdWXYZ';
const URL_B = 'https://hooks.slack.com/services/T0000/B0000/efgh1234';

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
});
afterAll(async () => db.close());

async function account(email: string, tier: 'free' | 'pro' = 'pro') {
  const userId = await signUp(db, email);
  const { accountId } = await personalAccount(db, userId);
  if (tier === 'pro') {
    // A no-card Pro trial: the paid tier with no subscription row to make.
    await db.query(
      `update public.accounts
          set state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
              trial_ends_at = now() + interval '7 days', trial_used_at = now(),
              state_history = state_history || jsonb_build_array(
                jsonb_build_object('state', 'pro_trial', 'since', now()))
        where id = $1`,
      [accountId],
    );
  }
  return { userId, accountId };
}

const setUrl = (accountId: string, url: string) =>
  db.query<{ v: string }>(`select public.set_account_slack_webhook($1, $2) v`, [accountId, url]);

const secretsNamed = async (accountId: string) =>
  (
    await db.query<{ id: string; secret: string }>(
      `select id, secret from vault.secrets where name = $1`,
      [`slack_webhook:${accountId}`],
    )
  ).rows;

const last4 = async (accountId: string) =>
  (await db.query<{ v: string | null }>(`select public.account_slack_last4($1) v`, [accountId]))
    .rows[0]!.v;

describe('what the clients can reach', () => {
  it('grants anon, authenticated and service_role nothing on the table', async () => {
    const { rows } = await db.query<{ role: string; ok: boolean }>(
      `select r.role, has_table_privilege(r.role, 'public.account_slack_destinations',
                                          'select,insert,update,delete,truncate,references,trigger') ok
         from (values ('anon'), ('authenticated'), ('service_role')) r(role) order by 1`,
    );
    expect(rows).toEqual([
      { role: 'anon', ok: false },
      { role: 'authenticated', ok: false },
      { role: 'service_role', ok: false },
    ]);
  });

  it('lets service_role alone execute the three functions, and no role the trigger function', async () => {
    const { rows } = await db.query<{ role: string; fn: string; ok: boolean }>(
      `select r.role, f.fn, has_function_privilege(r.role, f.fn, 'execute') ok
         from (values ('anon'), ('authenticated'), ('service_role')) r(role),
              (values ('public.set_account_slack_webhook(uuid, text)'),
                      ('public.clear_account_slack_webhook(uuid)'),
                      ('public.account_slack_last4(uuid)'),
                      ('public.account_slack_destinations_drop_secret()')) f(fn)
        order by 1, 2`,
    );
    const granted = rows.filter((r) => r.ok).map((r) => `${r.role} ${r.fn}`);
    expect(granted).toEqual([
      'service_role public.account_slack_last4(uuid)',
      'service_role public.clear_account_slack_webhook(uuid)',
      'service_role public.set_account_slack_webhook(uuid, text)',
    ]);
  });

  it('grants anon and authenticated nothing on Vault', async () => {
    const { rows } = await db.query<{ role: string; what: string; ok: boolean }>(
      `select r.role, t.what,
              case when t.kind = 'table' then has_table_privilege(r.role, t.what, 'select,insert,update,delete')
                   when t.kind = 'schema' then has_schema_privilege(r.role, t.what, 'usage')
                   else has_function_privilege(r.role, t.what, 'execute') end ok
         from (values ('anon'), ('authenticated')) r(role),
              (values ('schema', 'vault'), ('table', 'vault.secrets'), ('table', 'vault.decrypted_secrets'),
                      ('function', 'vault.create_secret(text, text, text)'),
                      ('function', 'vault.update_secret(uuid, text, text, text)')) t(kind, what)`,
    );
    expect(rows.filter((r) => r.ok)).toEqual([]);
    expect(rows).toHaveLength(10);
  });

  it('refuses the stored URL to the account’s own signed-in owner, by every path a client has', async () => {
    const o = await account('reach@example.com');
    await setUrl(o.accountId, URL_A);
    for (const sql of [
      `select secret from vault.secrets`,
      `select decrypted_secret from vault.decrypted_secrets`,
      `select * from public.account_slack_destinations`,
      `select public.account_slack_last4('${o.accountId}')`,
      `select public.set_account_slack_webhook('${o.accountId}', '${URL_B}')`,
      `select public.clear_account_slack_webhook('${o.accountId}')`,
    ]) {
      for (const role of ['authenticated', 'anon'] as const) {
        await expect(
          asRole(db, role, role === 'anon' ? null : o.userId, (tx) => tx.query(sql)),
          `${role}: ${sql}`,
        ).rejects.toThrow(/permission denied/);
      }
    }
    expect((await secretsNamed(o.accountId)).map((s) => s.secret)).toEqual([URL_A]);
  });
});

describe('storing the URL', () => {
  it('keeps the URL in one secret named for the account, and its last four on the row', async () => {
    const o = await account('store@example.com');
    expect(await last4(o.accountId)).toBeNull();
    const { rows } = await setUrl(o.accountId, URL_A);
    expect(rows[0]!.v).toBe('WXYZ');
    expect(URL_A.slice(-4)).toBe('WXYZ');

    const secrets = await secretsNamed(o.accountId);
    expect(secrets.map((s) => s.secret)).toEqual([URL_A]);
    const row = await db.query<{ vault_secret_id: string; last4: string }>(
      `select vault_secret_id, last4 from public.account_slack_destinations where account_id = $1`,
      [o.accountId],
    );
    expect(row.rows).toEqual([{ vault_secret_id: secrets[0]!.id, last4: 'WXYZ' }]);
    expect(await last4(o.accountId)).toBe('WXYZ');
  });

  it('replacing the URL updates the same secret, so the account still holds one', async () => {
    const o = await account('replace@example.com');
    await setUrl(o.accountId, URL_A);
    const [first] = await secretsNamed(o.accountId);
    await setUrl(o.accountId, URL_B);
    const after = await secretsNamed(o.accountId);
    expect(after).toEqual([{ id: first!.id, secret: URL_B }]);
    expect(await last4(o.accountId)).toBe('1234');
    const holding = await db.query<{ n: number }>(
      `select count(*)::int n from vault.secrets s
         join public.account_slack_destinations d on d.vault_secret_id = s.id
        where d.account_id = $1`,
      [o.accountId],
    );
    expect(holding.rows[0]!.n).toBe(1);
  });

  it('writes nothing for another account', async () => {
    const a = await account('mine@example.com');
    const b = await account('theirs@example.com');
    await setUrl(b.accountId, URL_B);
    await setUrl(a.accountId, URL_A);
    expect((await secretsNamed(b.accountId)).map((s) => s.secret)).toEqual([URL_B]);
    expect(await last4(b.accountId)).toBe('1234');
  });

  it.each([
    ['http', 'http://hooks.slack.com/services/T0000/B0000/abcd'],
    ['another host', 'https://hooks.slack.com.evil.example/services/T0/B0/abcd'],
    ['another path', 'https://hooks.slack.com/workflows/T0000/B0000/abcd'],
    ['a query', 'https://hooks.slack.com/services/T0000/B0000/abcd?x=1'],
    ['a newline', 'https://hooks.slack.com/services/T0000/B0000/abcd\nx'],
    ['over 500 characters', `https://hooks.slack.com/services/${'a'.repeat(470)}`],
  ])('refuses a URL with %s, storing nothing', async (_name, url) => {
    const o = await account(`bad-${Math.random().toString(36).slice(2)}@example.com`);
    await expect(setUrl(o.accountId, url)).rejects.toThrow(/not a Slack incoming-webhook URL/);
    expect(await secretsNamed(o.accountId)).toEqual([]);
    expect(await last4(o.accountId)).toBeNull();
  });

  it('accepts a URL of exactly 500 characters', async () => {
    const o = await account('five-hundred@example.com');
    const prefix = 'https://hooks.slack.com/services/';
    const url = prefix + 'a'.repeat(500 - prefix.length);
    expect(url).toHaveLength(500);
    await setUrl(o.accountId, url);
    expect(await last4(o.accountId)).toBe('aaaa');
  });

  it('refuses a Free account, as the alert_rules trigger refuses Slack there', async () => {
    const o = await account('free@example.com', 'free');
    await expect(setUrl(o.accountId, URL_A)).rejects.toThrow(/need a paid plan/);
    expect(await secretsNamed(o.accountId)).toEqual([]);
  });

  it('refuses a no-card trial once its end has passed', async () => {
    const o = await account('lapsed@example.com');
    await db.query(
      `update public.accounts set trial_ends_at = now() - interval '1 minute',
              trial_used_at = now() - interval '15 days' where id = $1`,
      [o.accountId],
    );
    await expect(setUrl(o.accountId, URL_A)).rejects.toThrow(/need a paid plan/);
  });

  it('refuses an account marked for deletion', async () => {
    const o = await account('marked@example.com');
    await db.query(
      `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days'
        where id = $1`,
      [o.accountId],
    );
    await expect(setUrl(o.accountId, URL_A)).rejects.toThrow(/no account/);
    expect(await secretsNamed(o.accountId)).toEqual([]);
  });
});

describe('removing the URL', () => {
  it('a clear removes the row and its secret, and says whether there was one', async () => {
    const o = await account('clear@example.com');
    await setUrl(o.accountId, URL_A);
    const once = await db.query<{ v: boolean }>(`select public.clear_account_slack_webhook($1) v`, [
      o.accountId,
    ]);
    expect(once.rows[0]!.v).toBe(true);
    expect(await secretsNamed(o.accountId)).toEqual([]);
    expect(await last4(o.accountId)).toBeNull();
    const twice = await db.query<{ v: boolean }>(
      `select public.clear_account_slack_webhook($1) v`,
      [o.accountId],
    );
    expect(twice.rows[0]!.v).toBe(false);
  });

  it('deleting the account leaves no secret, though the delete runs as a role with no Vault grant', async () => {
    const o = await account('gone@example.com');
    await setUrl(o.accountId, URL_A);
    const [secret] = await secretsNamed(o.accountId);
    await asRole(db, 'service_role', null, (tx) =>
      tx.query(`delete from public.accounts where id = $1`, [o.accountId]),
    );
    const left = await db.query<{ n: number }>(
      `select count(*)::int n from vault.secrets where id = $1`,
      [secret!.id],
    );
    expect(left.rows[0]!.n).toBe(0);
  });
});

describe('the revert', () => {
  it('removes the table, its functions and the secrets it named, and the file applies again', async () => {
    const other = await freshDb();
    try {
      await applyAllMigrations(other);
      const userId = crypto.randomUUID();
      await other.query(`insert into auth.users (id, email) values ($1, 'rv@example.com')`, [
        userId,
      ]);
      const { rows } = await other.query<{ id: string }>(
        `select default_account_id id from public.users where id = $1`,
        [userId],
      );
      const accountId = rows[0]!.id;
      await other.query(
        `update public.accounts set state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
                trial_ends_at = now() + interval '7 days', trial_used_at = now(),
                state_history = state_history || jsonb_build_array(
                  jsonb_build_object('state', 'pro_trial', 'since', now()))
          where id = $1`,
        [accountId],
      );
      await other.query(`select public.set_account_slack_webhook($1, $2)`, [accountId, URL_A]);
      await other.exec(readRollback(ROLLBACK));
      const left = await other.query<{ secrets: number; tables: number; fns: number }>(
        `select (select count(*)::int from vault.secrets where name like 'slack_webhook:%') secrets,
                (select count(*)::int from information_schema.tables
                  where table_name = 'account_slack_destinations') tables,
                (select count(*)::int from pg_proc where proname in
                  ('set_account_slack_webhook', 'clear_account_slack_webhook', 'account_slack_last4',
                   'account_slack_destinations_drop_secret')) fns`,
      );
      expect(left.rows[0]).toEqual({ secrets: 0, tables: 0, fns: 0 });
      await other.exec(readMigration(MIGRATION));
      await other.exec(readMigration(MIGRATION));
    } finally {
      await other.close();
    }
  });
});
