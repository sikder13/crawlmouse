/**
 * Migration 20261118000001 (CC-37 D5, Q25): `authenticated` loses `accounts.card_last4`, and the
 * deploy order the split exists for (docs/specs/v2/37-security.md, "Deploy order"):
 *   20261115000001 and 20261117000001 → deploy the app → 20261118000001.
 * One database walks those stages and, at each, the reads the shipped app makes are asked of it: the
 * mint's `seat_may(…, 'mint_report')`, Pricing's used-trial read of `accounts.internal`, and the
 * account pages' card read (`cardFor`); and the app before this step, which reads `card_last4`
 * through the session, while it is still live. On PGlite.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  MIGRATIONS_DIR,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { adminOver, sessionOver } from '../lib/v2/account/sites-test-support';
import { personalAccount, signUp } from './helpers/v2-check-tables';

vi.mock('server-only', () => ({}));
vi.mock('../lib/rate-limit', () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 1, resetAt: new Date(0) }),
}));
vi.mock('../lib/analytics-server', () => ({ captureServerEvent: async () => undefined }));

import { cardFor } from '../lib/v2/account/card';
import { readUsedAgencyTrial } from '../lib/v2/pricing/used-trial';
import { supabaseMintDeps } from '../lib/v2/reports/mint-deps';

const SECURITY = '20261117000001_v2_037_security.sql';
const MIGRATION = '20261118000001_v2_037_card_grant.sql';
const ROLLBACK = '20261118000001_v2_037_card_grant.revert.sql';
const FINGERPRINT = readFileSync(resolve(MIGRATIONS_DIR, '../checks/fingerprint.sql'), 'utf8');
/** Four digits, built from parts. */
const LAST4 = ['42', '42'].join('');

const address = (local: string) =>
  [`${local}-${randomUUID().slice(0, 8)}`, 'example.com'].join('@');

interface Seated {
  id: string;
  email: string;
}

/** An agency account with an owner, an account manager and a developer, a card on file and a site. */
async function world(db: PGlite) {
  const people: Record<'owner' | 'account_manager' | 'developer', Seated> = {
    owner: { id: '', email: address('owner') },
    account_manager: { id: '', email: address('manager') },
    developer: { id: '', email: address('developer') },
  };
  for (const p of Object.values(people)) p.id = await signUp(db, p.email);
  const { accountId } = await personalAccount(db, people.owner.id);
  await db.query(`update public.accounts set kind = 'agency', card_last4 = $2 where id = $1`, [
    accountId,
    LAST4,
  ]);
  for (const role of ['account_manager', 'developer'] as const) {
    await db.query(
      // Unscoped, so each reads the site and the mint's answer is seat_may's alone.
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at,
                                 client_scope_all)
       values ($1, $2, $3, $4, 'active', '2030-01-01T00:00:00Z', true)`,
      [accountId, people[role].id, people[role].email, role],
    );
  }
  const site = await db.query<{ id: string }>(
    `insert into public.sites (account_id, host) values ($1, $2) returning id`,
    [accountId, `c${randomUUID().slice(0, 8)}.example`],
  );
  return { people, accountId, siteId: site.rows[0]!.id };
}
type World = Awaited<ReturnType<typeof world>>;

const session = (db: PGlite, p: Seated) => sessionOver(db, p);
const mayMint = (db: PGlite, w: World, p: Seated) =>
  supabaseMintDeps(session(db, p), adminOver(db), null).mayMint(w.siteId);
/** How the app before this step read the card: through the caller's session. */
const sessionCard = (db: PGlite, w: World, p: Seated) =>
  asRole(db, 'authenticated', p.id, async (tx) => {
    const { rows } = await tx.query<{ card_last4: string | null }>(
      'select card_last4 from public.accounts where id = $1',
      [w.accountId],
    );
    return rows[0]!.card_last4;
  });

/** What the shipped app reads, for each role: the mint's answer, the card read and the used trial. */
async function appReads(db: PGlite, w: World) {
  const out: Record<string, unknown> = {};
  for (const [role, p] of Object.entries(w.people)) {
    out[role] = {
      mint: await mayMint(db, w, p),
      card: await cardFor(session(db, p), adminOver(db), w.accountId),
      usedTrial: await readUsedAgencyTrial(adminOver(db) as never, p.id),
    };
  }
  return out;
}

const AFTER_037 = {
  owner: { mint: true, card: { last4: LAST4, onFile: true }, usedTrial: null },
  account_manager: { mint: true, card: { last4: null, onFile: true }, usedTrial: null },
  developer: { mint: false, card: { last4: null, onFile: true }, usedTrial: null },
};

describe('the deploy order, stage by stage', () => {
  let db: PGlite;
  let w: World;
  beforeAll(async () => {
    db = await freshDb();
    // Production before CC-37: neither CC-33's file nor this step's.
    await applyAllMigrations(db, undefined, (f) => f < '20261115000001');
    w = await world(db);
  }, 300_000);
  afterAll(async () => {
    await db?.close();
  });

  it('before 20261117000001 the shipped app’s flag-gated reads fail: the mint raises and the used-trial read fails', async () => {
    await expect(mayMint(db, w, w.people.owner)).rejects.toThrow(/mint_report is not an action/);
    await expect(readUsedAgencyTrial(adminOver(db) as never, w.people.owner.id)).rejects.toThrow(
      /internal/,
    );
  });

  it('after 20261117000001 and before 20261118000001, a session still reads the card', async () => {
    await db.exec(readMigration(SECURITY));
    for (const p of Object.values(w.people)) expect(await sessionCard(db, w, p)).toBe(LAST4);
  });

  it('after 20261117000001, the shipped app’s reads answer for every role', async () => {
    expect(await appReads(db, w)).toEqual(AFTER_037);
  });

  it('after 20261118000001: the same answers, and no session reads the digits', async () => {
    await db.exec(readMigration(MIGRATION));
    expect(await appReads(db, w)).toEqual(AFTER_037);
    for (const p of Object.values(w.people))
      await expect(sessionCard(db, w, p)).rejects.toThrow(/permission denied/);
  });
});

describe('accounts.card_last4 with every migration applied', () => {
  let db: PGlite;
  let w: World;
  beforeAll(async () => {
    db = await freshDb();
    await applyAllMigrations(db);
    w = await world(db);
  }, 300_000);
  afterAll(async () => {
    await db?.close();
  });

  it.each(['owner', 'account_manager', 'developer'] as const)(
    'an authenticated %s cannot select it, and still reads the row’s other columns',
    async (role) => {
      const p = w.people[role];
      await expect(sessionCard(db, w, p)).rejects.toThrow(/permission denied/);
      const { rows } = await asRole(db, 'authenticated', p.id, (tx) =>
        tx.query<{ id: string }>('select id, tier from public.accounts where id = $1', [
          w.accountId,
        ]),
      );
      expect(rows.map((r) => r.id)).toEqual([w.accountId]);
    },
  );

  it('the service role reads it', async () => {
    const rows = await asRole(
      db,
      'service_role',
      null,
      async (tx) =>
        (
          await tx.query<{ card_last4: string }>(
            'select card_last4 from public.accounts where id = $1',
            [w.accountId],
          )
        ).rows,
    );
    expect(rows).toEqual([{ card_last4: LAST4 }]);
  });
});

/** Columns of accounts authenticated may select, by name. */
const readable = async (d: PGlite) =>
  (
    await d.query<{ name: string }>(
      `select a.attname name from pg_attribute a
        where a.attrelid = 'public.accounts'::regclass and a.attnum > 0 and not a.attisdropped
          and has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT')
        order by 1`,
    )
  ).rows.map((r) => r.name);
const fingerprint = async (d: PGlite) =>
  Object.fromEntries(
    (await d.query<{ section: string; md5: string }>(FINGERPRINT)).rows.map((r) => [
      r.section,
      r.md5,
    ]),
  );
const differing = (a: Record<string, string>, b: Record<string, string>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((s) => a[s] !== b[s]).sort();

describe('the catalog, the re-run and the revert', () => {
  it('takes card_last4 from authenticated and nothing else; applies twice; the revert gives back the schema, twice', async () => {
    const d = await freshDb();
    try {
      await applyAllMigrations(d, undefined, (f) => f < MIGRATION);
      const pre = { columns: await readable(d), print: await fingerprint(d) };
      expect(pre.columns).toContain('card_last4');

      await d.exec(readMigration(MIGRATION));
      const applied = await fingerprint(d);
      expect(await readable(d)).toEqual(pre.columns.filter((c) => c !== 'card_last4'));
      expect(differing(pre.print, applied)).toEqual(['acls']);
      await d.exec(readMigration(MIGRATION));
      expect(differing(applied, await fingerprint(d))).toEqual([]);

      for (let round = 0; round < 2; round++) {
        await d.exec(readRollback(ROLLBACK));
        expect(await readable(d)).toEqual(pre.columns);
        expect(differing(pre.print, await fingerprint(d))).toEqual([]);
      }
      await d.exec(readMigration(MIGRATION));
      expect(differing(applied, await fingerprint(d))).toEqual([]);
    } finally {
      await d.close();
    }
  }, 300_000);
});
