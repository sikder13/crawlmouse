import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import {
  ROWS,
  insertRow,
  personalAccount,
  prepareMeasurement,
  signUp,
} from '../../../__tests__/helpers/v2-check-tables';
import { supabaseAlertStore } from './alerts-store';
import { supabaseSummaryStore } from './summary-store';

/**
 * The alert and summary ports over the service-role client (alerts-store.ts, summary-store.ts), run
 * through PostgREST's calls against the migrated schema (review r1, test quality B2): the stand-in
 * answers each query builder call the way supabase-js does, and caps every read at 1,000 rows, as
 * `max_rows` in infra/supabase/config.toml caps production's.
 */

const MAX_ROWS = 1000;
let db: PGlite;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  await prepareMeasurement(db);
}, 300_000);
afterAll(async () => db.close());

const client = () => postgrestOver(db, { maxRows: MAX_ROWS });

async function paidAccount(timezone = 'UTC') {
  const email = `st-${randomUUID()}@example.com`;
  const userId = await signUp(db, email);
  const { accountId, seatId } = await personalAccount(db, userId);
  await db.query(
    `update public.accounts
        set timezone = $2, state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
            trial_ends_at = now() + interval '7 days', trial_used_at = now(),
            state_history = state_history || jsonb_build_array(
              jsonb_build_object('state', 'pro_trial', 'since', now()))
      where id = $1`,
    [accountId, timezone],
  );
  return { userId, accountId, seatId, email };
}

async function site(accountId: string | null) {
  const siteId = randomUUID();
  await insertRow(db, 'sites', ROWS.sites(siteId, accountId, `${siteId.slice(0, 8)}.example`));
  return siteId;
}

async function check(siteId: string, previous: string | null = null) {
  const id = randomUUID();
  await insertRow(db, 'checks', { ...ROWS.checks(id, siteId), previous_check_id: previous });
  return id;
}

const mark = (accountId: string, column: 'deletion_confirmed_at' | 'deleted_at') =>
  db.query(
    column === 'deleted_at'
      ? `update public.accounts set deleted_at = now() where id = $1`
      : `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days' where id = $1`,
    [accountId],
  );

describe('supabaseAlertStore.context', () => {
  it('reads a kept site’s later check: its account, zone, host, channel, and not first', async () => {
    const a = await paidAccount('Europe/Berlin');
    const s = await site(a.accountId);
    await db.query(`update public.sites set slack_channel = '#seo' where id = $1`, [s]);
    const first = await check(s);
    const second = await check(s, first);
    expect(await supabaseAlertStore(client()).context(second)).toEqual({
      checkId: second,
      siteId: s,
      accountId: a.accountId,
      siteRemoved: false,
      accountMarked: false,
      previousCheckId: first,
      firstCheck: false,
      finished: true,
      host: `${s.slice(0, 8)}.example`,
      slackChannel: '#seo',
      finishedAt: ROWS.checks(second, s).finished_at,
      zone: 'Europe/Berlin',
    });
  });

  it('reads a site’s first check as first', async () => {
    const a = await paidAccount();
    const c = await check(await site(a.accountId));
    expect(await supabaseAlertStore(client()).context(c)).toMatchObject({
      firstCheck: true,
      previousCheckId: null,
    });
  });

  it('reads an account marked for deletion, or deleted, as marked', async () => {
    for (const column of ['deletion_confirmed_at', 'deleted_at'] as const) {
      const a = await paidAccount();
      const s = await site(a.accountId);
      const c = await check(s, await check(s));
      const store = supabaseAlertStore(client());
      expect((await store.context(c))?.accountMarked).toBe(false);
      await mark(a.accountId, column);
      expect((await store.context(c))?.accountMarked).toBe(true);
    }
  });

  it('reads a removed site, an audit nobody kept, and no such check', async () => {
    const a = await paidAccount();
    const s = await site(a.accountId);
    const later = await check(s, await check(s));
    const store = supabaseAlertStore(client());
    expect((await store.context(later))?.siteRemoved).toBe(false);
    await db.query(`update public.sites set removed_at = now() where id = $1`, [s]);
    expect((await store.context(later))?.siteRemoved).toBe(true);
    const unkept = await check(await site(null));
    expect(await store.context(unkept)).toMatchObject({ accountId: null, accountMarked: false });
    expect(await store.context(randomUUID())).toBeNull();
  });
});

describe('supabaseAlertStore.slackUrl', () => {
  it('answers the URL for a paid account, and null once the account is marked', async () => {
    const a = await paidAccount();
    const url = 'https://hooks.slack.com/services/T0000/B0000/storeAdapter1';
    await db.query(`select public.set_account_slack_webhook($1, $2)`, [a.accountId, url]);
    const store = supabaseAlertStore(client());
    expect(await store.slackUrl(a.accountId, new Date())).toBe(url);
    await mark(a.accountId, 'deletion_confirmed_at');
    expect(await store.slackUrl(a.accountId, new Date())).toBeNull();
  });
});

describe('supabaseSummaryStore.account', () => {
  it('reads the zone, and an account marked for deletion, or deleted, as marked', async () => {
    const store = supabaseSummaryStore(client(), () => {});
    for (const column of ['deletion_confirmed_at', 'deleted_at'] as const) {
      const a = await paidAccount('America/New_York');
      expect(await store.account(a.accountId)).toEqual({
        marked: false,
        zone: 'America/New_York',
      });
      await mark(a.accountId, column);
      expect((await store.account(a.accountId))?.marked).toBe(true);
    }
    expect(await store.account(randomUUID())).toBeNull();
  });

  it('reads a zone the runtime does not know as UTC', async () => {
    const a = await paidAccount();
    await db.query(`update public.accounts set timezone = 'Mars/Olympus' where id = $1`, [
      a.accountId,
    ]);
    expect((await supabaseSummaryStore(client(), () => {}).account(a.accountId))?.zone).toBe('UTC');
  });
});
