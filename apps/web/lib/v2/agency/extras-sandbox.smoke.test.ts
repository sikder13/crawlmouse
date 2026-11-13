import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EXTRA_SEAT } from '../../billing/prices';
import { stripeCatalog } from '../../billing/stripe-catalog';
import { sandboxKey } from '../../billing/stripe-sandbox.fixture';
import { changeExtras, type ExtrasDeps } from './extras';

/**
 * The two proration rules of buying seats (owner ruling, questions.md Q4), on a real Agency
 * subscription in the Crawlmouse Stripe sandbox: a raise is invoiced and paid at once, and a
 * lowering makes no invoice and no credit. Skipped, not failed, without
 * STRIPE_ACCOUNT_TEST_SECRET_KEY (environment, or the repo's gitignored scripts/.env.local);
 * `sandboxKey` refuses anything but a test key. The customer it makes is deleted afterwards.
 */

vi.mock('server-only', () => ({}));

const HERE = fileURLToPath(new URL('.', import.meta.url));
const KEY = sandboxKey(process.env, resolve(HERE, '../../../../../scripts/.env.local'));
const ACCOUNT = '0b1f6c1e-5a55-4d6e-9d2c-3f1c1b7a9e10';

describe.skipIf(KEY === null)('extra seats against the Stripe sandbox (Q4)', () => {
  const stripe = new Stripe(KEY ?? 'unused');
  const catalog = stripeCatalog(stripe);
  let customer: string | null = null;
  let subscription = '';

  const deps: ExtrasDeps = {
    accounts: {
      read: async () => ({
        subscription: { id: subscription, lastEventId: null },
        seatsInUse: 1,
        sitesInUse: 0,
      }),
    },
    stripe,
    catalog,
    now: () => new Date(),
  };
  const invoices = async () =>
    (await stripe.invoices.list({ subscription, limit: 20 })).data.map((i) => ({
      reason: i.billing_reason,
      status: i.status,
      paid: i.amount_paid,
    }));

  beforeAll(async () => {
    const made = await stripe.customers.create({
      email: `cc31-smoke+${ACCOUNT}@example.com`,
      metadata: { account_id: ACCOUNT, purpose: 'cc-31 extras sandbox smoke' },
    });
    customer = made.id;
    const card = await stripe.paymentMethods.attach('pm_card_visa', { customer: made.id });
    await stripe.customers.update(made.id, {
      invoice_settings: { default_payment_method: card.id },
    });
    const sub = await stripe.subscriptions.create({
      customer: made.id,
      items: [{ price: await catalog.priceFor('agency', 'month', 'base'), quantity: 1 }],
      metadata: { account_id: ACCOUNT },
    });
    subscription = sub.id;
  }, 60_000);

  afterAll(async () => {
    if (customer !== null) await stripe.customers.del(customer);
  }, 60_000);

  it('a raise is invoiced at once: one more invoice, paid, for no more than the seats’ full price', async () => {
    const before = await invoices();
    const result = await changeExtras(deps, { accountId: ACCOUNT, want: { seats: 2, sites: 0 } });
    expect(result).toEqual({
      ok: true,
      extras: { seats: 2, sites: 0 },
      changed: true,
      raised: true,
    });
    const after = await invoices();
    expect(after).toHaveLength(before.length + 1);
    const added = after[0]!;
    expect([added.reason, added.status]).toEqual(['subscription_update', 'paid']);
    expect(added.paid).toBeGreaterThan(0);
    expect(added.paid).toBeLessThanOrEqual(2 * EXTRA_SEAT * 100);
  }, 60_000);

  it('a lowering makes no invoice and leaves no credit on the customer', async () => {
    const before = await invoices();
    const result = await changeExtras(deps, { accountId: ACCOUNT, want: { seats: 1, sites: 0 } });
    expect(result).toEqual({
      ok: true,
      extras: { seats: 1, sites: 0 },
      changed: true,
      raised: false,
    });
    expect(await invoices()).toEqual(before);
    const now = await stripe.customers.retrieve(customer!);
    expect('deleted' in now && now.deleted ? null : (now as Stripe.Customer).balance).toBe(0);
    const pending = await stripe.invoiceItems.list({ customer: customer!, pending: true });
    expect(pending.data.map((i) => i.amount)).toEqual([]);
  }, 60_000);
});
