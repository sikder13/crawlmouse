/**
 * The account's profile and email preferences (CC-27b D6, `PATCH /api/account`'s write): who may
 * save which field, what each field is held to, and that the write lands on the one account. Run on
 * PGlite with every migration applied, the write through the PostgREST stand-in as the service role.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { parseProfile, supabaseProfilePorts, updateProfile, ZONES } from './profile';

let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => {
  await db.close();
});

interface Row {
  name: string | null;
  timezone: string;
  email_change_notes: boolean;
  email_trial_reminder: boolean;
}

async function account(tag: string) {
  const email = `${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const userId = await signUp(db, email);
  const { accountId } = await personalAccount(db, userId);
  return { accountId, email };
}

const row = async (accountId: string): Promise<Row> =>
  (
    await db.query<Row>(
      `select name, timezone, email_change_notes, email_trial_reminder from public.accounts where id = $1`,
      [accountId],
    )
  ).rows[0]!;

const ports = () => supabaseProfilePorts(postgrestOver(db));

const json = (fields: Record<string, unknown>) => ({ kind: 'json' as const, fields });
const form = (fields: Record<string, string>) => ({ kind: 'form' as const, fields });

describe('who may save', () => {
  it('saves for the owner and for an account manager', async () => {
    for (const role of ['owner', 'account_manager'] as const) {
      const a = await account(role);
      const out = await updateProfile(ports(), {
        accountId: a.accountId,
        accountEmail: a.email,
        role,
        body: json({ name: `  Nahl ${role}  ` }),
      });
      expect(out).toEqual({
        ok: true,
        saved: { name: `Nahl ${role}` },
        forwardEmailChange: null,
      });
      expect((await row(a.accountId)).name).toBe(`Nahl ${role}`);
    }
  });

  it('refuses a developer with 403, writing nothing', async () => {
    const a = await account('dev');
    const before = await row(a.accountId);
    const out = await updateProfile(ports(), {
      accountId: a.accountId,
      accountEmail: a.email,
      role: 'developer',
      body: json({ name: 'Dev' }),
    });
    expect(out).toEqual({ ok: false, status: 403, code: 'role_refused' });
    expect(await row(a.accountId)).toEqual(before);
  });
});

describe('the email change', () => {
  it('forwards an owner’s changed address and saves nothing for it', async () => {
    const a = await account('owner-email');
    const out = await updateProfile(ports(), {
      accountId: a.accountId,
      accountEmail: a.email,
      role: 'owner',
      body: form({ newEmail: ' New@Example.com ', name: 'Kept' }),
    });
    expect(out).toEqual({
      ok: true,
      saved: { name: 'Kept' },
      forwardEmailChange: 'new@example.com',
    });
    const users = await db.query<{ email: string }>(
      `select u.email from public.users u join public.seats s on s.user_id = u.id
        where s.account_id = $1 and s.role = 'owner'`,
      [a.accountId],
    );
    expect(users.rows[0]!.email).toBe(a.email);
  });

  it('refuses a manager’s changed address with 403, and saves none of the request', async () => {
    const a = await account('mgr-email');
    const before = await row(a.accountId);
    const out = await updateProfile(ports(), {
      accountId: a.accountId,
      accountEmail: a.email,
      role: 'account_manager',
      body: form({ newEmail: 'elsewhere@example.com', name: 'Not saved' }),
    });
    expect(out).toEqual({ ok: false, status: 403, code: 'email_change_owner_only' });
    expect(await row(a.accountId)).toEqual(before);
  });

  it('treats the account’s own address, in any case and spacing, as unchanged for a manager', async () => {
    const a = await account('mgr-same');
    const out = await updateProfile(ports(), {
      accountId: a.accountId,
      accountEmail: a.email,
      role: 'account_manager',
      body: form({ newEmail: ` ${a.email.toUpperCase()} `, name: 'Manager saved' }),
    });
    expect(out).toEqual({
      ok: true,
      saved: { name: 'Manager saved' },
      forwardEmailChange: null,
    });
  });

  it('refuses an address that is not one, with 400', async () => {
    const a = await account('bad-email');
    const out = await updateProfile(ports(), {
      accountId: a.accountId,
      accountEmail: a.email,
      role: 'owner',
      body: form({ newEmail: 'not an address', name: 'x' }),
    });
    expect(out).toEqual({ ok: false, status: 400, code: 'invalid', field: 'newEmail' });
  });
});

describe('the fields', () => {
  it('an empty name, after trimming, is stored as none', async () => {
    const a = await account('empty');
    await db.query(`update public.accounts set name = 'Old' where id = $1`, [a.accountId]);
    const out = await updateProfile(ports(), {
      accountId: a.accountId,
      accountEmail: a.email,
      role: 'owner',
      body: form({ newEmail: a.email, name: '   ' }),
    });
    expect(out).toMatchObject({ ok: true, saved: { name: null } });
    expect((await row(a.accountId)).name).toBeNull();
  });

  it('holds the name to 80 characters after trimming', async () => {
    const a = await account('long');
    const eighty = 'n'.repeat(80);
    expect(
      await updateProfile(ports(), {
        accountId: a.accountId,
        accountEmail: a.email,
        role: 'owner',
        body: json({ name: ` ${eighty} ` }),
      }),
    ).toMatchObject({ ok: true, saved: { name: eighty } });
    expect(
      await updateProfile(ports(), {
        accountId: a.accountId,
        accountEmail: a.email,
        role: 'owner',
        body: json({ name: `${eighty}n` }),
      }),
    ).toEqual({ ok: false, status: 400, code: 'invalid', field: 'name' });
    expect((await row(a.accountId)).name).toBe(eighty);
  });

  it('takes an IANA zone the runtime lists, and UTC, and refuses another name', async () => {
    const a = await account('zone');
    for (const zone of ['Europe/London', 'America/Toronto', 'UTC']) {
      const out = await updateProfile(ports(), {
        accountId: a.accountId,
        accountEmail: a.email,
        role: 'owner',
        body: json({ timezone: zone }),
      });
      expect(out).toMatchObject({ ok: true, saved: { timezone: zone } });
      expect((await row(a.accountId)).timezone).toBe(zone);
    }
    for (const zone of ['Mars/Olympus', 'europe/london', '', 'Europe/London ']) {
      expect(
        await updateProfile(ports(), {
          accountId: a.accountId,
          accountEmail: a.email,
          role: 'owner',
          body: json({ timezone: zone }),
        }),
      ).toEqual({ ok: false, status: 400, code: 'invalid', field: 'timezone' });
    }
    expect((await row(a.accountId)).timezone).toBe('UTC');
  });

  it('every zone it takes is a name Postgres knows', async () => {
    const { rows } = await db.query<{ name: string }>(
      `select z from unnest($1::text[]) z where not exists (select 1 from pg_timezone_names n where n.name = z)`,
      [[...ZONES]],
    );
    expect(rows).toEqual([]);
    expect(ZONES.size).toBeGreaterThan(400);
  });

  it('maps email_prefs to the two account columns, from JSON and from a switch’s form', async () => {
    const a = await account('prefs');
    expect(await row(a.accountId)).toMatchObject({
      email_change_notes: true,
      email_trial_reminder: true,
    });
    await updateProfile(ports(), {
      accountId: a.accountId,
      accountEmail: a.email,
      role: 'owner',
      body: json({ email_prefs: { change_notes: false } }),
    });
    expect(await row(a.accountId)).toMatchObject({
      email_change_notes: false,
      email_trial_reminder: true,
    });
    const out = await updateProfile(ports(), {
      accountId: a.accountId,
      accountEmail: a.email,
      role: 'account_manager',
      body: form({ trial_reminder: 'false' }),
    });
    expect(out).toEqual({
      ok: true,
      saved: { email_prefs: { trial_reminder: false } },
      forwardEmailChange: null,
    });
    expect(await row(a.accountId)).toMatchObject({
      email_change_notes: false,
      email_trial_reminder: false,
    });
  });

  it('leaves another account’s row as it was', async () => {
    const a = await account('mine');
    const b = await account('theirs');
    const before = await row(b.accountId);
    await updateProfile(ports(), {
      accountId: a.accountId,
      accountEmail: a.email,
      role: 'owner',
      body: json({ name: 'Mine', timezone: 'Asia/Tokyo', email_prefs: { change_notes: false } }),
    });
    expect(await row(b.accountId)).toEqual(before);
    expect(await row(a.accountId)).toEqual({
      name: 'Mine',
      timezone: 'Asia/Tokyo',
      email_change_notes: false,
      email_trial_reminder: true,
    });
  });
});

describe('the body', () => {
  it.each([
    ['an extra field', json({ name: 'x', role: 'owner' })],
    ['an account id', json({ name: 'x', accountId: randomUUID() })],
    ['an extra email_prefs key', json({ email_prefs: { change_notes: true, digest: true } })],
    ['a switch value that is not true or false', form({ change_notes: 'yes' })],
    ['a JSON switch given as a string', json({ email_prefs: { change_notes: 'false' } })],
    ['a nested email_prefs from a form', form({ email_prefs: 'x' })],
    ['nothing to save', json({})],
    ['nothing to save but the address it already has', form({ newEmail: 'same@example.com' })],
  ])('refuses %s with 400', (_name, body) => {
    const parsed = parseProfile(body, 'same@example.com');
    expect(parsed.ok).toBe(false);
  });

  it('refuses a developer before the body is read', async () => {
    const a = await account('order');
    const out = await updateProfile(ports(), {
      accountId: a.accountId,
      accountEmail: a.email,
      role: 'developer',
      body: json({ role: 'owner' }),
    });
    expect(out).toEqual({ ok: false, status: 403, code: 'role_refused' });
  });
});
