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
  ReportSchema,
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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { siteLinkGate } from './public-links';

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

// Closed when the file ends: a PGlite holds its memory outside the JS heap until then.
afterAll(async () => {
  await db?.close();
});

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
    // A site's first check: its build read no fixes.
    read: [],
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
    expect(row.schedule).toBe('monthly, first Thu');
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

describe('an account whose brand has a stored logo', () => {
  it('loads, and its branding carries the logo’s public URL', async () => {
    const userId = await signUp(db, `logo-${randomUUID().slice(0, 8)}@example.com`);
    const { accountId, seatId } = await personalAccount(db, userId);
    const path = `agency/${accountId}/0123456789abcdef.png`;
    await db.query(
      `insert into public.agency_brands (account_id, agency_name, logo_path) values ($1, 'Northwind', $2)`,
      [accountId, path],
    );
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co');
    try {
      const d = await load(userId, accountId);
      expect(d.accounts[0]?.branding?.agency_name).toBe('Northwind');
      expect(d.accounts[0]?.branding?.logo_url).toBe(
        `https://proj.supabase.co/storage/v1/object/public/report-logos/${path}`,
      );
      // The screens that read the dataset render from it.
      const v = dashboardView(d, { accountId, seatId, now: NOW.toISOString() });
      expect(v.header.title).toBe('Add the site to watch');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('the public links a v2 mint wrote (F-123)', () => {
  const failedCheck = async (siteId: string) =>
    (
      await db.query<{ id: string }>(
        `insert into public.checks
           (site_id, status, trigger, grade_version, queued_at, started_at, finished_at, failure_reason)
         values ($1, 'failed', 'manual', '1.0.0', now(), now(), now(), 'crawl_failed') returning id`,
        [siteId],
      )
    ).rows[0]!.id;
  const mint = async (
    slug: string,
    siteId: string,
    accountId: string,
    extra: 'hidden_at' | 'takedown_requested_at' | null = null,
  ) => {
    const checkId = await failedCheck(siteId);
    await db.query(
      `insert into public.public_reports (slug, check_id, site_id, account_id, domain${
        extra ? `, ${extra}` : ''
      }) values ($1, $2, $3, $4, 'link.example'${extra ? ', now()' : ''})`,
      [slug, checkId, siteId, accountId],
    );
    return checkId;
  };
  const slugs = (d: Awaited<ReturnType<typeof load>>) => d.reports.map((r) => r.public_slug).sort();

  let mainSite: string;
  let shown: string;

  beforeAll(async () => {
    mainSite = built.check.site_id;
    shown = await mint('shown-link', mainSite, owner.accountId);
    await mint('hidden-link', mainSite, owner.accountId, 'hidden_at');
    await mint('taken-down-link', mainSite, owner.accountId, 'takedown_requested_at');
    await mint('scoped-link', OTHER_SITE, owner.accountId);
    // A row on this site carrying another account, and a v1-shaped row with no check.
    const elsewhere = await signUp(db, `elsewhere-${randomUUID().slice(0, 8)}@example.com`);
    await mint('wrong-account-link', mainSite, (await personalAccount(db, elsewhere)).accountId);
    await db.query(
      `insert into public.public_reports (slug, audit_id, site_id, account_id, domain)
       values ('no-check-link', null, $1, $2, 'link.example')`,
      [mainSite, owner.accountId],
    );
    const stranger = await signUp(db, `stranger-${randomUUID().slice(0, 8)}@example.com`);
    const theirs = await personalAccount(db, stranger);
    const theirSite = randomUUID();
    await db.query(
      `insert into public.sites (id, account_id, host) values ($1, $2, 'theirs.example')`,
      [theirSite, theirs.accountId],
    );
    await mint('their-link', theirSite, theirs.accountId);
  });

  it('reads a live link as a public_link report of its check', async () => {
    const d = await load(owner.userId);
    expect(slugs(d)).toEqual(['scoped-link', 'shown-link']);
    const link = d.reports.find((r) => r.public_slug === 'shown-link')!;
    expect(ReportSchema.safeParse(link).success).toBe(true);
    expect(link).toMatchObject({
      kind: 'public_link',
      site_id: mainSite,
      account_id: owner.accountId,
      covers_check_ids: [shown],
    });
  });

  describe('whether a new link may be offered', () => {
    const admin = () => postgrestOver(db);
    const report = (
      slug: string,
      domain: string,
      column: string,
      siteId: string | null,
      accountId: string | null,
    ) =>
      db.query(
        `insert into public.public_reports (slug, site_id, account_id, domain, ${column})
         values ($1, $2, $3, $4, now())`,
        [slug, siteId, accountId, domain],
      );
    const newSite = async (host: string) => {
      const id = randomUUID();
      await db.query(`insert into public.sites (id, account_id, host) values ($1, $2, $3)`, [
        id,
        owner.accountId,
        host,
      ]);
      return { id, host };
    };

    it('is open with nothing withdrawn', async () => {
      const site = await newSite('clear.example');
      expect(await siteLinkGate(admin(), owner.accountId, site)).toEqual({
        gate: 'open',
        hiddenCheckIds: [],
      });
    });

    it('a takedown closes the host, on a v1 row with no site id', async () => {
      const site = await newSite('taken-v1.example');
      await report('v1-down', 'taken-v1.example', 'takedown_requested_at', null, null);
      expect((await siteLinkGate(admin(), owner.accountId, site)).gate).toBe('withdrawn');
    });

    it('a takedown closes a www sibling', async () => {
      await report('www-down', 'sibling.example', 'takedown_requested_at', null, null);
      const www = await newSite('www.sibling.example');
      expect((await siteLinkGate(admin(), owner.accountId, www)).gate).toBe('withdrawn');
    });

    it('a takedown closes a host added again under a new site id', async () => {
      const first = await newSite('readded.example');
      await report(
        're-down',
        'readded.example',
        'takedown_requested_at',
        first.id,
        owner.accountId,
      );
      await db.query(`update public.sites set removed_at = now() where id = $1`, [first.id]);
      const again = await newSite('readded.example');
      expect((await siteLinkGate(admin(), owner.accountId, again)).gate).toBe('withdrawn');
    });

    it('a hide closes nothing, and names the check whose link is hidden', async () => {
      const site = await newSite('hidden-own.example');
      const checkId = await mint('own-hidden', site.id, owner.accountId, 'hidden_at');
      expect(await siteLinkGate(admin(), owner.accountId, site)).toEqual({
        gate: 'open',
        hiddenCheckIds: [checkId],
      });
    });

    it('someone else’s hide of the same domain changes nothing', async () => {
      const site = await newSite('hidden-elsewhere.example');
      await report('v1-hidden', 'hidden-elsewhere.example', 'hidden_at', null, null);
      expect(await siteLinkGate(admin(), owner.accountId, site)).toEqual({
        gate: 'open',
        hiddenCheckIds: [],
      });
    });

    it('a live link of the site leaves it open, with nothing hidden', async () => {
      const site = await newSite('live-only.example');
      await mint('live-only-link', site.id, owner.accountId);
      expect(await siteLinkGate(admin(), owner.accountId, site)).toEqual({
        gate: 'open',
        hiddenCheckIds: [],
      });
    });

    it.each(['takedown_requested_at', 'hidden_at'])(
      'a failed read of %s alone is unknown, not open',
      async (failing) => {
        const client = {
          from: () => {
            let broken = false;
            const q: Record<string, unknown> = {};
            q.select = () => q;
            q.eq = () => q;
            q.not = (column: string) => {
              broken = column === failing;
              return q;
            };
            q.order = () => q;
            q.limit = async () =>
              broken ? { data: null, error: { message: 'down' } } : { data: [], error: null };
            return q;
          },
        } as unknown as ReturnType<typeof admin>;
        expect(
          (await siteLinkGate(client, owner.accountId, { id: OTHER_SITE, host: 'x.example' })).gate,
        ).toBe('unknown');
      },
    );
  });

  it('a seat scoped to one site reads only that site’s link', async () => {
    expect(slugs(await load(devUserId))).toEqual(['scoped-link']);
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
