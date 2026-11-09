import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EffectSinks, PlannedEffect } from './effects';
import { applyStripeEvent, stripeReads } from './stripe-webhook';
import { stripeCatalog } from './stripe-catalog';
import { pgliteWebhookDb, webhookTestDb } from './webhook-db.pglite';
import { payloads } from './stripe.fake';
import {
  cleanUp,
  createScenario,
  sandboxKey,
  scenarioEvents,
  type Scenario,
} from './stripe-sandbox.fixture';

/**
 * CC-03 D12: real Stripe objects in the Crawlmouse sandbox, and the real events they produce, fed
 * through the v2 webhook handler against PGlite with every migration — never a deployed database.
 * Skipped, not failed, without STRIPE_ACCOUNT_TEST_SECRET_KEY (environment, or the repo's
 * gitignored scripts/.env.local); `sandboxKey` refuses anything but a test key.
 *
 * A Checkout Session cannot be completed through the API, so each scenario's
 * `checkout.session.completed` is synthesised: a signed envelope naming the real subscription and
 * customer, the account as `client_reference_id`. Every other event is Stripe's own, rendered in the
 * account's default API version, which the test reads and states.
 */

vi.mock('server-only', () => ({}));

const HERE = fileURLToPath(new URL('.', import.meta.url));
const KEY = sandboxKey(process.env, resolve(HERE, '../../../../scripts/.env.local'));
/** A test secret of this file's own: no endpoint exists, so nothing else signs with it. */
const SECRET = 'cc03-sandbox-smoke-signing';

interface Row {
  state: string;
  tier: string;
  current_subscription_id: string | null;
  trial_ends_at: string | null;
}

function recordingSinks(sent: PlannedEffect[]): EffectSinks {
  return {
    async send(events) {
      for (const e of events) sent.push({ kind: 'send', ...e } as PlannedEffect);
    },
    async cancel(c) {
      sent.push(c);
    },
    async alert(a) {
      sent.push(a);
    },
  };
}

/** The event as the route has it: its JSON signed with the test secret, then verified. */
function verified(event: Stripe.Event): Stripe.Event {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return Stripe.webhooks.constructEvent(payload, header, SECRET);
}

describe.skipIf(KEY === null)('the sandbox smoke (D12)', () => {
  const stripe = new Stripe(KEY ?? 'unused');
  const catalog = stripeCatalog(stripe);
  const sent: PlannedEffect[] = [];
  let db: PGlite;
  let scenario: Scenario | null = null;
  const accounts = { pro: '', agencyTrial: '' };

  async function account(): Promise<string> {
    const { rows } = await db.query<{ a: string }>(
      `with u as (insert into auth.users (id, email) values (gen_random_uuid(), gen_random_uuid() || '@example.com') returning id)
       select default_account_id as a from public.users where id = (select id from u)`,
    );
    return rows[0]!.a;
  }

  async function row(accountId: string): Promise<Row> {
    const { rows } = await db.query<Row>(
      `select state, tier, current_subscription_id, trial_ends_at from public.accounts where id = $1`,
      [accountId],
    );
    return rows[0]!;
  }

  async function deliver(event: Stripe.Event) {
    return applyStripeEvent(verified(event), {
      db: pgliteWebhookDb(db),
      stripe: stripeReads(stripe),
      catalog,
      sinks: recordingSinks(sent),
      livemode: false,
    });
  }

  function syntheticCheckout(
    accountId: string,
    s: { customer: string; subscription: string },
    created: number,
  ) {
    return {
      id: `evt_smoke_checkout_${s.subscription}`,
      object: 'event',
      api_version: Stripe.API_VERSION,
      created,
      livemode: false,
      type: 'checkout.session.completed',
      data: {
        object: payloads.checkout({
          session: `cs_smoke_${s.subscription}`,
          accountId,
          customer: s.customer,
          subscription: s.subscription,
          created,
        }),
      },
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
    } as unknown as Stripe.Event;
  }

  beforeAll(async () => {
    db = await webhookTestDb();
    accounts.pro = await account();
    accounts.agencyTrial = await account();
    scenario = await createScenario(
      stripe,
      {
        proMonthly: await catalog.priceFor('pro', 'month', 'base'),
        agencyMonthly: await catalog.priceFor('agency', 'month', 'base'),
      },
      accounts,
    );
    // As the checkout route binds a customer before it opens a session.
    for (const [id, customer] of [
      [accounts.pro, scenario.pro.customer],
      [accounts.agencyTrial, scenario.agencyTrial.customer],
    ] as const) {
      await db.query(`update public.accounts set stripe_customer_id = $2 where id = $1`, [
        id,
        customer,
      ]);
    }
  }, 120_000);

  afterAll(async () => {
    await cleanUp(stripe, scenario);
  }, 60_000);

  it('a paid Pro subscription and a cancelled Agency trial reach the states the machine must give them', async () => {
    const s = scenario!;
    const events = await scenarioEvents(stripe, s, {
      [s.pro.customer]: ['customer.subscription.created', 'invoice.paid'],
      [s.agencyTrial.customer]: ['customer.subscription.created', 'customer.subscription.updated'],
    });
    // The payload version the real events were rendered in: the account's default, not the SDK's.
    const versions = [...new Set(events.map((e) => e.api_version))];
    expect(versions).toEqual(['2026-10-28.endive']);

    const trail: string[] = [];
    for (const e of events) {
      const { customer } = e.data.object as { customer?: string };
      const accountId = customer === s.pro.customer ? accounts.pro : accounts.agencyTrial;
      const outcome = await deliver(e);
      trail.push(`${e.type} → ${outcome.outcome} → ${(await row(accountId)).state}`);
      // The checkout follows its subscription's creation, as Stripe sends them.
      if (e.type === 'customer.subscription.created') {
        const ids = accountId === accounts.pro ? s.pro : s.agencyTrial;
        const checkout = syntheticCheckout(accountId, ids, e.created);
        const granted = await deliver(checkout);
        trail.push(
          `checkout.session.completed (synthetic) → ${granted.outcome} → ${(await row(accountId)).state}`,
        );
      }
    }

    const pro = await row(accounts.pro);
    expect(pro).toMatchObject({
      state: 'pro',
      tier: 'pro',
      current_subscription_id: s.pro.subscription,
    });
    const trial = await row(accounts.agencyTrial);
    expect(trial).toMatchObject({
      state: 'agency_trial',
      tier: 'agency',
      current_subscription_id: s.agencyTrial.subscription,
    });
    const real = await stripe.subscriptions.retrieve(s.agencyTrial.subscription);
    expect(new Date(trial.trial_ends_at!).getTime()).toBe(real.trial_end! * 1000);

    const { rows: mirrors } = await db.query<{
      id: string;
      status: string;
      plan: string;
      interval: string;
      cancel_at_period_end: boolean;
    }>(
      `select id, status, plan, interval, cancel_at_period_end from public.subscriptions order by plan desc`,
    );
    expect(mirrors).toEqual([
      {
        id: s.pro.subscription,
        status: 'active',
        plan: 'pro',
        interval: 'month',
        cancel_at_period_end: false,
      },
      {
        id: s.agencyTrial.subscription,
        status: 'trialing',
        plan: 'agency',
        interval: 'month',
        cancel_at_period_end: true,
      },
    ]);
    const { rows: unstamped } = await db.query(
      `select id from public.stripe_events where processed_at is null`,
    );
    expect(unstamped).toEqual([]);
    expect(sent.filter((p) => p.kind !== 'send')).toEqual([]);
    console.info(
      `[d12] ${events.length} real events, api_version ${versions[0]}\n  ${trail.join('\n  ')}`,
    );
  }, 180_000);

  it('deleting the customers ends both subscriptions, and both accounts go Free', async () => {
    const s = scenario!;
    await cleanUp(stripe, s);
    scenario = null;
    const deleted = await scenarioEvents(stripe, s, {
      [s.pro.customer]: ['customer.subscription.deleted'],
      [s.agencyTrial.customer]: ['customer.subscription.deleted'],
    });
    for (const e of deleted.filter((d) => d.type === 'customer.subscription.deleted')) {
      await deliver(e);
    }
    expect(await row(accounts.pro)).toMatchObject({ state: 'free', current_subscription_id: null });
    expect(await row(accounts.agencyTrial)).toMatchObject({
      state: 'free',
      current_subscription_id: null,
    });
  }, 180_000);
});
