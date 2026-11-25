/**
 * A check inserted while its site is being kept (session B's question 011): the interleaving on
 * PGlite with every migration, through the real requestCheck and keep_check, and the test store's
 * insert, which writes the same row.
 * PGlite has one connection, so this runs the two in the order that loses. The row lock that holds
 * the order under real concurrency is tested on a real Postgres: scripts/db/kept-expiry-race.test.ts.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requestCheck, type RequestDeps } from '../lib/v2/pipeline/request';
import { sqlPipelineStore } from '../lib/v2/pipeline/test-support/sql-store';
import { asRole, readMigration, readRollback } from './helpers/pglite-migrations';
import { accountOf, anonymousCheck, doorDb, signUp } from './v2/_lib/door-pglite';

const MIGRATION = '20261122000003_v2_a2_kept_site_no_expiry.sql';
const REVERT = '20261122000003_v2_a2_kept_site_no_expiry.revert.sql';
const FN = 'public.checks_kept_site_has_no_expiry()';

let db: PGlite;
let n = 0;
beforeAll(async () => {
  db = await doorDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

const later = () => new Date(Date.now() + 60 * 60 * 1000);
async function keeper() {
  const user = await signUp(db, `kept-${++n}@example.com`);
  const account = await accountOf(db, user);
  const { rows } = await db.query<{ id: string }>(
    `select id from public.seats where account_id = $1 and role = 'owner'`,
    [account.id],
  );
  return { accountId: account.id, seatId: rows[0]!.id };
}
const keep = (checkId: string, who: { accountId: string; seatId: string }) =>
  asRole(db, 'service_role', null, async (tx) => {
    const { rows } = await tx.query<{ r: string }>(
      `select public.keep_check($1::uuid, $2::uuid, $3::uuid, 'monthly', 1, 9, '[]'::jsonb) as r`,
      [checkId, who.accountId, who.seatId],
    );
    return rows[0]!.r;
  });
const expiryOf = async (id: string) =>
  (
    await db.query<{ expires_at: Date | null }>(
      `select expires_at from public.checks where id = $1`,
      [id],
    )
  ).rows[0]!.expires_at;

/** requestCheck on `siteId`, with `between` run after it read the site and before it inserts. */
async function request(siteId: string, between: () => Promise<unknown> = async () => undefined) {
  const store = sqlPipelineStore({
    query: (text, params) => asRole(db, 'service_role', null, (tx) => tx.query(text, params)),
  });
  const deps: RequestDeps = {
    store: {
      requestSite: (id) => store.requestSite(id),
      accountClock: (id) => store.accountClock(id),
      insertQueued: async (row) => {
        await between();
        return store.insertQueued(row);
      },
    },
    send: async () => undefined,
    now: () => Date.now(),
    newId: () => randomUUID(),
  };
  return requestCheck(deps, { siteId, trigger: 'manual' });
}

describe('a check inserted while its site is being kept', () => {
  it('stores no expiry when keep_check commits between the read and the insert', async () => {
    const who = await keeper();
    const { checkId, siteId } = await anonymousCheck(db, `race-${++n}.example`, later());
    const { checkId: inserted } = await request(siteId, async () => {
      expect(await keep(checkId, who)).toBe('taken');
    });
    expect(await expiryOf(inserted)).toBeNull();
  });

  it('a site nobody keeps still gets its 24-hour expiry', async () => {
    const { siteId } = await anonymousCheck(db, `unkept-${++n}.example`, later());
    const { checkId } = await request(siteId);
    const at = await expiryOf(checkId);
    expect(at).not.toBeNull();
    expect(at!.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
  });

  it('leaves an update alone: an expiry written later is not the trigger’s', async () => {
    const who = await keeper();
    const { checkId, siteId } = await anonymousCheck(db, `update-${++n}.example`, later());
    await keep(checkId, who);
    const when = later();
    await db.query(`update public.checks set expires_at = $1 where site_id = $2`, [when, siteId]);
    expect(await expiryOf(checkId)).not.toBeNull();
  });
});

describe('the migration', () => {
  it('no client role may call the function', async () => {
    const { rows } = await db.query<Record<string, boolean>>(
      `select has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as authed,
              has_function_privilege('service_role', $1, 'execute') as service`,
      [FN],
    );
    expect(rows[0]).toEqual({ anon: false, authed: false, service: false });
  });

  it('runs twice, and its revert runs twice and removes the trigger and the function', async () => {
    const clone = (await db.clone()) as PGlite;
    try {
      await clone.exec(readMigration(MIGRATION));
      await clone.exec(readRollback(REVERT));
      await clone.exec(readRollback(REVERT));
      const { rows } = await clone.query<{ t: number; f: number }>(
        `select (select count(*)::int from pg_trigger where tgname = 'checks_kept_site_has_no_expiry') as t,
                (select count(*)::int from pg_proc where proname = 'checks_kept_site_has_no_expiry') as f`,
      );
      expect(rows[0]).toEqual({ t: 0, f: 0 });
    } finally {
      await clone.close();
    }
  });
});
