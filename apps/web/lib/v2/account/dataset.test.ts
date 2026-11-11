/**
 * The account screens' dataset read from the database (CC-26b R10). Run on PGlite with every
 * migration applied: the caller's client through the PostgREST stand-in as that user (row security
 * and column grants apply), the service role's reads through the pipeline's PGlite reader. The
 * check rows come from persisting the engine's recorded build, so they are what the pipeline writes.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { buildCheck, type BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import {
  AccountSchema,
  ChangeSchema,
  CheckSchema,
  FixEventSchema,
  FixSchema,
  SeatSchema,
  SiteSchema,
  type BatchResult,
  type CrawlPage,
  type FixtureDataset,
} from '@crawlmouse/types/v2';
import { beforeAll, describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { fixture } from '../fixtures';
import { pageVantage, persistBuiltCheck } from '../pipeline/persist';
import {
  pgliteCheckReader,
  pglitePersistDb,
  seedRunningCheck,
} from '../pipeline/test-support/pglite';
import { dashboardView } from '../view/dashboard';
import { sitePage, siteView } from '../view/site';
import { loadAccountDataset } from './dataset';

let db: PGlite;
let built: BuiltCheck;
let owner: { userId: string; accountId: string; seatId: string };
let devUserId: string;
let devSeatId: string;
const OTHER_SITE = randomUUID();
// After the rows this file writes: an account is read only from the moment it exists.
const NOW = new Date(Date.now() + 60_000);
const MONTHLY = { cadence: 'monthly', iso_weekday: 4, hour_local: 6 } as const;

const crawlRows = (batches: readonly unknown[]): CrawlPage[] =>
  (batches as BatchResult[]).flatMap((b) => (b.kind === 'crawl' ? b.pages : []));

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  const userId = await signUp(db, `owner-${randomUUID().slice(0, 8)}@example.com`);
  owner = { userId, ...(await personalAccount(db, userId)) };

  // The recorded build, persisted for a site the Free account keeps on its monthly schedule.
  const input = recordedBuild();
  built = buildCheck(input);
  await seedRunningCheck(
    db,
    { ...input.site, account_id: owner.accountId, schedule: MONTHLY },
    input.check,
  );
  await persistBuiltCheck(pglitePersistDb(db), {
    built,
    vantage: pageVantage(crawlRows(input.batches)),
    map_path: null,
  });

  // A second site with no check yet, and a developer scoped to it alone.
  await db.query(
    `insert into public.sites (id, account_id, host, created_at) values ($1, $2, 'second.example', $3)`,
    [OTHER_SITE, owner.accountId, '2026-11-06T00:00:00Z'],
  );
  devUserId = await signUp(db, `dev-${randomUUID().slice(0, 8)}@example.com`);
  devSeatId = randomUUID();
  await db.query(
    `insert into public.seats (id, account_id, user_id, invited_email, role, status, accepted_at, client_scope_all, theme)
     values ($1, $2, $3, 'dev@example.com', 'developer', 'active', now(), false, 'dark')`,
    [devSeatId, owner.accountId, devUserId],
  );
  await db.query(
    `insert into public.seat_sites (seat_id, site_id, account_id) values ($1, $2, $3)`,
    [devSeatId, OTHER_SITE, owner.accountId],
  );
  await db.query(
    `insert into public.api_keys (account_id, name, prefix, key_hash) values ($1, 'CI', 'cm_ro_ab12', $2)`,
    [owner.accountId, 'f'.repeat(64)],
  );
}, 300_000);

const load = (userId: string, accountId = owner.accountId) =>
  loadAccountDataset(
    {
      session: postgrestOver(db, { as: { userId } }),
      admin: postgrestOver(db),
      records: pgliteCheckReader(db),
    },
    accountId,
    NOW,
  );

describe('loadAccountDataset as the owner', () => {
  it('reads the account, its seats, its live sites and every check record of them', async () => {
    const d = await load(owner.userId);
    expect(d.provenance).toBe('measured');
    expect(d.as_of).toBe(NOW.toISOString());
    expect(d.accounts).toHaveLength(1);
    expect(AccountSchema.safeParse(d.accounts[0]).success).toBe(true);
    expect(d.accounts[0]!.id).toBe(owner.accountId);
    expect(d.accounts[0]!.email).toMatch(/^owner-/);
    expect(d.accounts[0]!.api_keys.map((k) => k.prefix)).toEqual(['cm_ro_ab12']);
    expect(d.seats.map((s) => [s.role, s.client_scope])).toEqual(
      expect.arrayContaining([
        ['owner', 'all'],
        ['developer', [OTHER_SITE]],
      ]),
    );
    for (const s of d.seats) expect(SeatSchema.safeParse(s).success).toBe(true);
    expect(d.sites.map((s) => s.id).sort()).toEqual([built.check.site_id, OTHER_SITE].sort());
    for (const s of d.sites) expect(SiteSchema.safeParse(s).success).toBe(true);
    expect(d.checks.map((c) => c.id)).toEqual([built.check.id]);
    expect(CheckSchema.safeParse(d.checks[0]).success).toBe(true);
    expect(d.fixes).toHaveLength(built.fixes.length);
    for (const f of d.fixes) expect(FixSchema.safeParse(f).success).toBe(true);
    expect(d.fix_events).toHaveLength(built.fix_events.length);
    for (const e of d.fix_events) expect(FixEventSchema.safeParse(e).success).toBe(true);
    expect(d.changes).toHaveLength(built.changes.length);
    for (const c of d.changes) expect(ChangeSchema.safeParse(c).success).toBe(true);
  });

  it('leaves out the collections the screens do not read', async () => {
    const d = await load(owner.userId);
    for (const k of [
      'page_results',
      'link_edges',
      'access_tests',
      'lineages',
      'usage_events',
      'withheld',
      'engine_derived',
    ] as const)
      expect(d[k]).toEqual([]);
  });

  it('a removed site is not read', async () => {
    const gone = randomUUID();
    await db.query(
      `insert into public.sites (id, account_id, host, removed_at) values ($1, $2, 'gone.example', now())`,
      [gone, owner.accountId],
    );
    const d = await load(owner.userId);
    expect(d.sites.map((s) => s.id)).not.toContain(gone);
  });

  it('the screens render from it: a Free site shows its monthly schedule from its record', async () => {
    const d = await load(owner.userId);
    const viewer = { accountId: owner.accountId, seatId: owner.seatId, now: NOW.toISOString() };
    const v = dashboardView(d, viewer);
    const row = v.sites.rows.find((r) => r.key === built.check.site_id)!;
    expect(row.schedule).toBe('monthly, Thu');
    expect(v.sites.rows.find((r) => r.key === OTHER_SITE)!.schedule).toBe('not scheduled');
    const site = sitePage(d, viewer, built.check.site_id);
    expect(site.kind).toBe('site');
    // The second site has no check: its page is the first-check state, with nothing to watch.
    const second = sitePage(d, viewer, OTHER_SITE);
    expect(second.kind === 'first_check' && second.first.state).toBe('none');
  });
});

describe('loadAccountDataset as a developer scoped to one site', () => {
  it('reads only that site, none of the other site’s checks, fixes or changes, and no API key', async () => {
    const d = await load(devUserId);
    expect(d.sites.map((s) => s.id)).toEqual([OTHER_SITE]);
    expect(d.checks).toEqual([]);
    expect(d.fixes).toEqual([]);
    expect(d.fix_events).toEqual([]);
    expect(d.changes).toEqual([]);
    expect(d.accounts[0]!.api_keys).toEqual([]);
  });

  it('the frame wears the developer’s own theme', async () => {
    const d = await load(devUserId);
    const v = dashboardView(d, {
      accountId: owner.accountId,
      seatId: devSeatId,
      now: NOW.toISOString(),
    });
    expect(v.shell.theme).toBe('dark');
  });
});

describe('loadAccountDataset for someone who is not a member', () => {
  it('throws: row security hides the account from them', async () => {
    const stranger = await signUp(db, `stranger-${randomUUID().slice(0, 8)}@example.com`);
    await expect(load(stranger)).rejects.toThrow(/no account/);
  });
});

describe('an account with no site', () => {
  it('reads an empty site list, and the dashboard is day 0', async () => {
    const userId = await signUp(db, `empty-${randomUUID().slice(0, 8)}@example.com`);
    const { accountId, seatId } = await personalAccount(db, userId);
    const d = await load(userId, accountId);
    expect(d.sites).toEqual([]);
    const v = dashboardView(d, { accountId, seatId, now: NOW.toISOString() });
    expect(v.header.title).toBe('Add the site to watch');
  });
});

describe('what the screens read: measured on a fixture', () => {
  // The loader leaves these collections empty. Emptying them in a fixture leaves every model the
  // pages render unchanged, so none of the three views reads them.
  const bad = fixture('bad-site');
  const emptied: FixtureDataset = {
    ...bad,
    page_results: [],
    link_edges: [],
    access_tests: [],
    lineages: [],
    usage_events: [],
    withheld: [],
    engine_derived: [],
    reports: bad.reports.filter((r) => r.kind === 'public_link'),
  };
  const viewer = { accountId: 'a0000000-0000-4000-8000-000000000001', now: bad.as_of };

  it('dashboardView, siteView and the frame give the same models', () => {
    expect(dashboardView(emptied, viewer)).toEqual(dashboardView(bad, viewer));
    for (const s of bad.sites)
      expect(sitePage(emptied, viewer, s.id)).toEqual(sitePage(bad, viewer, s.id));
    expect(siteView(emptied, viewer, bad.sites[0]!.id)).toEqual(
      siteView(bad, viewer, bad.sites[0]!.id),
    );
  });

  it('the fixture holds rows in each emptied collection, so the comparison can fail', () => {
    expect(bad.page_results.length).toBeGreaterThan(0);
    expect(bad.link_edges.length).toBeGreaterThan(0);
    expect(bad.access_tests.length).toBeGreaterThan(0);
    expect(bad.lineages.length).toBeGreaterThan(0);
  });
});
