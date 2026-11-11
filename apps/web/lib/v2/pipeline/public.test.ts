import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { asRole } from '../../../__tests__/helpers/pglite-migrations';
import { accountOf, anonymousCheck, doorDb, signUp } from '../../../__tests__/v2/_lib/door-pglite';
import {
  checkRef,
  isExpired,
  publicCheckId,
  publicSiteId,
  readableCheck,
  type Viewer,
} from './public';
import { pgliteCheckReader } from './test-support/pglite';

/** `isMember` as production answers it: the caller's own role reads the site, under RLS. */
const memberUnderRls = (db: PGlite) => (siteId: string, userId: string) =>
  asRole(db, 'authenticated', userId, async (tx) => {
    const { rows } = await tx.query(`select id from public.sites where id = $1`, [siteId]);
    return rows.length === 1;
  });

const depsOf = (db: PGlite) => ({ read: pgliteCheckReader(db), isMember: memberUnderRls(db) });
const anonymous: Viewer = { userId: null };

describe('readableCheck', () => {
  let db: PGlite;
  let owner: string;
  let stranger: string;
  let unkept: { siteId: string; checkId: string };
  let kept: { siteId: string; checkId: string };

  beforeAll(async () => {
    db = await doorDb();
    owner = await signUp(db, 'owner@example.com');
    stranger = await signUp(db, 'stranger@example.com');
    unkept = await anonymousCheck(db, 'unkept.example', new Date('2026-11-11T00:00:00Z'));
    kept = await anonymousCheck(db, 'kept.example', null);
    const account = await accountOf(db, owner);
    await db.query(`update public.sites set account_id = $1 where id = $2`, [
      account.id,
      kept.siteId,
    ]);
    // Applying every migration to a new database takes longer than vitest's 10 s under load.
  }, 120_000);

  it('reads a check on an unkept site by its id, signed in or not', async () => {
    for (const viewer of [anonymous, { userId: owner }, { userId: stranger }]) {
      const access = await readableCheck(depsOf(db), unkept.checkId, viewer);
      expect(access).toMatchObject({
        checkId: unkept.checkId,
        siteId: unkept.siteId,
        accountId: null,
        host: 'unkept.example',
        status: 'queued',
        trigger: 'first_audit',
      });
    }
  });

  it("reads a kept site's check for a member of its account", async () => {
    const access = await readableCheck(depsOf(db), kept.checkId, { userId: owner });
    expect(access?.checkId).toBe(kept.checkId);
    expect(access?.accountId).toBe((await accountOf(db, owner)).id);
  });

  it("answers null for a kept site's check to a visitor and to another account's member", async () => {
    expect(await readableCheck(depsOf(db), kept.checkId, anonymous)).toBeNull();
    expect(await readableCheck(depsOf(db), kept.checkId, { userId: stranger })).toBeNull();
  });

  it('answers null to a member once their seat is removed', async () => {
    const account = await accountOf(db, stranger);
    const theirs = await anonymousCheck(db, 'removed.example', null);
    await db.query(`update public.sites set account_id = $1 where id = $2`, [
      account.id,
      theirs.siteId,
    ]);
    const before = await readableCheck(depsOf(db), theirs.checkId, { userId: stranger });
    expect(before?.checkId).toBe(theirs.checkId);
    await db.query(
      `update public.seats set status = 'removed', removed_at = now() where user_id = $1`,
      [stranger],
    );
    expect(await readableCheck(depsOf(db), theirs.checkId, { userId: stranger })).toBeNull();
  });

  it("answers null for a removed site's check, to its member too", async () => {
    const account = await accountOf(db, owner);
    const gone = await anonymousCheck(db, 'gone.example', null);
    await db.query(`update public.sites set account_id = $1 where id = $2`, [
      account.id,
      gone.siteId,
    ]);
    expect((await readableCheck(depsOf(db), gone.checkId, { userId: owner }))?.checkId).toBe(
      gone.checkId,
    );
    await db.query(`update public.sites set removed_at = now() where id = $1`, [gone.siteId]);
    expect(await readableCheck(depsOf(db), gone.checkId, { userId: owner })).toBeNull();
  });

  it('answers null for an unknown id and for an id that is not a uuid, without a query for the latter', async () => {
    const asked: string[] = [];
    const deps = {
      read: {
        rows: async (table: string) => {
          asked.push(table);
          return [];
        },
      },
      isMember: async () => true,
    };
    expect(await readableCheck(deps, "x' or '1'='1", anonymous)).toBeNull();
    expect(asked).toEqual([]);
    expect(
      await readableCheck(depsOf(db), '00000000-0000-4000-8000-000000000000', anonymous),
    ).toBeNull();
  });

  it('does not ask about membership for a visitor with no session', async () => {
    let asked = 0;
    const deps = {
      read: pgliteCheckReader(db),
      isMember: async () => {
        asked += 1;
        return true;
      },
    };
    expect(await readableCheck(deps, kept.checkId, anonymous)).toBeNull();
    expect(asked).toBe(0);
  });
});

describe('isExpired', () => {
  const at = Date.parse('2026-11-11T00:00:00Z');
  it('is true from the instant of expires_at, and never for a check with none', () => {
    expect(isExpired({ expiresAt: '2026-11-11T00:00:00+00:00' }, at)).toBe(true);
    expect(isExpired({ expiresAt: '2026-11-11T00:00:00.001+00:00' }, at)).toBe(false);
    expect(isExpired({ expiresAt: null }, at)).toBe(false);
  });
});

describe('the ids of a public start', () => {
  const request = '7b1f6c1e-8a53-4c0e-9d3a-2f6f1d0e4b11';
  it('are the same for the same request id and host, and differ when either differs', () => {
    expect(publicCheckId(request, 'a.example')).toBe(publicCheckId(request, 'a.example'));
    expect(publicCheckId(request, 'a.example')).not.toBe(publicCheckId(request, 'b.example'));
    expect(publicCheckId(request, 'a.example')).not.toBe(
      publicCheckId('7b1f6c1e-8a53-4c0e-9d3a-2f6f1d0e4b12', 'a.example'),
    );
    expect(publicCheckId(request, 'a.example')).not.toBe(publicSiteId(request, 'a.example'));
  });
});

describe('checkRef', () => {
  it('is stable for a check and is not the check id', () => {
    const id = '7b1f6c1e-8a53-4c0e-9d3a-2f6f1d0e4b11';
    expect(checkRef(id)).toBe(checkRef(id));
    expect(checkRef(id)).not.toBe(id);
    expect(checkRef(id)).not.toContain(id.slice(0, 8));
  });
});
