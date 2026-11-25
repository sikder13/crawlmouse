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

const h = vi.hoisted(() => ({
  db: null as unknown,
  userId: null as string | null,
  /** The switcher cookie's value on this request, or null for none. */
  chosen: null as string | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'cm_account' && h.chosen !== null ? { name, value: h.chosen } : undefined,
  }),
}));
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
import { parseDeployHook, verifyDeployHook } from '@/lib/v2/account/deploy-hook';
import { SITE_COPY } from '@/lib/v2/copy/site';
import { siteOfCaller } from '@/lib/v2/account/pages';
import { makePaid } from '@/lib/v2/account/sites-test-support';
import { agencyAccount } from '@/lib/v2/agency/test-support';
import type { ShellView } from '@/lib/v2/view/account-shell';
import { dayDate, hourMinute } from '@/lib/v2/format';
import SitePage from './page';

let db: PGlite;
let ownerId: string;
let strangerId: string;
let kept: string;
/** The personal account's first site; the session here carries no email, so its name (D-22). */
let keptHost: string;
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
  keptHost = input.site.host;
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

afterEach(() => {
  vi.unstubAllEnvs();
  h.chosen = null;
});

const open = (id: string, userId: string | null = ownerId, search: Record<string, string> = {}) => {
  h.userId = userId;
  return SitePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(search) });
};
const notFoundError = { digest: expect.stringMatching(/404/) };
const children = (el: unknown) =>
  (el as ReactElement<{ children: ReactElement<{ notice?: unknown }> }>).props.children;
/** The frame a rendered screen carries: the site screen's own prop, or the first-check view's. */
const shellOf = (screen: ReactElement) => {
  const props = screen.props as { shell?: ShellView; data: { shell: ShellView } };
  return props.shell ?? props.data.shell;
};

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

  it('shows a deploy hook the route accepts, signed over the staging row as the route reads it', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    vi.stubEnv('DEPLOY_HOOK_SECRET', 'h'.repeat(40));
    const staging = randomUUID();
    // The hook is a paid plan's: the account is Pro for this case, and put back as it was after.
    const COLUMNS =
      'state, tier, site_limit, seat_limit, competitor_limit, current_subscription_id, state_history';
    const { rows: acct } = await db.query<{ id: string }>(
      `select account_id as id from public.sites where id = $1`,
      [kept],
    );
    const accountId = acct[0]!.id;
    const { rows: before } = await db.query<Record<string, unknown>>(
      `select ${COLUMNS} from public.accounts where id = $1`,
      [accountId],
    );
    await makePaid(db, accountId, 'pro');
    // Microseconds, as Postgres keeps them: the page and the route must round them the same way.
    await db.query(
      `insert into public.sites (id, account_id, host, staging_of_site_id, created_at)
       select $1, account_id, 'staging.example', id, '2026-11-10 12:34:56.123999+00'
         from public.sites where id = $2`,
      [staging, kept],
    );
    try {
      const page = children(await open(kept)) as ReactElement<{
        data: { settings: { rows: { label: string; value: string }[] } };
      }>;
      const row = page.props.data.settings.rows.find((r) => r.label === 'Deploy hook');
      const path = /\/api\/hooks\/deploy\/(\S+)/.exec(row?.value ?? '')?.[1];
      const hook = parseDeployHook(path ?? '');
      expect(hook?.siteId).toBe(staging);
      // The row the route reads, through the same client.
      const { data } = await postgrestOver(db)
        .from('sites')
        .select('id, created_at')
        .eq('id', staging)
        .maybeSingle();
      expect(
        verifyDeployHook(hook!.signature, staging, data!.created_at as string, 'h'.repeat(40)),
      ).toBe(true);
      // With the RISK switch hiding staging deploys, the row is not drawn at all.
      vi.stubEnv('V2_HIDE_FEATURES', 'staging_deploys');
      const hidden = children(await open(kept)) as ReactElement<{
        data: { settings: { rows: { label: string }[] } };
      }>;
      expect(hidden.props.data.settings.rows.map((r) => r.label)).not.toContain('Deploy hook');
    } finally {
      await db.query(`delete from public.sites where id = $1`, [staging]);
      const b = before[0]!;
      await db.query(
        `update public.accounts set (${COLUMNS}) = ($2, $3, $4, $5, $6, $7, $8) where id = $1`,
        [
          accountId,
          b.state,
          b.tier,
          b.site_limit,
          b.seat_limit,
          b.competitor_limit,
          b.current_subscription_id,
          JSON.stringify(b.state_history),
        ],
      );
    }
  });

  it('a taken-down report of this host: the page offers no new public link', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const row = async () => {
      const page = children(await open(kept));
      const { data } = page.props as unknown as {
        data: {
          settings: { rows: { label: string; publicLink?: { mintCheckId: string | null } }[] };
        };
      };
      return data.settings.rows.find((r) => r.label === 'Public link');
    };
    expect((await row())?.publicLink?.mintCheckId).toEqual(expect.any(String));
    const { rows } = await db.query<{ host: string }>(
      `select host from public.sites where id = $1`,
      [kept],
    );
    await db.query(
      `insert into public.public_reports (slug, domain, takedown_requested_at)
       values ('page-test-down', $1, now())`,
      [rows[0]!.host],
    );
    expect((await row())?.publicLink?.mintCheckId).toBeNull();
    await db.query(`delete from public.public_reports where slug = 'page-test-down'`);
  });

  it('the latest check’s own link hidden: the page offers no new one, and says why', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    const { rows } = await db.query<{ id: string; account_id: string }>(
      `select c.id, s.account_id from public.checks c join public.sites s on s.id = c.site_id
        where c.site_id = $1 and c.status = 'finished' order by c.finished_at desc limit 1`,
      [kept],
    );
    await db.query(
      `insert into public.public_reports (slug, check_id, site_id, account_id, domain, hidden_at)
       values ('page-test-hidden', $1, $2, $3, 'hidden-page.example', now())`,
      [rows[0]!.id, kept, rows[0]!.account_id],
    );
    const page = children(await open(kept));
    await db.query(`delete from public.public_reports where slug = 'page-test-hidden'`);
    const { data } = page.props as unknown as {
      data: {
        settings: {
          rows: { label: string; value: string; publicLink?: { mintCheckId: string | null } }[];
        };
      };
    };
    const row = data.settings.rows.find((r) => r.label === 'Public link')!;
    expect(row.publicLink?.mintCheckId).toBeNull();
    expect(row.value).toBe(SITE_COPY.publicLink.hiddenLatest);
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

  it('a person with one seat has no switcher in the rail', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    expect(shellOf(children(await open(kept))).switcher).toBeNull();
    expect(shellOf(children(await open(empty))).switcher).toBeNull();
  });

  describe('for a person with a seat on a second account', () => {
    let agencyId: string;
    let client: string;
    let ownId: string;

    beforeAll(async () => {
      const db = h.db as PGlite;
      ownId = (await personalAccount(db, ownerId)).accountId;
      agencyId = (await agencyAccount(db, { id: ownerId, email: 'owner@example.com' })).accountId;
      // The personal account on a Pro trial: its rail's card links to billing (or has Keep).
      const ends = new Date(Date.now() + 9 * 86_400_000).toISOString();
      await db.query(
        `update public.accounts set state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
           trial_ends_at = $2, trial_used_at = now(),
           state_history = state_history || jsonb_build_array(jsonb_build_object('state', 'pro_trial', 'since', now()::text))
         where id = $1`,
        [ownId, ends],
      );
      client = randomUUID();
      await db.query(
        `insert into public.sites (id, account_id, host) values ($1, $2, 'client.example')`,
        [client, agencyId],
      );
    });

    it('acting in the site’s account: the rail names it and lists the other', async () => {
      vi.stubEnv('V2_CHECKS_PUBLIC', '1');
      h.chosen = agencyId;
      expect(shellOf(children(await open(client))).switcher).toMatchObject({
        current: 'Summit Digital',
        visiting: null,
        others: [{ label: keptHost, fields: { accountId: ownId } }],
      });
      // No cookie: the person acts in their default, personal account, whose site this is.
      h.chosen = null;
      for (const site of [kept, empty]) {
        const shell = shellOf(children(await open(site)));
        expect(shell.switcher).toMatchObject({ current: keptHost, visiting: null });
        expect(shell.trial!.keep ?? shell.trial!.billing).not.toBeNull();
      }
    });

    it('a developer’s seat, acting in the site’s account, is shown neither Keep nor a billing link', async () => {
      vi.stubEnv('V2_CHECKS_PUBLIC', '1');
      const db = h.db as PGlite;
      const email = `dev-${randomUUID().slice(0, 8)}@example.com`;
      const devId = await signUp(db, email);
      await db.query(
        `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
         values ($1, $2, $3, 'developer', 'active', now())`,
        [ownId, devId, email],
      );
      h.chosen = ownId;
      for (const site of [kept, empty]) {
        // The owner, on the same pages, is offered one of the two (the case above).
        const shell = shellOf(children(await open(site, devId)));
        expect(shell.switcher).toMatchObject({ visiting: null });
        expect(shell.trial).toMatchObject({ keep: null, billing: null });
      }
    });

    it('acting in another account: the rail offers the switch to the site’s, with no Keep and no billing link', async () => {
      vi.stubEnv('V2_CHECKS_PUBLIC', '1');
      // The person acts in the agency and opens their personal account's sites by address: one
      // with a result (the site screen takes the frame as a prop) and one with no check yet.
      h.chosen = agencyId;
      for (const site of [kept, empty]) {
        const shell = shellOf(children(await open(site)));
        expect(shell.switcher!.visiting).toMatchObject({
          acting: 'Summit Digital',
          switchTo: {
            label: `Switch to ${keptHost}`,
            href: '/api/seats/switch',
            fields: { accountId: ownId },
          },
        });
        expect(shell.trial).toMatchObject({ keep: null, billing: null });
      }
      // And the other way: acting in the personal account, on the agency's site.
      h.chosen = null;
      expect(shellOf(children(await open(client))).switcher!.visiting!.switchTo.fields).toEqual({
        accountId: agencyId,
      });
    });
  });

  it('the other account’s owner opens their own site and not this one', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    expect(children(await open(theirs, strangerId)).type).toBe(FirstCheckScreen);
    await expect(open(kept, strangerId)).rejects.toMatchObject(notFoundError);
  });
});
