/**
 * The embed badge against Postgres (PGlite, every migration applied), read through the PostgREST
 * stand-in, so the badge's query runs as written over real rows (correctness N1, security N7). A v2
 * report has no grade of its own: the insert trigger copies `grade` from `audits`, and a v2 row names
 * no audit. Until the badge has a v2 form, a claimed v2 report must not replace the domain's v1 badge
 * with "not available"; the badge keeps reading the domain's v1 reports.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from '../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../__tests__/helpers/postgrest-pglite';
import { insertRow, seedWorld, type World } from '../__tests__/helpers/v2-check-tables';
import { badgeVerdict, readLatestVisibleReport } from './badge-report';
import { fixture } from './v2/fixtures';
import { buildPublicSnapshot } from './v2/reports/build-snapshot';
import { FIRST_AUDIT } from './v2/view/segment/test-helpers';

let db: PGlite;
let w: World;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  w = await seedWorld(db, 'badge');
}, 300_000);
afterAll(async () => {
  await db?.close();
});

const snapshot = buildPublicSnapshot(
  fixture('bad-site'),
  FIRST_AUDIT['bad-site'],
  '2026-11-12T18:00:00.000Z',
);
const checkOf = (scope: 'site1' | 'site2') =>
  w.seeded.checks.find((c) => c.scope === scope)!.pk.id as string;

/** A claimed v1 report of `domain`: an audit graded `grade`, minted at `at`. */
async function v1Report(slug: string, domain: string, grade: string, score: number, at: string) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.audits (user_id, url, status, grade, score, completed_at)
     values ($1, $2, 'completed', $3, $4, $5) returning id`,
    [w.ownerId, `https://${domain}/`, grade, score, at],
  );
  await db.query(
    `insert into public.public_reports (slug, audit_id, domain, created_at, claimed_at, listed, indexable)
     values ($1, $2, $3, $4, $4, true, true)`,
    [slug, rows[0]!.id, domain, at],
  );
}

/** A claimed v2 report of `domain`, as `mintV2` inserts one and the claim route then marks it. */
async function v2Report(slug: string, domain: string, scope: 'site1' | 'site2', at: string) {
  await insertRow(db, 'public_reports', {
    slug,
    audit_id: null,
    check_id: checkOf(scope),
    site_id: scope === 'site1' ? w.site1 : w.site2,
    account_id: w.accountId,
    domain,
    report_snapshot: snapshot,
    minted_by: w.ownerId,
    created_at: at,
  });
  await db.query(
    `update public.public_reports set claimed_at = $2, listed = true, indexable = true where slug = $1`,
    [slug, at],
  );
}

const badge = async (domain: string) =>
  badgeVerdict(await readLatestVisibleReport(postgrestOver(db), domain));

describe('the embed badge and a claimed v2 report', () => {
  it('a newer claimed v2 report leaves the domain’s v1 badge as it was', async () => {
    await v1Report('v1-badge', 'badge-one.com', 'B', 81, '2026-11-01T00:00:00Z');
    expect(await badge('badge-one.com')).toEqual({ slug: 'v1-badge', grade: 'B', score: 81 });

    await v2Report('v2-badge', 'badge-one.com', 'site1', '2026-11-12T00:00:00Z');
    expect(await badge('badge-one.com')).toEqual({ slug: 'v1-badge', grade: 'B', score: 81 });
  });

  it('a domain with only a v2 report has no badge, as before (the "not available" badge)', async () => {
    await v2Report('v2-only', 'badge-two.com', 'site2', '2026-11-12T00:00:00Z');
    expect(await readLatestVisibleReport(postgrestOver(db), 'badge-two.com')).toBeNull();
  });

  it('the newest claimed v1 report still wins among v1 reports', async () => {
    await v1Report('v1-old', 'badge-three.com', 'D', 40, '2026-10-01T00:00:00Z');
    await v1Report('v1-new', 'badge-three.com', 'A', 93, '2026-11-02T00:00:00Z');
    expect(await badge('badge-three.com')).toEqual({ slug: 'v1-new', grade: 'A', score: 93 });
  });
});
