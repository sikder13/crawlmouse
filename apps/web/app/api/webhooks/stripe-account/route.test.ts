import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectSinks } from '@/lib/billing/effects';
import type { StripeReads, WebhookOutcome } from '@/lib/billing/webhook-types';
import type { WebhookDb } from '@/lib/billing/webhook-db';

/**
 * POST /api/webhooks/stripe-account: the order the route checks things in, and what it answers.
 * The handler is a spy in the first block and the real one over PGlite in the second; Supabase,
 * Stripe's API, the catalog and the sinks are stand-ins either way. Signatures are real:
 * `Stripe.webhooks.constructEvent` checks headers made with `generateTestHeaderString`.
 */

const state = vi.hoisted(() => ({
  handler: null as null | ((...args: unknown[]) => Promise<WebhookOutcome>),
  db: null as WebhookDb | null,
  stripe: null as StripeReads | null,
  sinks: null as EffectSinks | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), flush: vi.fn(async () => true) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ admin: true }) }));
vi.mock('@/lib/billing/stripe-catalog', async () => {
  const { fakeCatalog } = await import('@/lib/billing/catalog.fake');
  return { accountCatalog: () => fakeCatalog() };
});
vi.mock('@/lib/billing/effect-sinks', () => ({ productionSinks: () => state.sinks }));
vi.mock('@/lib/billing/stripe-account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/stripe-account')>()),
  stripeAccount: () => ({ account: true }),
}));
vi.mock('@/lib/billing/webhook-db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/webhook-db')>()),
  supabaseWebhookDb: () => state.db,
}));
vi.mock('@/lib/billing/stripe-webhook', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/billing/stripe-webhook')>();
  return {
    ...real,
    stripeReads: () => state.stripe,
    applyStripeEvent: (...args: unknown[]) =>
      state.handler
        ? state.handler(...args)
        : (real.applyStripeEvent as (...a: unknown[]) => Promise<WebhookOutcome>)(...args),
  };
});

import * as Sentry from '@sentry/nextjs';
import { payloads, signedPayload, WEBHOOK_SECRET } from '@/lib/billing/stripe.fake';
import { webhookWorld, pgliteWebhookDb, type WebhookWorld } from '@/lib/billing/webhook-db.pglite';
import { POST } from './route';

const BASE = 4_070_908_800;

function post(body: string, signature: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) headers['stripe-signature'] = signature;
  return POST(
    new Request('https://crawlmouse.test/api/webhooks/stripe-account', {
      method: 'POST',
      headers,
      body,
    }),
  );
}

const invoicePaid = (livemode = false) =>
  signedPayload(
    'invoice.paid',
    { id: 'in_route', object: 'invoice', customer: 'cus_route' },
    { id: 'evt_route_1', created: BASE, livemode },
  );

const ENV = ['STRIPE_ACCOUNT_WEBHOOK_SECRET', 'V2_BILLING', 'STRIPE_ACCOUNT_LIVEMODE'] as const;
let saved: Record<string, string | undefined>;
let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.STRIPE_ACCOUNT_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.V2_BILLING = '1';
  delete process.env.STRIPE_ACCOUNT_LIVEMODE;
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(Sentry.captureMessage).mockClear();
  vi.mocked(Sentry.flush).mockClear();
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  errors.mockRestore();
});

describe('the route with the handler as a spy', () => {
  const handler = vi.fn(
    async (): Promise<WebhookOutcome> => ({
      outcome: 'recorded',
      accountId: null,
      reason: 'x',
    }),
  );
  beforeEach(() => {
    handler.mockClear();
    state.handler = handler;
    state.db = { db: true } as unknown as WebhookDb;
    state.stripe = { stripe: true } as unknown as StripeReads;
    state.sinks = { sinks: true } as unknown as EffectSinks;
  });
  afterAll(() => {
    state.handler = null;
  });

  it('without the secret: 500, and nothing is read or called', async () => {
    delete process.env.STRIPE_ACCOUNT_WEBHOOK_SECRET;
    const { payload, header } = invoicePaid();
    const res = await post(payload, header);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('server misconfigured');
    expect(handler).not.toHaveBeenCalled();
  });

  it('a body changed after signing: 400 and a Sentry warning, the handler not called, nothing of the request logged', async () => {
    const { payload, header } = invoicePaid();
    const changed = payload.replace('"in_route"', '"in_other"');
    const res = await post(changed, header);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('invalid signature');
    expect(handler).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith('stripe.account_webhook.signature_failed', {
      level: 'warning',
      tags: { signal: 'stripe-account-webhook-sig-fail' },
    });
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).not.toContain('in_other');
    expect(logged).not.toContain(header.split(',')[1]!.slice(3));
  });

  it('no signature header: 400, the handler not called', async () => {
    const { payload } = invoicePaid();
    expect((await post(payload, null)).status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('a signature made with another secret: 400', async () => {
    const { payload, header } = invoicePaid();
    process.env.STRIPE_ACCOUNT_WEBHOOK_SECRET = 'another-secret';
    expect((await post(payload, header)).status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('V2_BILLING unset: a verified event gets 404 and is not handled', async () => {
    delete process.env.V2_BILLING;
    const { payload, header } = invoicePaid();
    const res = await post(payload, header);
    expect(res.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it('a verified event goes to the handler with the verified event and the deps, and answers 200', async () => {
    const { payload, header } = invoicePaid();
    const res = await post(payload, header);
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    const [event, deps] = handler.mock.calls[0] as unknown as [
      { id: string; type: string },
      Record<string, unknown>,
    ];
    expect([event.id, event.type]).toEqual(['evt_route_1', 'invoice.paid']);
    expect(deps).toMatchObject({
      db: { db: true },
      stripe: { stripe: true },
      sinks: { sinks: true },
      livemode: false,
    });
  });

  it('STRIPE_ACCOUNT_LIVEMODE=true hands the handler livemode true', async () => {
    process.env.STRIPE_ACCOUNT_LIVEMODE = 'true';
    const { payload, header } = invoicePaid(true);
    await post(payload, header);
    expect((handler.mock.calls[0] as unknown as [unknown, { livemode: boolean }])[1].livemode).toBe(
      true,
    );
  });

  it('a refused event answers 400, a failure 500', async () => {
    const { payload, header } = invoicePaid();
    handler.mockResolvedValueOnce({ outcome: 'refused', reason: 'livemode_mismatch' });
    expect((await post(payload, header)).status).toBe(400);
    handler.mockRejectedValueOnce(new Error('the database is down'));
    const res = await post(payload, header);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('handler error');
  });
});

describe('the route with the real handler over PGlite', () => {
  let w: WebhookWorld;
  beforeAll(async () => {
    w = await webhookWorld();
  }, 120_000);
  afterAll(async () => {
    await w?.db.close();
  });
  beforeEach(() => {
    state.handler = null;
    state.db = pgliteWebhookDb(w.db);
    state.stripe = w.stripe;
    state.sinks = w.stripe.sinks();
  });

  it('a live event at a test-mode endpoint: 400, recorded undecided; processed once the mode is set right', async () => {
    const customer = 'cus_route_live';
    const accountId = await w.account(customer);
    const sub = w.stripe.put({
      id: 'sub_route_live',
      customer,
      status: 'active',
      plan: 'pro',
      interval: 'month',
      seats: 0,
      sites: 0,
      trialEnd: null,
      periodEnd: BASE + 30 * 86_400,
      cancelAtPeriodEnd: false,
    });
    const { payload, header } = signedPayload(
      'checkout.session.completed',
      payloads.checkout({
        session: 'cs_route',
        accountId,
        customer,
        subscription: sub.id,
        created: BASE,
      }),
      { id: 'evt_route_live', created: BASE, livemode: true },
    );
    expect((await post(payload, header)).status).toBe(400);
    const row = async () =>
      (
        await w.db.query<{
          handled: boolean | null;
          handled_reason: string | null;
          processed_at: Date | null;
        }>(
          `select handled, handled_reason, processed_at from public.stripe_events where id = 'evt_route_live'`,
        )
      ).rows[0];
    expect(await row()).toEqual({
      handled: null,
      handled_reason: 'livemode_mismatch',
      processed_at: null,
    });

    process.env.STRIPE_ACCOUNT_LIVEMODE = 'true';
    expect((await post(payload, header)).status).toBe(200);
    expect(await row()).toMatchObject({ handled: true, handled_reason: null });
  });

  it('a report reaches Sentry and is flushed before the answer', async () => {
    const { payload, header } = signedPayload(
      'charge.dispute.created',
      payloads.dispute({ id: 'dp_route', charge: 'ch_route' }),
      { id: 'evt_route_dispute', created: BASE },
    );
    w.stripe.charges.set('ch_route', 'cus_nobody');
    expect((await post(payload, header)).status).toBe(200);
    expect(Sentry.captureMessage).toHaveBeenCalledWith('billing.webhook.dispute_without_account', {
      level: 'error',
      tags: { signal: 'stripe-account-webhook' },
      extra: {
        eventId: 'evt_route_dispute',
        type: 'charge.dispute.created',
        accountId: null,
        chargeId: 'ch_route',
        customerId: 'cus_nobody',
      },
    });
    expect(Sentry.flush).toHaveBeenCalledWith(2000);
  });

  it('nothing reported: no flush', async () => {
    const { payload, header } = signedPayload(
      'product.created',
      { id: 'prod_1', object: 'product' },
      { id: 'evt_route_product', created: BASE },
    );
    expect((await post(payload, header)).status).toBe(200);
    expect(Sentry.flush).not.toHaveBeenCalled();
  });
});
