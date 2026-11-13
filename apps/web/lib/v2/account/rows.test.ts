/**
 * The contract Account and Seat built from their tables' rows (CC-26b R12). The rows are written on
 * PGlite with every migration applied and read back through the PostgREST stand-in as the service
 * role, so each builder is fed what supabase-js returns for the real schema.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { AccountSchema, SeatSchema } from '@crawlmouse/types/v2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GATES } from '../../entitlement-v2';
import { applyAllMigrations, freshDb } from '../../../__tests__/helpers/pglite-migrations';
import { postgrestOver } from '../../../__tests__/helpers/postgrest-pglite';
import { seedWorld, SHA, type World } from '../../../__tests__/helpers/v2-check-tables';
import { accountFromRow, seatFromRow } from './rows';

let db: PGlite;
let world: World;

// Closed when the file ends: a PGlite holds its memory outside the JS heap until then.
afterAll(async () => {
  await db?.close();
});

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  world = await seedWorld(db, 'rows');
}, 300_000);

type Row = Record<string, unknown>;

async function one(table: string, column: string, value: string): Promise<Row> {
  const { data, error } = await postgrestOver(db)
    .from(table)
    .select('*')
    .eq(column, value)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data === null) throw new Error(`no ${table} row ${value}`);
  return data as Row;
}

async function all(table: string, column: string, value: string): Promise<Row[]> {
  const { data, error } = await postgrestOver(db).from(table).select('*').eq(column, value);
  if (error) throw new Error(error.message);
  return data as Row[];
}

const ownerEmail = async (w: World) => (await one('users', 'id', w.ownerId)).email as string;

describe('accountFromRow', () => {
  it('builds a new Free account, valid under AccountSchema, each field from its column', async () => {
    const row = await one('accounts', 'id', world.accountId);
    const keys = await all('api_keys', 'account_id', world.accountId);
    const a = accountFromRow({
      account: row,
      email: await ownerEmail(world),
      subscription: null,
      apiKeys: keys,
      brand: null,
    });
    expect(AccountSchema.safeParse(a).success).toBe(true);
    expect(a.id).toBe(world.accountId);
    expect(a.email).toMatch(/^owner-rows-/);
    expect(a.state).toBe('free');
    expect(a.state_history).toHaveLength(1);
    expect(a.state_history[0]!.state).toBe('free');
    expect(a.trial_ends_at).toBeNull();
    expect(a.renews_at).toBeNull();
    expect(a.billing_period_months).toBeNull();
    expect(a.timezone).toBe('UTC');
    expect(a.limits).toEqual({
      sites: 1,
      seats: 1,
      pages_per_audit: GATES.free.pagesPerCheck,
      competitors_per_site: 0,
      full_renders_per_month: GATES.free.fullRendersPerMonth,
    });
    expect(a.email_prefs).toEqual({ change_notes: true, trial_reminder: true });
    expect(a.integrations).toEqual([]);
    expect(a.api_keys).toEqual([
      { prefix: 'cm_ro_ab12cd', created_at: expect.any(String), last_used_at: null },
    ]);
    expect(a.branding).toBeNull();
    expect(a.agency_trial_consent).toBeNull();
  });

  it('leaves a revoked API key out', async () => {
    const row = await one('accounts', 'id', world.accountId);
    const keys = await all('api_keys', 'account_id', world.accountId);
    const revoked = { ...keys[0]!, prefix: 'cm_ro_dead', revoked_at: '2026-11-01T00:00:00.000Z' };
    const a = accountFromRow({
      account: row,
      email: 'a@example.com',
      subscription: null,
      apiKeys: [...keys, revoked],
      brand: null,
    });
    expect(a.api_keys.map((k) => k.prefix)).toEqual(['cm_ro_ab12cd']);
  });

  it('reads a paid account: renewal and period from its current subscription', async () => {
    const w = await seedWorld(db, 'paid');
    const sub = `sub_${randomUUID().replace(/-/g, '')}`;
    await db.query(
      `insert into public.subscriptions (id, account_id, status, plan, interval, current_period_end)
       values ($1, $2, 'active', 'pro', 'year', '2027-11-10T00:00:00Z')`,
      [sub, w.accountId],
    );
    await db.query(
      `update public.accounts
          set state = 'pro', tier = 'pro', current_subscription_id = $2, card_last4 = '4242',
              site_limit = 5, seat_limit = 2, competitor_limit = 1, timezone = 'Europe/London',
              email_trial_reminder = false,
              state_history = state_history || jsonb_build_array(jsonb_build_object(
                'state', 'pro', 'since', '2099-11-05T10:00:00.000+00:00'))
        where id = $1`,
      [w.accountId, sub],
    );
    const a = accountFromRow({
      account: await one('accounts', 'id', w.accountId),
      email: await ownerEmail(w),
      subscription: await one('subscriptions', 'id', sub),
      apiKeys: [],
      brand: null,
    });
    expect(AccountSchema.safeParse(a).success).toBe(true);
    expect(a.state).toBe('pro');
    expect(a.state_history.at(-1)).toEqual({ state: 'pro', since: '2099-11-05T10:00:00.000Z' });
    expect(a.card_last4).toBe('4242');
    expect(a.renews_at).toBe('2027-11-10T00:00:00.000Z');
    expect(a.billing_period_months).toBe(12);
    expect(a.timezone).toBe('Europe/London');
    expect(a.limits.sites).toBe(5);
    expect(a.limits.pages_per_audit).toBe(GATES.pro.pagesPerCheck);
    expect(a.email_prefs).toEqual({ change_notes: true, trial_reminder: false });
  });

  it('a subscription set to cancel does not renew; a monthly one is 1 month', async () => {
    const w = await seedWorld(db, 'cancel');
    const row = await one('accounts', 'id', w.accountId);
    const sub = (cancel: boolean): Row => ({
      id: 'sub_x',
      interval: 'month',
      current_period_end: '2026-12-10T00:00:00.000Z',
      cancel_at_period_end: cancel,
    });
    const build = (s: Row) =>
      accountFromRow({
        account: row,
        email: 'a@example.com',
        subscription: s,
        apiKeys: [],
        brand: null,
      });
    expect(build(sub(false)).renews_at).toBe('2026-12-10T00:00:00.000Z');
    expect(build(sub(false)).billing_period_months).toBe(1);
    expect(build(sub(true)).renews_at).toBeNull();
  });

  it('builds the branding from agency_brands', async () => {
    const w = await seedWorld(db, 'brand');
    await db.query(
      `insert into public.agency_brands (account_id, agency_name, accent_hex, portal_domain,
         portal_txt_verified_at, portal_cname_found, sender_from, spf_passes, dkim_passes,
         dmarc_policy, postal_address)
       values ($1, 'Northwind', '#112233', 'reports.northwind.example', now(), false,
         'hello@northwind.example', true, false, 'none', '1 Main St')`,
      [w.accountId],
    );
    const a = accountFromRow({
      account: await one('accounts', 'id', w.accountId),
      email: 'a@example.com',
      subscription: null,
      apiKeys: [],
      brand: await one('agency_brands', 'account_id', w.accountId),
    });
    expect(AccountSchema.safeParse(a).success).toBe(true);
    expect(a.branding).toEqual({
      agency_name: 'Northwind',
      logo_url: null,
      accent_hex: '#112233',
      portal_domain: 'reports.northwind.example',
      dns: { txt_found: true, cname_found: false, certificate_issued_at: null },
      sender_email: 'hello@northwind.example',
      email_auth: { spf_passes: true, dkim_passes: false, dmarc_policy: 'none' },
      open_tracking_default: false,
      postal_address: '1 Main St',
    });
  });

  it('refuses a stored logo it has no URL for, rather than drop it', async () => {
    const w = await seedWorld(db, 'logo');
    await db.query(
      `insert into public.agency_brands (account_id, agency_name, logo_path) values ($1, 'L', 'x/logo.png')`,
      [w.accountId],
    );
    const account = await one('accounts', 'id', w.accountId);
    const brand = await one('agency_brands', 'account_id', w.accountId);
    const build = (b: Row) =>
      accountFromRow({
        account,
        email: 'a@example.com',
        subscription: null,
        apiKeys: [],
        brand: b,
      });
    expect(build({ ...brand, logo_path: null }).branding?.logo_url).toBeNull();
    expect(() => build(brand)).toThrow(/logo/);
  });

  it('an account whose history holds an Agency trial holds its consent, and is refused with none recorded', async () => {
    const row = await one('accounts', 'id', world.accountId);
    const history = [
      ...(row.state_history as Row[]),
      { state: 'agency_trial', since: '2099-11-01T00:00:00.000Z' },
      { state: 'free', since: '2099-11-08T00:00:00.000Z' },
    ];
    const rows = {
      account: { ...row, state_history: history },
      email: 'a@example.com',
      subscription: null,
      apiKeys: [],
      brand: null,
    };
    // As PostgREST answers a timestamptz, and as the service role's read hands it on.
    const consented = accountFromRow({ ...rows, trialConsentAt: '2099-10-31T23:58:00+00:00' });
    expect(consented.agency_trial_consent).toEqual({ recorded_at: '2099-10-31T23:58:00Z' });
    for (const none of [{}, { trialConsentAt: null }]) {
      expect(() => accountFromRow({ ...rows, ...none })).toThrow(
        /had an Agency trial and its consent is not recorded/,
      );
    }
  });

  it('an account that had no Agency trial holds no consent, whatever the column holds', async () => {
    // The form records the tick before Checkout: an account whose Checkout was never finished has
    // the time and no trial, and the contract holds a consent for a trial only.
    const row = await one('accounts', 'id', world.accountId);
    const built = accountFromRow({
      account: row,
      email: 'a@example.com',
      subscription: null,
      apiKeys: [],
      brand: null,
      trialConsentAt: '2099-10-31T23:58:00+00:00',
    });
    expect(built.agency_trial_consent).toBeNull();
  });

  it('a row the contract refuses throws', () => {
    expect(() =>
      accountFromRow({
        account: { id: 'not-a-uuid' },
        email: 'a@example.com',
        subscription: null,
        apiKeys: [],
        brand: null,
      }),
    ).toThrow();
  });
});

describe('seatFromRow', () => {
  it('builds the owner seat: all clients, the invited address, valid under SeatSchema', async () => {
    const row = await one('seats', 'id', world.ownerSeatId);
    const s = seatFromRow(row, []);
    expect(SeatSchema.safeParse(s).success).toBe(true);
    expect(s).toEqual({
      id: world.ownerSeatId,
      account_id: world.accountId,
      email: row.invited_email,
      name: null,
      role: 'owner',
      client_scope: 'all',
      alert_channels: ['email'],
      theme: 'system',
      invited_at: expect.any(String),
      accepted_at: expect.any(String),
    });
  });

  it('a scoped seat lists the sites of its seat_sites rows', async () => {
    const row = await one('seats', 'id', world.scopedSeatId);
    const links = await all('seat_sites', 'seat_id', world.scopedSeatId);
    const s = seatFromRow(
      row,
      links.map((l) => l.site_id as string),
    );
    expect(SeatSchema.safeParse(s).success).toBe(true);
    expect(s.role).toBe('developer');
    expect(s.client_scope).toEqual([world.site1]);
  });

  it('a scoped seat with no site is refused: the contract has no empty scope', async () => {
    const row = await one('seats', 'id', world.scopedSeatId);
    expect(() => seatFromRow(row, [])).toThrow(/scope/);
  });

  it('an unscoped seat ignores stray site ids', async () => {
    const row = await one('seats', 'id', world.ownerSeatId);
    expect(seatFromRow(row, [world.site1]).client_scope).toBe('all');
  });

  it('an invited seat has no accepted_at', async () => {
    const id = randomUUID();
    await db.query(
      `insert into public.seats (id, account_id, invited_email, role, status, invite_token_hash,
                                 invite_expires_at)
       values ($1, $2, 'new@example.com', 'developer', 'invited', $3, now() + interval '7 days')`,
      [id, world.accountId, SHA(77)],
    );
    const s = seatFromRow(await one('seats', 'id', id), []);
    expect(s.accepted_at).toBeNull();
    expect(s.email).toBe('new@example.com');
  });
});
