import { expect, test } from './pw';
import { control, NEEDS_SEED, qa, SEEDED, shot, signIn, sql } from './walk';

/**
 * Journey 3 (CC-38 D4): `qa+protrial`, on the no-card Pro trial qa:seed started, upgrades. The walk
 * goes up to Stripe Checkout's redirect (asserting the session the app asked for), then does Stripe's
 * part — the session completed and the signed `checkout.session.completed` posted to the app's
 * webhook (harness/stripe.ts) — and reads what the real webhook made of it. Then cancel, and restore.
 */
const J = '3-pro-trial';

test.skip(!SEEDED, NEEDS_SEED);

const accountState = async () =>
  (
    await sql<{ state: string; current_subscription_id: string | null }>(
      `select a.state, a.current_subscription_id from public.accounts a
         join public.qa_accounts q on q.account_id = a.id where q.qa_key = 'protrial'`,
    )
  )[0];

test.describe.configure({ mode: 'serial' });

/** The subscription the upgrade made, for the cancel that follows it. */
let subscription = '';

test('Pro trial → upgrade (the redirect, then the webhook) → Pro', async ({ page, context }) => {
  await signIn(context, qa('protrial'));
  expect((await accountState())?.state).toBe('pro_trial');

  await page.goto('/settings/plan');
  await shot(page, J, 'plan-trial');

  // Up to Checkout's redirect: the request the app makes, and where it sends the browser.
  const checkout = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/billing/checkout'),
  );
  // Stripe's page is answered here, so the browser leaves nothing for Stripe's real host.
  await page.route('https://checkout.stripe.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Stripe Checkout</h1>' }),
  );
  await page.getByRole('button', { name: /Pro/ }).first().click();
  expect((await checkout).status()).toBe(303);
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\/c\/pay\//);
  await shot(page, J, 'checkout-redirect');

  const sessions =
    await control<{ id: string; params: Record<string, unknown>; status: string }[]>('sessions');
  const open = sessions.filter((s) => s.status === 'open');
  expect(open).toHaveLength(1);
  const params = open[0]!.params;
  expect(params.mode).toBe('subscription');
  expect((params.metadata as Record<string, string>).account_id).toBe(params.client_reference_id);
  expect(params.subscription_data).not.toHaveProperty('trial_period_days');

  // Stripe's side, then the app's webhook decides.
  const delivered = await control<{ status: number; body: string; subscription: string }>(
    'complete',
    {
      sessionId: open[0]!.id,
    },
  );
  expect(delivered.status, delivered.body).toBe(200);
  expect(await accountState()).toEqual({
    state: 'pro',
    current_subscription_id: delivered.subscription,
  });

  await page.goto('/settings/plan');
  await shot(page, J, 'plan-pro');

  subscription = delivered.subscription;
});

test('Pro: cancel (two clicks), then restore through the billing portal', async ({
  page,
  context,
}) => {
  expect(subscription, 'the upgrade above made the subscription').not.toBe('');
  await signIn(context, qa('protrial'));
  await page.goto('/settings/plan');

  // Cancel, two clicks: the first asks, the second (`confirm`) has Stripe cancel at the period's end.
  await page.getByRole('button', { name: 'Cancel, back to Free' }).click();
  await page.waitForLoadState('networkidle');
  await shot(page, J, 'cancel-ask');
  // The second click: a control that sends `confirm` (lib/billing/cancel.ts). walk-findings.md item 6:
  // the page offers none, so this is where the journey stops today.
  const confirm = page.locator('form:has(input[name="confirm"]) button');
  await expect(confirm, 'Settings › Plan offers the second, confirming click').toHaveCount(1);
  const cancelled = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/billing/cancel'),
  );
  await confirm.click();
  expect((await cancelled).status()).toBeLessThan(400);
  const after = await control<{ status: number }>('updated', { subscription });
  expect(after.status).toBe(200);
  await page.goto('/settings/plan');
  await expect(page.getByText(/^Cancelled; it takes effect/)).toBeVisible();
  await shot(page, J, 'plan-cancelled');

  // Restore: the billing portal (Stripe's page) renews it, and Stripe's update comes back.
  await page.route('https://billing.stripe.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<h1>Stripe billing portal</h1>',
    }),
  );
  await page.getByRole('button', { name: 'Billing portal' }).click();
  await page.waitForURL(/^https:\/\/billing\.stripe\.com\//);
  const renewed = await control<{ status: number }>('renew', { subscription });
  expect(renewed.status).toBe(200);
  await page.goto('/settings/plan');
  await expect(page.getByText(/^Cancelled;/)).toHaveCount(0);
  await shot(page, J, 'plan-restored');
  expect((await accountState())?.state).toBe('pro');
});
