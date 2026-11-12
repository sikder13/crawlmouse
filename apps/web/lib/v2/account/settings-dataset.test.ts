/**
 * The Settings and Trial ending dataset read from the database (CC-27b D6, D8). Run on PGlite with
 * every migration applied: the caller's client through the PostgREST stand-in as that user (row
 * security and column grants apply), the service role's reads through the pipeline's PGlite reader.
 * The check rows come from persisting the engine's recorded build, so they are what the pipeline writes.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { buildCheck, type BuiltCheck } from '@crawlmouse/engine/v2/pipeline';
import {
  AccountSchema,
  AlertRuleSchema,
  ReportSchema,
  type BatchResult,
  type CrawlPage,
  type FixtureDataset,
} from '@crawlmouse/types/v2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordedBuild } from '../../../../../packages/engine/fixtures/v2/build/recorded';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { ACCOUNT_VIEWERS, DATASET } from '../../../app/(v2-preview)/v2-preview/_preview/accounts';
import { fixture } from '../fixtures';
import { pageVantage, persistBuiltCheck } from '../pipeline/persist';
import {
  pgliteCheckReader,
  pglitePersistDb,
  seedRunningCheck,
} from '../pipeline/test-support/pglite';
import { deleteStepView, settingsView } from '../view/settings';
import { trialEndView, trialEndViewer } from '../view/trial-end';
import { loadSettingsDataset, viewInput } from './settings-dataset';

let db: PGlite;
let built: BuiltCheck;
let owner: { userId: string; accountId: string; seatId: string };
const NOW = new Date(Date.now() + 60_000);
const MONTHLY = { cadence: 'monthly', iso_weekday: 4, hour_local: 6 } as const;

const crawlRows = (batches: readonly unknown[]): CrawlPage[] =>
  (batches as BatchResult[]).flatMap((b) => (b.kind === 'crawl' ? b.pages : []));

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  const userId = await signUp(db, `owner-${randomUUID().slice(0, 8)}@example.com`);
  owner = { userId, ...(await personalAccount(db, userId)) };
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
    // A first check: the build read no fix.
    read: [],
  });
  await db.query(
    `insert into public.alert_rules (account_id, site_id, kind, enabled) values ($1, null, 'crawler_blocked', true)`,
    [owner.accountId],
  );
}, 300_000);
afterAll(async () => {
  await db.close();
});

const load = (userId: string, accountId = owner.accountId) =>
  loadSettingsDataset(
    {
      session: postgrestOver(db, { as: { userId } }),
      admin: postgrestOver(db),
      records: pgliteCheckReader(db),
    },
    accountId,
    NOW,
  );

describe('loadSettingsDataset as the owner', () => {
  it('reads the account with its owner’s address, its site and its check records', async () => {
    const { d, billingEnd } = await load(owner.userId);
    expect(AccountSchema.safeParse(d.accounts[0]).success).toBe(true);
    expect(d.accounts[0]!.id).toBe(owner.accountId);
    expect(d.accounts[0]!.email).toMatch(/^owner-/);
    expect(d.sites.map((s) => s.id)).toEqual([built.check.site_id]);
    expect(d.checks.map((c) => c.id)).toEqual([built.check.id]);
    expect(d.fixes).toHaveLength(built.fixes.length);
    expect(d.changes).toHaveLength(built.changes.length);
    expect(d.alert_rules.map((r) => [r.kind, r.site_id])).toEqual([['crawler_blocked', null]]);
    for (const r of d.alert_rules) expect(AlertRuleSchema.safeParse(r).success).toBe(true);
    for (const r of d.reports) expect(ReportSchema.safeParse(r).success).toBe(true);
    expect(billingEnd).toBeNull();
  });

  it('Settings and the delete step render from it', async () => {
    const { d } = await load(owner.userId);
    const viewer = { accountId: owner.accountId, now: NOW.toISOString() };
    const v = settingsView(viewInput(d), viewer);
    expect(v.plan.usage[0]).toEqual(['Sites', '1 of 1']);
    expect(deleteStepView(viewInput(d), viewer).field.expected).toBe(d.sites[0]!.host);
  });

  it('reads another account as nothing: row security hides it', async () => {
    const stranger = await signUp(db, `stranger-${randomUUID().slice(0, 8)}@example.com`);
    await expect(load(stranger)).rejects.toThrow(/no account/);
  });
});

describe('a removed site', () => {
  it('is not read: the account’s live sites only', async () => {
    const userId = await signUp(db, `removed-${randomUUID().slice(0, 8)}@example.com`);
    const { accountId } = await personalAccount(db, userId);
    await db.query(
      `insert into public.sites (account_id, host, removed_at) values ($1, 'gone.example', now())`,
      [accountId],
    );
    await db.query(`insert into public.sites (account_id, host) values ($1, 'kept.example')`, [
      accountId,
    ]);
    const { d } = await load(userId, accountId);
    expect(d.sites.map((s) => s.host)).toEqual(['kept.example']);
  });
});

describe('an account with no site', () => {
  it('reads an empty site list, and the plan card still answers', async () => {
    const userId = await signUp(db, `empty-${randomUUID().slice(0, 8)}@example.com`);
    const { accountId } = await personalAccount(db, userId);
    const { d } = await load(userId, accountId);
    expect(d.sites).toEqual([]);
    const v = settingsView(viewInput(d), { accountId, now: NOW.toISOString() });
    expect(v.plan.usage[0]).toEqual(['Sites', '0 of 1']);
  });
});

describe('a subscription set to end at its period’s end', () => {
  it('hands back the period’s end, and the account no renewal date', async () => {
    const userId = await signUp(db, `cancelling-${randomUUID().slice(0, 8)}@example.com`);
    const { accountId } = await personalAccount(db, userId);
    const ends = '2026-12-10T12:00:00.000Z';
    await db.query(
      `insert into public.subscriptions (id, account_id, status, plan, interval, current_period_end,
                                         cancel_at_period_end)
       values ('sub_cancelling', $1, 'active', 'pro', 'month', $2, true)`,
      [accountId, ends],
    );
    await db.query(
      `update public.accounts set state = 'pro', tier = 'pro', current_subscription_id = 'sub_cancelling',
              state_history = state_history || jsonb_build_array(jsonb_build_object('state', 'pro', 'since', now()))
        where id = $1`,
      [accountId],
    );
    const { d, billingEnd } = await load(userId, accountId);
    expect(billingEnd).toBe(ends);
    expect(d.accounts[0]!.renews_at).toBeNull();
    await db.query(
      `update public.subscriptions set cancel_at_period_end = false where id = 'sub_cancelling'`,
    );
    expect((await load(userId, accountId)).billingEnd).toBeNull();
  });
});

describe('what the screens read: measured on the fixtures', () => {
  // The loader leaves these collections empty. Emptying them leaves every model the pages render
  // unchanged, so none of the views reads them.
  const LEFT_EMPTY = [
    'page_results',
    'link_edges',
    'access_tests',
    'lineages',
    'usage_events',
    'withheld',
    'engine_derived',
  ] as const;
  const emptied = (d: FixtureDataset): FixtureDataset => ({
    ...d,
    ...Object.fromEntries(LEFT_EMPTY.map((k) => [k, []])),
    accounts: d.accounts.map((a) => ({ ...a, api_keys: [], branding: null })),
  });

  it('Settings and the delete step give the same models, on both previews’ accounts', () => {
    for (const name of ['home', 'clean'] as const) {
      const d = fixture(DATASET[name]);
      const viewer = ACCOUNT_VIEWERS[name]();
      expect(settingsView(emptied(d), viewer)).toEqual(settingsView(d, viewer));
      expect(deleteStepView(emptied(d), viewer)).toEqual(deleteStepView(d, viewer));
    }
  });

  it('Trial ending gives the same model', () => {
    const d = fixture('bad-site');
    const viewer = trialEndViewer(d, ACCOUNT_VIEWERS.home().accountId);
    expect(trialEndView(emptied(d), viewer)).toEqual(trialEndView(d, viewer));
  });

  it('the fixture holds rows in each emptied collection, so the comparison can fail', () => {
    const d = fixture('bad-site');
    for (const k of ['page_results', 'link_edges', 'access_tests', 'lineages'] as const)
      expect(d[k].length, k).toBeGreaterThan(0);
  });

  it('Trial ending does read the alert rules and the reports the loader fills', () => {
    const d = fixture('bad-site');
    const viewer = trialEndViewer(d, ACCOUNT_VIEWERS.home().accountId);
    const base = trialEndView(d, viewer);
    expect(trialEndView({ ...d, alert_rules: [] }, viewer)).not.toEqual(base);
    expect(trialEndView({ ...d, reports: [] }, viewer)).not.toEqual(base);
  });
});
