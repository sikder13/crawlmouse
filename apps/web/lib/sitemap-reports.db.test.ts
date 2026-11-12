/**
 * The sitemap's report section against Postgres (PGlite, every migration applied), through the
 * PostgREST stand-in (correctness N8, SEO N4). A claimed, indexable v2 report is a 404 while
 * V2_CHECKS_PUBLIC is off (`isReportGoneEitherKind`), and OPERATING-RULES §13 keeps a URL that answers
 * an error out of the sitemap, so the section lists it only while the flag is on. A v1 report is
 * listed in both states.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../__tests__/helpers/postgrest-pglite';
import { insertRow, seedWorld, type World } from '../__tests__/helpers/v2-check-tables';
import { fetchIndexableReportSlugs } from './sitemap-reports';
import { fixture } from './v2/fixtures';
import { buildPublicSnapshot } from './v2/reports/build-snapshot';
import { FIRST_AUDIT } from './v2/view/segment/test-helpers';

let db: PGlite;
let w: World;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  w = await seedWorld(db, 'sitemap');
  const { rows } = await db.query<{ id: string }>(
    `insert into public.audits (user_id, url, status, grade, score, completed_at)
     values ($1, 'https://sitemap-v1.com/', 'completed', 'B', 80, now()) returning id`,
    [w.ownerId],
  );
  await db.query(
    `insert into public.public_reports (slug, audit_id, domain, created_at, claimed_at, listed, indexable)
     values ('v1-listed', $1, 'sitemap-v1.com', '2026-11-01T00:00:00Z', now(), true, true)`,
    [rows[0]!.id],
  );
  await insertRow(db, 'public_reports', {
    slug: 'v2-listed',
    audit_id: null,
    check_id: w.seeded.checks.find((c) => c.scope === 'site1')!.pk.id,
    site_id: w.site1,
    account_id: w.accountId,
    domain: 'example-outfitter.com',
    report_snapshot: buildPublicSnapshot(
      fixture('bad-site'),
      FIRST_AUDIT['bad-site'],
      '2026-11-12T18:00:00.000Z',
    ),
    minted_by: w.ownerId,
    created_at: '2026-11-12T18:00:00Z',
  });
  // Claimed and indexable, as the claim route leaves a report.
  await db.query(
    `update public.public_reports set claimed_at = now(), listed = true, indexable = true
      where slug = 'v2-listed'`,
  );
}, 300_000);
afterAll(async () => {
  await db?.close();
});
afterEach(() => vi.unstubAllEnvs());

const listed = async () =>
  (await fetchIndexableReportSlugs(postgrestOver(db), 100)).map((e) => e.slug);

describe('the sitemap’s /r/ section and v2 reports', () => {
  it('with V2_CHECKS_PUBLIC off lists the v1 report and not the v2 one', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    expect(await listed()).toEqual(['v1-listed']);
  });

  it('with V2_CHECKS_PUBLIC on lists both, newest first', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    expect(await listed()).toEqual(['v2-listed', 'v1-listed']);
  });
});
