import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import { fakeCatalog, fakePriceId } from '@/lib/billing/catalog.fake';
import { stripeSubscription } from '@/lib/billing/stripe.fake';
import { GATES } from '@/lib/entitlement-v2';
import {
  addSeat,
  adminOver,
  keptSite,
  makePaid,
  person,
  sessionOver,
  type Person,
} from '@/lib/v2/account/sites-test-support';
import { fakeExtrasStripe, type FakeExtrasStripe } from '@/lib/v2/agency/extras.fake';
import { agencyAccount } from '@/lib/v2/agency/test-support';

// POST /api/billing/seats (CC-31 D4). The session and service-role clients are the PostgREST
// stand-in over PGlite with every migration applied, so `seat_may`, the entitlement read and the
// counts of seats and sites in use run for real. Stripe is a subscription in memory
// (lib/v2/agency/extras.fake.ts) and the catalog is CC-03's fake; no request leaves the process.

const h = vi.hoisted(() => ({
  log: [] as string[],
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  stripe: null as unknown as FakeExtrasStripe,
  capture: vi.fn(async (..._a: unknown[]) => undefined),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => {
    h.log.push('supabaseServer');
    return sessionOver(h.db, h.user);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    return adminOver(h.db);
  },
}));
vi.mock('@/lib/billing/stripe-account', () => ({
  stripeAccount: () => {
    h.log.push('stripeAccount');
    return h.stripe;
  },
}));
vi.mock('@/lib/billing/stripe-catalog', async (original) => ({
  ...(await original<typeof import('@/lib/billing/stripe-catalog')>()),
  accountCatalog: () => fakeCatalog(),
}));
vi.mock('@/lib/v2/agency/events', async (original) => ({
  ...(await original<typeof import('@/lib/v2/agency/events')>()),
  agencyCaptureFor: () => h.capture,
}));

import { POST } from './route';

const FORM = 'application/x-www-form-urlencoded';

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});

beforeEach(() => {
  h.log.length = 0;
  h.user = null;
  h.capture.mockClear();
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('V2_BILLING', '1');
});
afterEach(() => vi.unstubAllEnvs());

const as = (p: Pick<Person, 'id' | 'email'> | null) => {
  h.user = p && { id: p.id, email: p.email };
};

function post(body: string, type = 'application/json', cookie?: string): Request {
  return new Request('https://crawlmouse.com/api/billing/seats', {
    method: 'POST',
    headers: {
      origin: 'https://crawlmouse.com',
      'content-type': type,
      ...(cookie ? { cookie } : {}),
    },
    body,
  });
}

const buy = (v: unknown, cookie?: string) => POST(post(JSON.stringify(v), undefined, cookie));

interface Agency {
  owner: Person;
  accountId: string;
  subscriptionId: string;
}

/** A person who owns an Agency account whose subscription Stripe (the fake) and the mirror hold. */
async function agency(extras = { seats: 0, sites: 0 }): Promise<Agency> {
  const owner = await person(h.db, 'owner');
  const { accountId } = await agencyAccount(h.db, owner);
  const {
    rows: [a],
  } = await h.db.query<{ current_subscription_id: string }>(
    `select current_subscription_id from public.accounts where id = $1`,
    [accountId],
  );
  const subscriptionId = a!.current_subscription_id;
  await h.db.query(
    `insert into public.subscriptions (id, account_id, status, plan, interval, seat_quantity,
                                       extra_site_quantity, last_event_id)
     values ($1, $2, 'active', 'agency', 'month', $3, $4, 'evt_seed')`,
    [subscriptionId, accountId, extras.seats, extras.sites],
  );
  h.stripe = fakeExtrasStripe(
    stripeSubscription({
      id: subscriptionId,
      customer: 'cus_route',
      status: 'active',
      plan: 'agency',
      interval: 'month',
      ...extras,
      trialEnd: null,
      periodEnd: 1_900_000_000,
      cancelAtPeriodEnd: false,
    }),
  );
  return { owner, accountId, subscriptionId };
}

const limitsOf = async (accountId: string) =>
  (
    await h.db.query<{ seat_limit: number; site_limit: number }>(
      `select seat_limit, site_limit from public.accounts where id = $1`,
      [accountId],
    )
  ).rows[0]!;

/** The owner acts in the agency account: their switcher names it. */
const chosen = (a: Agency) => `cm_account=${a.accountId}`;

describe('POST /api/billing/seats', () => {
  it.each(['V2_CHECKS_PUBLIC', 'V2_BILLING'])(
    'with %s unset: 404 before anything else runs',
    async (flag) => {
      vi.stubEnv(flag, '');
      const a = await agency();
      as(a.owner);
      const res = await buy({ seats: 1, sites: 0 }, chosen(a));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ code: 'not_found' });
      expect(h.log).toEqual([]);
    },
  );

  it('signed out: 401, and neither a service-role client nor Stripe', async () => {
    const res = await buy({ seats: 1, sites: 0 });
    expect(res.status).toBe(401);
    expect(h.log).toEqual(['supabaseServer']);
  });

  it('the owner buys two seats and three sites: one Stripe update at the catalog’s prices, and no limit written here', async () => {
    const a = await agency();
    as(a.owner);
    const before = await limitsOf(a.accountId);
    const res = await buy({ seats: 2, sites: 3 }, chosen(a));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ seats: 2, sites: 3, changed: true });
    expect(h.stripe.updates).toHaveLength(1);
    expect(h.stripe.updates[0]!.id).toBe(a.subscriptionId);
    expect(h.stripe.updates[0]!.params.items).toEqual([
      { price: fakePriceId('crawlmouse_seat_monthly'), quantity: 2 },
      { price: fakePriceId('crawlmouse_site_monthly'), quantity: 3 },
    ]);
    // The limits are the webhook's to write, from the subscription Stripe confirms.
    expect(await limitsOf(a.accountId)).toEqual(before);
    expect(before).toEqual({ seat_limit: GATES.agency.seats, site_limit: GATES.agency.sites });
    expect(h.capture.mock.calls).toEqual([['seats_bought', a.accountId, { seats: 2, sites: 3 }]]);
  });

  it('sends seats_bought for a raise and not for a lowering alone, which buys nothing', async () => {
    const a = await agency({ seats: 2, sites: 3 });
    as(a.owner);
    const lowered = await buy({ seats: 1, sites: 3 }, chosen(a));
    expect(await lowered.json()).toEqual({ seats: 1, sites: 3, changed: true });
    expect(h.stripe.updates).toHaveLength(1);
    expect(h.capture).not.toHaveBeenCalled();
    // The quantities it already holds: no change, and no event.
    await buy({ seats: 1, sites: 3 }, chosen(a));
    expect(h.capture).not.toHaveBeenCalled();
    const raised = await buy({ seats: 1, sites: 4 }, chosen(a));
    expect(await raised.json()).toEqual({ seats: 1, sites: 4, changed: true });
    expect(h.capture.mock.calls).toEqual([['seats_bought', a.accountId, { seats: 1, sites: 4 }]]);
  });

  it('a form is answered with a 303 back to Seats', async () => {
    const a = await agency();
    as(a.owner);
    const res = await POST(post(`seats=1&sites=0&accountId=${a.accountId}`, FORM));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/seats?notice=extras_changed');
    expect(h.stripe.updates).toHaveLength(1);
  });

  it('a body cannot set a limit or name a price: 400, and Stripe is not asked', async () => {
    const a = await agency();
    as(a.owner);
    for (const body of [
      { seats: 1, sites: 0, seat_limit: 50 },
      { seats: 1, sites: 0, seatLimit: 50 },
      { seats: 1, sites: 0, site_limit: 50 },
      { seats: 1, sites: 0, price: 'price_other' },
      { seats: -1, sites: 0 },
      { seats: 1 },
      {},
    ]) {
      const res = await buy(body, chosen(a));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    // More than the plan sells is read as a body and refused by the plan's own bounds.
    const tooMany = await buy({ seats: 0, sites: 26 }, chosen(a));
    expect(tooMany.status).toBe(400);
    expect([h.stripe.retrieved, h.stripe.updates]).toEqual([[], []]);
    expect(await limitsOf(a.accountId)).toEqual({
      seat_limit: GATES.agency.seats,
      site_limit: GATES.agency.sites,
    });
    expect(h.capture).not.toHaveBeenCalled();
  });

  it.each(['account_manager', 'developer'] as const)(
    'a seat of role %s may not buy: 403 for the account it names, with no service-role client',
    async (role) => {
      const a = await agency();
      const member = await person(h.db, role);
      await addSeat(h.db, a.accountId, member, role);
      as(member);
      const res = await buy({ seats: 1, sites: 0, accountId: a.accountId });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ code: 'role_refused' });
      expect(h.log).toEqual(['supabaseServer']);
    },
  );

  it('a stranger naming the account is refused as one who holds no seat on it', async () => {
    const a = await agency();
    as(await person(h.db, 'stranger'));
    const res = await buy({ seats: 1, sites: 0, accountId: a.accountId });
    expect(res.status).toBe(403);
    expect(h.log).toEqual(['supabaseServer']);
  });

  it('a Pro account is 402 with the gate’s name', async () => {
    const owner = await person(h.db, 'pro');
    await makePaid(h.db, owner.accountId, 'pro');
    as(owner);
    const res = await buy({ seats: 1, sites: 0 });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ code: 'upgrade_required', gate: 'agencyBranding' });
    expect(h.log).toEqual(['supabaseServer']);
  });

  it('refuses a seat limit below the seats in use: active seats and invitations not yet expired', async () => {
    const a = await agency({ seats: 3, sites: 0 });
    // The owner, four members, one invitation in its week and one whose link has expired: 6 in use.
    for (let i = 0; i < 4; i++) {
      await addSeat(h.db, a.accountId, await person(h.db, `m${i}`), 'developer');
    }
    await h.db.query(
      `insert into public.seats (account_id, invited_email, role, status, invite_token_hash, invite_expires_at)
       values ($1, 'pending@example.com', 'developer', 'invited', repeat('a', 64), now() + interval '3 days'),
              ($1, 'lapsed@example.com', 'developer', 'invited', repeat('b', 64), now() - interval '1 day')`,
      [a.accountId],
    );
    as(a.owner);
    const res = await buy({ seats: 0, sites: 0 }, chosen(a));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'in_use', what: 'seats', inUse: 6 });
    expect(h.stripe.updates).toEqual([]);
    // One extra seat leaves six: as many as are in use.
    expect((await buy({ seats: 1, sites: 0 }, chosen(a))).status).toBe(200);
  });

  it('refuses a site limit below the live client sites, staging copies and removed sites aside', async () => {
    const a = await agency({ seats: 0, sites: 2 });
    await h.db.query(`update public.accounts set site_limit = $2 where id = $1`, [
      a.accountId,
      GATES.agency.sites + 2,
    ]);
    const sites = [];
    for (let i = 0; i < GATES.agency.sites + 1; i++) sites.push(await keptSite(h.db, a.accountId));
    await keptSite(h.db, a.accountId, { staging_of_site_id: sites[0]!.id });
    await keptSite(h.db, a.accountId, { removed_at: new Date().toISOString() });
    as(a.owner);
    const res = await buy({ seats: 0, sites: 0 }, chosen(a));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: 'in_use',
      what: 'sites',
      inUse: GATES.agency.sites + 1,
    });
    expect((await buy({ seats: 0, sites: 1 }, chosen(a))).status).toBe(200);
  });

  it('an account whose subscription has no mirror row of its own is 409', async () => {
    const a = await agency();
    await h.db.query(`delete from public.subscriptions where id = $1`, [a.subscriptionId]);
    as(a.owner);
    const res = await buy({ seats: 1, sites: 0 }, chosen(a));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'no_subscription' });
    expect(h.stripe.retrieved).toEqual([]);
  });
});
