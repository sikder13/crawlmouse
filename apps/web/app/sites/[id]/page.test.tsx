/**
 * /sites/[id] (CC-26b D8). Run on PGlite with every migration applied: the session client is the
 * PostgREST stand-in as the signed-in user (row security applies), the service role is the stand-in
 * without one, and the paged reader is the pipeline's PGlite reader.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { buildCheck } from '@crawlmouse/engine/v2/pipeline';
import type { BatchResult, CrawlPage } from '@crawlmouse/types/v2';
import type { ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { pageVantage, persistBuiltCheck } from '../../../lib/v2/pipeline/persist';
import {
  pgliteCheckReader,
  pglitePersistDb,
  seedRunningCheck,
} from '../../../lib/v2/pipeline/test-support/pglite';

const h = vi.hoisted(() => ({ db: null as unknown, userId: null as string | null }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    ...postgrestOver(h.db as PGlite, h.userId ? { as: { userId: h.userId } } : {}),
    auth: {
      getUser: async () => ({ data: { user: h.userId ? { id: h.userId } : null }, error: null }),
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => postgrestOver(h.db as PGlite) }));
vi.mock('@/lib/v2/pipeline/load', () => ({
  supabaseCheckReader: () => pgliteCheckReader(h.db as PGlite),
}));

import { FirstCheckScreen } from '@/components/v2/screens/site/FirstCheckScreen';
import { SiteScreen } from '@/components/v2/screens/site/SiteScreen';
import { siteOfCaller } from '@/lib/v2/account/pages';
import { dayDate, hourMinute } from '@/lib/v2/format';
import SitePage from './page';

let db: PGlite;
let ownerId: string;
let strangerId: string;
let kept: string;
let empty: string;
let removed: string;
let theirs: string;

const crawlRows = (batches: readonly unknown[]): CrawlPage[] =>
  (batches as BatchResult[]).flatMap((b) => (b.kind === 'crawl' ? b.pages : []));

// Closed when the file ends: a PGlite holds its memory outside the JS heap until then.
afterAll(async () => {
  await db?.close();
});

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  h.db = db;
  ownerId = await signUp(db, `owner-${randomUUID().slice(0, 8)}@example.com`);
  const { accountId } = await personalAccount(db, ownerId);
  const input = recordedBuild();
  kept = input.site.id;
  await seedRunningCheck(db, { ...input.site, account_id: accountId }, input.check);
  await persistBuiltCheck(pglitePersistDb(db), {
    built: buildCheck(input),
    vantage: pageVantage(crawlRows(input.batches)),
    map_path: null,
    // A site's first check: its build read no fixes.
    read: [],
  });
  empty = randomUUID();
  removed = randomUUID();
  await db.query(
    `insert into public.sites (id, account_id, host) values ($1, $2, 'second.example')`,
    [empty, accountId],
  );
  await db.query(
    `insert into public.sites (id, account_id, host, removed_at) values ($1, $2, 'gone.example', now())`,
    [removed, accountId],
  );
  strangerId = await signUp(db, `stranger-${randomUUID().slice(0, 8)}@example.com`);
  const other = await personalAccount(db, strangerId);
  theirs = randomUUID();
  await db.query(
    `insert into public.sites (id, account_id, host) values ($1, $2, 'theirs.example')`,
    [theirs, other.accountId],
  );
}, 300_000);

afterEach(() => vi.unstubAllEnvs());

const open = (id: string, userId: string | null = ownerId, search: Record<string, string> = {}) => {
  h.userId = userId;
  return SitePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(search) });
};
const notFoundError = { digest: expect.stringMatching(/404/) };
const children = (el: unknown) =>
  (el as ReactElement<{ children: ReactElement<{ notice?: unknown }> }>).props.children;

describe('/sites/[id] with V2_CHECKS_PUBLIC off', () => {
  it('is a 404 even for the owner of the site', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    await expect(open(kept)).rejects.toMatchObject(notFoundError);
  });
});

describe('/sites/[id] with V2_CHECKS_PUBLIC=1', () => {
  it('sends a signed-out caller to sign in', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    await expect(open(kept, null)).rejects.toMatchObject({
      digest: expect.stringContaining('/login'),
    });
  });

  it('renders a site with a result as the site screen', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const page = children(await open(kept));
    expect(page.type).toBe(SiteScreen);
  });

  it('names the next check at the time sites.next_check_at holds (CC-28 D8)', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    await db.query(
      `update public.sites set schedule_cadence = 'monthly', schedule_iso_weekday = 2,
              schedule_hour_local = 7, schedule_offset_min = 41 where id = $1`,
      [kept],
    );
    const { rows } = await db.query<{ at: Date; tz: string }>(
      `select s.next_check_at as at, a.timezone as tz
         from public.sites s join public.accounts a on a.id = s.account_id where s.id = $1`,
      [kept],
    );
    const at = rows[0]!.at.toISOString();
    const page = children(await open(kept)) as unknown as ReactElement<{
      data: { header: { line: string } };
    }>;
    expect(page.props.data.header.line).toContain(
      `next ${dayDate(at, rows[0]!.tz)} around ${hourMinute(at, rows[0]!.tz)}`,
    );
    // The monthly time the column holds: minute 41, which no weekly stand-in reads.
    expect(hourMinute(at, rows[0]!.tz)).toMatch(/:41$/);
  });

  it('lists the account’s six default rules for an account that never opened /alerts (S4, Q13)', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const db = h.db as PGlite;
    const userId = await signUp(db, `rules-${randomUUID().slice(0, 8)}@example.com`);
    const { accountId } = await personalAccount(db, userId);
    const site = randomUUID();
    await db.query(
      `insert into public.sites (id, account_id, host) values ($1, $2, 'rules.example')`,
      [site, accountId],
    );
    const before = await db.query(`select 1 from public.alert_rules where account_id = $1`, [
      accountId,
    ]);
    expect(before.rows).toHaveLength(0);
    // Read before the first check finishes, too: the rules exist either way.
    expect(children(await open(site, userId)).type).toBe(FirstCheckScreen);
    const after = await db.query<{ kind: string }>(
      `select kind from public.alert_rules where account_id = $1 and site_id is null order by kind`,
      [accountId],
    );
    expect(after.rows).toHaveLength(6);
    // The owner's account (made after the migrations, so the backfill never saw it) shows them.
    const page = children(await open(kept)) as unknown as ReactElement<{
      data: { alerts: { rows: unknown[] } };
    }>;
    expect(page.props.data.alerts.rows).toHaveLength(6);
  });

  it('renders a site with no check yet as the first-check screen', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const page = children(await open(empty));
    expect(page.type).toBe(FirstCheckScreen);
  });

  it('another account’s site, a removed site, a missing site and a malformed id are each a 404', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    await expect(open(theirs)).rejects.toMatchObject(notFoundError);
    await expect(open(removed)).rejects.toMatchObject(notFoundError);
    await expect(open(randomUUID())).rejects.toMatchObject(notFoundError);
    await expect(open('not-an-id')).rejects.toMatchObject(notFoundError);
  });

  it('a refused form’s notice is passed to the screen; an unknown one is none', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const shown = children(await open(kept, ownerId, { notice: 'capped' }));
    expect(shown.props.notice).toMatchObject({ code: 'capped' });
    const first = children(await open(empty, ownerId, { notice: 'site_paused' }));
    expect(first.props.notice).toMatchObject({ code: 'site_paused' });
    expect(children(await open(kept, ownerId, { notice: 'whatever' })).props.notice).toBeNull();
    expect(children(await open(kept)).props.notice).toBeNull();
  });

  it('a site of a deleted account is a 404, though its seat and site rows remain', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const db = h.db as PGlite;
    const userId = await signUp(db, `deleted-${randomUUID().slice(0, 8)}@example.com`);
    const { accountId } = await personalAccount(db, userId);
    const site = randomUUID();
    await db.query(
      `insert into public.sites (id, account_id, host) values ($1, $2, 'gone-account.example')`,
      [site, accountId],
    );
    expect(children(await open(site, userId)).type).toBe(FirstCheckScreen);
    await db.query(`update public.accounts set deleted_at = now() where id = $1`, [accountId]);
    await expect(open(site, userId)).rejects.toMatchObject(notFoundError);
  });

  it('siteOfCaller itself refuses a deleted account, whatever the client lets it read', async () => {
    // Row security already hides a deleted account's site from its member (is_member_for_site
    // reads accounts.deleted_at). Read with a client that row security does not stop, the
    // entitlement read is what refuses it.
    const db = h.db as PGlite;
    const userId = await signUp(db, `deleted2-${randomUUID().slice(0, 8)}@example.com`);
    const { accountId } = await personalAccount(db, userId);
    const site = randomUUID();
    await db.query(
      `insert into public.sites (id, account_id, host) values ($1, $2, 'gone2.example')`,
      [site, accountId],
    );
    const unguarded = postgrestOver(db);
    const now = new Date();
    expect(await siteOfCaller(unguarded, userId, site, now)).not.toBeNull();
    await db.query(`update public.accounts set deleted_at = now() where id = $1`, [accountId]);
    expect(await siteOfCaller(unguarded, userId, site, now)).toBeNull();
  });

  it('the other account’s owner opens their own site and not this one', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    expect(children(await open(theirs, strangerId)).type).toBe(FirstCheckScreen);
    await expect(open(kept, strangerId)).rejects.toMatchObject(notFoundError);
  });
});
