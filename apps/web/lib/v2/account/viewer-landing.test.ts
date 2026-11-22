/**
 * F-105: which account a person with several seats lands in when nothing recorded chooses. The CTO's
 * rule (2026-11-22): their personal account if it holds a site; else the one agency they own; else
 * as before. Never an account they only hold a seat on. Run on PGlite with every migration applied,
 * through the PostgREST stand-in as the caller, so row security decides what is read.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { agencyAccount } from '../agency/test-support';
import { readViewer } from './viewer-read';

let db: PGlite;
const NOW = new Date('2026-11-10T12:00:00.000Z');

afterAll(async () => {
  await db?.close();
});
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);

interface Person {
  id: string;
  email: string;
}

async function person(): Promise<Person & { personal: string }> {
  const email = `p-${randomUUID().slice(0, 8)}@example.com`;
  const id = await signUp(db, email);
  const { accountId } = await personalAccount(db, id);
  return { id, email, personal: accountId };
}

const addSite = (accountId: string) =>
  db.query<{ id: string }>(
    `insert into public.sites (account_id, host) values ($1, $2) returning id`,
    [accountId, `s-${randomUUID().slice(0, 8)}.example.com`],
  );

const addSeat = (accountId: string, p: Person, role: 'account_manager' | 'developer') =>
  db.query(
    `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
     values ($1, $2, $3, $4, 'active', now())`,
    [accountId, p.id, p.email, role],
  );

async function landsIn(p: Person, chosen: string | null = null): Promise<string | null> {
  const r = await readViewer(
    {
      session: postgrestOver(db, { as: { userId: p.id } }),
      admin: postgrestOver(db),
      now: () => NOW,
    },
    { id: p.id, email: p.email },
    chosen,
  );
  return r.kind === 'viewer' ? r.viewer.account.id : r.kind;
}

describe('landing with several seats and no choice recorded', () => {
  it('an empty personal account and one owned agency with a site (production’s three people): the agency', async () => {
    const p = await person();
    const { accountId } = await agencyAccount(db, p);
    await addSite(accountId);
    expect(await landsIn(p)).toBe(accountId);
  });

  it('an empty personal account and one owned agency with no site: the agency', async () => {
    const p = await person();
    const { accountId } = await agencyAccount(db, p);
    expect(await landsIn(p)).toBe(accountId);
  });

  it('a personal account that holds a site: the personal account', async () => {
    const p = await person();
    await addSite(p.personal);
    const agency = await agencyAccount(db, p);
    await addSite(agency.accountId);
    expect(await landsIn(p)).toBe(p.personal);
  });

  it('a personal site that was removed does not count as holding one', async () => {
    const p = await person();
    const { rows } = await addSite(p.personal);
    await db.query(`update public.sites set removed_at = now() where id = $1`, [rows[0]!.id]);
    const { accountId } = await agencyAccount(db, p);
    expect(await landsIn(p)).toBe(accountId);
  });

  it('a staging copy left from a removed site does not count as holding one', async () => {
    const p = await person();
    const { rows } = await addSite(p.personal);
    await db.query(
      `insert into public.sites (account_id, host, staging_of_site_id) values ($1, $2, $3)`,
      [p.personal, `staging-${randomUUID().slice(0, 8)}.example.com`, rows[0]!.id],
    );
    await db.query(`update public.sites set removed_at = now() where id = $1`, [rows[0]!.id]);
    const { accountId } = await agencyAccount(db, p);
    expect(await landsIn(p)).toBe(accountId);
  });

  it('two owned agencies: the personal account, since neither is the one', async () => {
    const p = await person();
    await agencyAccount(db, p, 'First');
    await agencyAccount(db, p, 'Second');
    expect(await landsIn(p)).toBe(p.personal);
  });

  it.each(['account_manager', 'developer'] as const)(
    'an agency where they are only a %s: the personal account',
    async (role) => {
      const owner = await person();
      const { accountId } = await agencyAccount(db, owner);
      const p = await person();
      await addSeat(accountId, p, role);
      expect(await landsIn(p)).toBe(p.personal);
    },
  );

  it('one owned agency beside a seat on someone else’s: the owned one', async () => {
    const owner = await person();
    const theirs = await agencyAccount(db, owner, 'Theirs');
    const p = await person();
    await addSeat(theirs.accountId, p, 'account_manager');
    const mine = await agencyAccount(db, p, 'Mine');
    expect(await landsIn(p)).toBe(mine.accountId);
  });

  it('an owned agency marked for deletion is not landed in', async () => {
    const p = await person();
    const { accountId } = await agencyAccount(db, p);
    await db.query(
      `update public.accounts set deletion_confirmed_at = $2,
              purge_after = $2::timestamptz + interval '7 days' where id = $1`,
      [accountId, NOW],
    );
    expect(await landsIn(p)).toBe(p.personal);
  });

  it('a default that is not a personal account stays the default', async () => {
    const p = await person();
    const first = await agencyAccount(db, p, 'Default');
    await agencyAccount(db, p, 'Other');
    await db.query(`update public.users set default_account_id = $1 where id = $2`, [
      first.accountId,
      p.id,
    ]);
    expect(await landsIn(p)).toBe(first.accountId);
  });

  it('no usable default is still not guessed', async () => {
    const p = await person();
    await agencyAccount(db, p);
    await db.query(`update public.users set default_account_id = null where id = $1`, [p.id]);
    expect(await landsIn(p)).toBe('ambiguous');
  });

  it('writes nothing: the default account stays the personal one', async () => {
    const p = await person();
    await agencyAccount(db, p);
    await landsIn(p);
    const { rows } = await db.query<{ default_account_id: string }>(
      `select default_account_id from public.users where id = $1`,
      [p.id],
    );
    expect(rows[0]!.default_account_id).toBe(p.personal);
  });
});

describe('a recorded choice still wins', () => {
  it('the switcher’s cookie naming the empty personal account is followed', async () => {
    const p = await person();
    await agencyAccount(db, p);
    expect(await landsIn(p, p.personal)).toBe(p.personal);
  });

  it('a cookie naming an account they hold no seat on is ignored, and the rule applies', async () => {
    const stranger = await person();
    const p = await person();
    const { accountId } = await agencyAccount(db, p);
    expect(await landsIn(p, stranger.personal)).toBe(accountId);
  });
});
