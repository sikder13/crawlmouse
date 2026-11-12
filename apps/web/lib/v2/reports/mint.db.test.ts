/**
 * `mintV2` against Postgres (PGlite, every migration applied): the caller's check and membership read
 * as `authenticated` under RLS, and the report written as `service_role` into the real
 * `public_reports`, so its column defaults, its trigger and `public_reports_check_uq` are the
 * database's own. PGlite has one backend, so a "concurrent" mint here is one whose read of the
 * existing report came before the other's insert.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, asRole, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { insertRow, seedWorld, type World } from '../../../__tests__/helpers/v2-check-tables';
import { fixture } from '../fixtures';
import { FIRST_AUDIT } from '../view/segment/test-helpers';
import { buildPublicSnapshot } from './build-snapshot';
import { mintV2, type MintV2Deps } from './mint';

let db: PGlite;
let mine: World;
let theirs: World;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  mine = await seedWorld(db, 'mint');
  theirs = await seedWorld(db, 'other');
}, 300_000);
afterAll(async () => {
  await db?.close();
});

const NOW = new Date('2026-11-12T18:00:00.000Z');
const snapshot = buildPublicSnapshot(
  fixture('bad-site'),
  FIRST_AUDIT['bad-site'],
  NOW.toISOString(),
);
const checkOf = (w: World, scope: 'site1' | 'site2') =>
  w.seeded.checks.find((c) => c.scope === scope)!.pk.id as string;

let serial = 0;
/** Deps over PGlite for `caller`, minting into `w`'s account; `edit` overrides any of them. */
function deps(caller: string, w: World, edit: Partial<MintV2Deps> = {}): MintV2Deps {
  return {
    user: async () => ({ id: caller }),
    checkAsCaller: (checkId) =>
      asRole(db, 'authenticated', caller, async (tx) => {
        const { rows } = await tx.query<{ site_id: string; status: string }>(
          'select site_id, status from public.checks where id = $1',
          [checkId],
        );
        return rows[0] ? { siteId: rows[0].site_id, status: rows[0].status } : null;
      }),
    isMemberForSite: (siteId) =>
      asRole(db, 'authenticated', caller, async (tx) => {
        const { rows } = await tx.query<{ ok: boolean }>(
          'select public.is_member_for_site($1) as ok',
          [siteId],
        );
        return rows[0]!.ok === true;
      }),
    rateLimit: async () => ({ allowed: true }),
    verifyTurnstile: async () => true,
    slugForCheck: (checkId) =>
      asRole(db, 'service_role', null, async (tx) => {
        const { rows } = await tx.query<{ slug: string }>(
          'select slug from public.public_reports where check_id = $1',
          [checkId],
        );
        return rows[0]?.slug ?? null;
      }),
    snapshotOf: async () => ({ snapshot, accountId: w.accountId }),
    insert: async (row) => {
      try {
        await asRole(db, 'service_role', null, (tx) => insertRow(tx, 'public_reports', row));
        return { error: null };
      } catch (e) {
        const { code, message } = e as { code?: string; message?: string };
        return { error: { code, message } };
      }
    },
    reportMinted: async () => {},
    newSlug: () => `slug-${++serial}`,
    now: () => NOW,
    ...edit,
  };
}

async function reportRow(slug: string) {
  const { rows } = await db.query<Record<string, unknown>>(
    `select listed, indexable, claimed_at, hidden_at, audit_id, check_id, site_id, account_id,
            domain, minted_by, report_snapshot
       from public.public_reports where slug = $1`,
    [slug],
  );
  return rows[0];
}

describe('mintV2 on Postgres', () => {
  it('a member’s mint is one row, unlisted and noindex by the column defaults', async () => {
    const checkId = checkOf(mine, 'site1');
    const out = await mintV2(deps(mine.ownerId, mine), { checkId }, '9.9.9.9');
    expect(out).toMatchObject({ status: 200, body: { alreadyPublic: false } });
    const slug = (out.body as { slug: string }).slug;
    expect(await reportRow(slug)).toEqual({
      listed: false,
      indexable: false,
      claimed_at: null,
      hidden_at: null,
      audit_id: null,
      check_id: checkId,
      site_id: mine.site1,
      account_id: mine.accountId,
      domain: 'example-outfitter.com',
      minted_by: mine.ownerId,
      report_snapshot: snapshot,
    });
  });

  it('a second mint of the same check answers the same slug', async () => {
    const checkId = checkOf(mine, 'site1');
    const again = await mintV2(deps(mine.ownerId, mine), { checkId }, '9.9.9.9');
    const { rows } = await db.query<{ slug: string }>(
      'select slug from public.public_reports where check_id = $1',
      [checkId],
    );
    expect(rows).toHaveLength(1);
    expect(again).toEqual({ status: 200, body: { slug: rows[0]!.slug, alreadyPublic: true } });
  });

  it('a mint that read no report before another inserted one is answered by the unique index', async () => {
    const checkId = checkOf(mine, 'site2');
    const first = await mintV2(deps(mine.ownerId, mine), { checkId }, '9.9.9.9');
    // The late mint's first read of the existing report saw none; the index stops its insert.
    let reads = 0;
    const late = deps(mine.ownerId, mine);
    const lateRead = late.slugForCheck;
    late.slugForCheck = async (id) => (reads++ === 0 ? null : lateRead(id));
    const second = await mintV2(late, { checkId }, '9.9.9.9');
    expect(second).toEqual({
      status: 200,
      body: { slug: (first.body as { slug: string }).slug, alreadyPublic: true },
    });
  });

  it('a slug taken by another report is retried with a fresh one', async () => {
    const taken = await mintV2(
      deps(theirs.ownerId, theirs),
      { checkId: checkOf(theirs, 'site1') },
      '9.9.9.9',
    );
    const takenSlug = (taken.body as { slug: string }).slug;
    const slugs = [takenSlug, 'fresh-slug'];
    const out = await mintV2(
      deps(theirs.ownerId, theirs, { newSlug: () => slugs.shift()! }),
      { checkId: checkOf(theirs, 'site2') },
      '9.9.9.9',
    );
    expect(out).toEqual({ status: 200, body: { slug: 'fresh-slug', alreadyPublic: false } });
  });

  it('another account’s check is a 404 under RLS, and writes nothing', async () => {
    const before = await db.query('select count(*)::int as n from public.public_reports');
    const out = await mintV2(
      deps(mine.ownerId, mine),
      { checkId: checkOf(theirs, 'site1') },
      '9.9.9.9',
    );
    expect(out).toEqual({ status: 404, body: { error: 'not_found' } });
    const after = await db.query('select count(*)::int as n from public.public_reports');
    expect(after.rows).toEqual(before.rows);
  });
});
