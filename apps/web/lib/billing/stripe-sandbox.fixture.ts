/**
 * The Stripe half of the sandbox smoke (CC-03 D12): real objects in the Crawlmouse sandbox, and the
 * real events they produce. Test-only; imported by `stripe-sandbox.smoke.test.ts` alone.
 *
 * The key is a test key or nothing: `sandboxKey` refuses any value that does not start `sk_test_`, so
 * no run of this file can reach a live account. The key is never printed or put in an error.
 */
import { readFileSync } from 'node:fs';
import type Stripe from 'stripe';

type Env = Readonly<Record<string, string | undefined>>;

const KEY_NAME = 'STRIPE_ACCOUNT_TEST_SECRET_KEY';
const KEY_LINE = /^STRIPE_ACCOUNT_TEST_SECRET_KEY=(.*)$/m;

/** The sandbox key from the environment, else from `scripts/.env.local`; null when neither has one. */
export function sandboxKey(env: Env, envLocalPath: string): string | null {
  let key = env[KEY_NAME]?.trim();
  if (!key) {
    try {
      key = KEY_LINE.exec(readFileSync(envLocalPath, 'utf8'))?.[1]?.trim();
    } catch {
      key = undefined;
    }
  }
  if (!key) return null;
  if (!key.startsWith('sk_test_')) throw new Error(`${KEY_NAME} is not a test key`);
  return key;
}

export interface Scenario {
  /** When the scenario began, in Stripe's seconds, to list its events from. */
  since: number;
  pro: { customer: string; subscription: string };
  agencyTrial: { customer: string; subscription: string };
}

async function customerWithCard(stripe: Stripe, accountId: string): Promise<string> {
  const customer = await stripe.customers.create({
    email: `cc03-smoke+${accountId}@example.com`,
    metadata: { account_id: accountId, purpose: 'cc-03 sandbox smoke' },
  });
  const card = await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: card.id },
  });
  return customer.id;
}

/**
 * D12's objects: a Pro monthly subscription paid with the test card, and an Agency monthly one on a
 * 14-day trial, then set to cancel at its period end.
 */
export async function createScenario(
  stripe: Stripe,
  prices: { proMonthly: string; agencyMonthly: string },
  accounts: { pro: string; agencyTrial: string },
): Promise<Scenario> {
  const since = Math.floor(Date.now() / 1000) - 5;
  const proCustomer = await customerWithCard(stripe, accounts.pro);
  const pro = await stripe.subscriptions.create({
    customer: proCustomer,
    items: [{ price: prices.proMonthly, quantity: 1 }],
    metadata: { account_id: accounts.pro },
  });
  const trialCustomer = await customerWithCard(stripe, accounts.agencyTrial);
  const trial = await stripe.subscriptions.create({
    customer: trialCustomer,
    items: [{ price: prices.agencyMonthly, quantity: 1 }],
    trial_period_days: 14,
    metadata: { account_id: accounts.agencyTrial },
  });
  await stripe.subscriptions.update(trial.id, { cancel_at_period_end: true });
  return {
    since,
    pro: { customer: proCustomer, subscription: pro.id },
    agencyTrial: { customer: trialCustomer, subscription: trial.id },
  };
}

/** The customer an event's object belongs to, or null. */
function customerOf(event: Stripe.Event): string | null {
  const obj = event.data.object as { object?: string; id?: string; customer?: unknown };
  if (obj.object === 'customer') return obj.id ?? null;
  if (typeof obj.customer === 'string') return obj.customer;
  if (obj.customer && typeof (obj.customer as { id?: unknown }).id === 'string') {
    return (obj.customer as { id: string }).id;
  }
  return null;
}

/**
 * The scenario's events, oldest first, once each customer has `wanted` among them (Stripe writes events
 * a moment after the call that causes them). Throws after `timeoutMs` with the types it did see.
 */
export async function scenarioEvents(
  stripe: Stripe,
  scenario: Scenario,
  wanted: Readonly<Record<string, readonly string[]>>,
  timeoutMs = 60_000,
): Promise<Stripe.Event[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found: Stripe.Event[] = [];
    for await (const e of stripe.events.list({ created: { gte: scenario.since }, limit: 100 })) {
      const c = customerOf(e);
      if (c !== null && c in wanted) found.push(e);
    }
    const missing = Object.entries(wanted).flatMap(([customer, types]) =>
      types.filter((t) => !found.some((e) => e.type === t && customerOf(e) === customer)),
    );
    if (missing.length === 0) {
      return found.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
    }
    if (Date.now() > deadline) {
      throw new Error(`sandbox events missing after ${timeoutMs} ms: ${missing.join(', ')}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** Deletes the scenario's customers, which cancels their subscriptions. */
export async function cleanUp(stripe: Stripe, scenario: Scenario | null): Promise<void> {
  if (!scenario) return;
  for (const c of [scenario.pro.customer, scenario.agencyTrial.customer]) {
    await stripe.customers.del(c);
  }
}
