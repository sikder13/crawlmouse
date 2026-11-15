import { writeFileSync } from 'node:fs';
import { expect, test } from './pw';
import { control, holdStripe, shot, sql, STANDIN } from './walk';
import type { Capture } from './harness/posthog';

/**
 * Journey 8 (CC-41 D7): one anonymous visitor, followed through PostHog. They land from a campaign
 * link, check a site, sign up from the result, upgrade the no-card Pro trial at Checkout (the Stripe
 * stand-in), and the webhook makes them Pro; Stripe then retries that webhook delivery. Every
 * PostHog payload, the browser's and the server's, is caught by the stand-in's capture stub
 * (harness/posthog.ts). The test asserts, from those payloads and the database:
 *   1. one person: the browser's anonymous id before sign-up, an `$identify` joining it to the
 *      user's `users.id`, and every server event about this human keyed by one of the two;
 *   2. the `account_attribution` row holds the landing URL's UTM fields, `ref` and referrer host;
 *   3. the Stripe customer and the Checkout Session's `subscription_data` carry
 *      `posthog_person_distinct_id` = `users.id`, and `account_id`;
 *   4. the payment events arrive keyed to `users.id` with `account_id`, a `uuid` and the Stripe
 *      event's time, and the replayed delivery sends no second capture.
 * Run only by `bash tests/e2e/run.sh 8-data` (a build with PostHog pointed at the stub). The
 * evidence is written to $WALK_EVIDENCE for harness/d7-report.ts.
 */
const J = '8-data-foundation';
const HOST = 'data.walk.crawlmouse.com';
const EMAIL = 'person@walk.example';
const LANDING = '/?utm_source=walk&utm_medium=test&utm_campaign=cc41&ref=d7';
const REFERRER = 'https://news.walk.example/thread/41?from=feed';
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '';

// posthog-js drops every event from a browser it takes for a bot (`_is_bot`: the user agent, its
// brands, `navigator.webdriver`), and headless Chromium's user agent says `HeadlessChrome`. The
// walk's browser presents an ordinary desktop Chrome's.
test.use({
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
});

const captures = () => control<Capture[]>('captures');
const browser = async () => (await captures()).filter((c) => c.source === 'browser');
const server = async () => (await captures()).filter((c) => c.source === 'server');

test('one visitor: landing → check → sign-up → Checkout → paid, one PostHog person', async ({
  page,
  context,
}) => {
  expect(KEY, 'run.sh sets the placeholder project token for journey 8').not.toBe('');

  // Nothing leaves the machine: a request to any other host is refused and listed.
  const offMachine: string[] = [];
  await context.route(
    (url) =>
      !['localhost', '127.0.0.1'].includes(url.hostname) && !/stripe\.com$/.test(url.hostname),
    async (route) => {
      offMachine.push(route.request().url());
      await route.abort();
    },
  );

  // posthog-js also reads `navigator.webdriver` (true under automation) and the user agent's brands
  // (headless Chromium lists `HeadlessChrome`); the walk's page reads both as an ordinary browser's.
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      get: () => ({
        brands: [
          { brand: 'Chromium', version: '140' },
          { brand: 'Google Chrome', version: '140' },
        ],
        mobile: false,
        platform: 'Linux',
      }),
    });
  });

  // ── Landing, from a campaign link with a referrer ──────────────────────────────────────────────
  await page.goto(LANDING, { referer: REFERRER });
  await shot(page, J, 'landing');
  await expect
    .poll(async () => (await browser()).some((c) => c.event === '$pageview'), {
      timeout: 30_000,
    })
    .toBe(true);
  const cookie = (await context.cookies()).find((c) => c.name === `ph_${KEY}_posthog`);
  expect(cookie, 'posthog-js keeps its id in the ph_<token>_posthog cookie').toBeDefined();
  const anonId = (JSON.parse(decodeURIComponent(cookie!.value)) as { distinct_id: string })
    .distinct_id;
  expect(anonId).toMatch(/^[0-9a-f-]{20,}$/);
  const ft = (await context.cookies()).find((c) => c.name === 'cm_ft');
  expect(ft, 'the first touch is remembered in cm_ft').toBeDefined();

  // ── A check, anonymous ─────────────────────────────────────────────────────────────────────────
  const started = page.waitForResponse(
    (r) => r.url().endsWith('/api/checks') && r.request().method() === 'POST',
  );
  await page.getByLabel('Website URL').first().fill(HOST);
  await page.getByRole('button', { name: 'Start the audit' }).first().click();
  expect((await started).status()).toBe(200);
  await page.waitForURL(/\/audit\/[0-9a-f-]{36}/);
  const checkId = /\/audit\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  const [site] = await sql<{ site_id: string }>(`select site_id from public.checks where id = $1`, [
    checkId,
  ]);
  await control('finish', { siteId: site!.site_id });
  await page.reload();
  await expect(page.getByText(HOST).first()).toBeVisible();
  await shot(page, J, 'result');

  // ── Sign-up from the result, through the stand-in's sign-in link ───────────────────────────────
  await page
    .getByRole('link', { name: /Keep this audit/ })
    .first()
    .click();
  await page.getByPlaceholder('you@company.com').fill(EMAIL);
  const sent = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/'),
  );
  await page.getByRole('button', { name: 'Keep it' }).click();
  expect((await sent).status()).toBeLessThan(300);
  const link = (await (
    await fetch(`${STANDIN}/__harness/link?email=${encodeURIComponent(EMAIL)}`)
  ).json()) as { token_hash: string };
  await page.goto(`/login/verify?token_hash=${link.token_hash}&type=email`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'You’re signed in.' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.waitForLoadState('networkidle');
  await shot(page, J, 'signed-in');

  const [user] = await sql<{ id: string; account_id: string }>(
    `select id, default_account_id account_id from public.users where email = $1`,
    [EMAIL],
  );
  const userId = user!.id;
  const accountId = user!.account_id;
  expect(accountId).toBeTruthy();

  // ── Upgrade at Checkout (the Stripe stand-in), then the webhook ────────────────────────────────
  await page.goto('/settings/plan');
  await expect
    .poll(async () => (await browser()).some((c) => c.event === '$identify'), { timeout: 30_000 })
    .toBe(true);
  const stripe = await holdStripe(page);
  await page.getByRole('button', { name: /Pro/ }).first().click();
  await expect.poll(() => stripe.at(-1)).toMatch(/^https:\/\/checkout\.stripe\.com\/c\/pay\//);
  await shot(page, J, 'checkout-redirect');
  const sessions =
    await control<{ id: string; params: Record<string, unknown>; status: string }[]>('sessions');
  const open = sessions.filter((s) => s.status === 'open');
  expect(open).toHaveLength(1);
  const session = open[0]!;
  const delivered = await control<{
    status: number;
    body: string;
    subscription: string;
    event: { id: string; created: number };
  }>('complete', { sessionId: session.id });
  expect(delivered.status, delivered.body).toBe(200);
  const [account] = await sql<{ state: string }>(
    `select state from public.accounts where id = $1`,
    [accountId],
  );
  expect(account?.state).toBe('pro');

  const paymentNames = ['subscription_started', 'trial_converted'];
  await expect
    .poll(async () => (await server()).filter((c) => paymentNames.includes(c.event)).length, {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(1);
  const beforeReplay = await server();

  // Stripe retries the delivery: the same event, byte for byte.
  const replayed = await control<{ status: number; body: string }>('replay');
  expect(replayed.status, replayed.body).toBe(200);
  // A capture the replay sent would arrive in well under this (the sender's own timeout is 2 s).
  await page.waitForTimeout(4000);
  const afterReplay = await server();

  // A last page, so the browser flushes what it holds.
  await page.goto('/settings/plan');
  await shot(page, J, 'plan-pro');
  await page.waitForTimeout(4000);

  // ── The evidence ───────────────────────────────────────────────────────────────────────────────
  const all = await captures();
  const [attribution] = await sql(
    `select * from public.account_attribution where account_id = $1`,
    [accountId],
  );
  const customers = await control<{ id: string; params: Record<string, unknown> }[]>('customers');
  const requests =
    await control<{ method: string; path: string; encoding: string }[]>('posthog-requests');
  const [stripeEvent] = await sql(
    `select id, type, handled, processed_at from public.stripe_events where id = $1`,
    [delivered.event.id],
  );
  const evidence = {
    userId,
    accountId,
    anonId,
    landing: LANDING,
    referrer: REFERRER,
    checkId,
    attribution,
    customers,
    session: { id: session.id, params: session.params },
    stripeEvent: delivered.event,
    stripeEventRow: stripeEvent ?? null,
    replay: {
      status: replayed.status,
      serverCapturesBefore: beforeReplay.length,
      serverCapturesAfter: afterReplay.length,
    },
    offMachine,
    requests,
    captures: all,
  };
  if (process.env.WALK_EVIDENCE) {
    writeFileSync(process.env.WALK_EVIDENCE, JSON.stringify(evidence, null, 2));
  }

  // 1. One person.
  const identify = all.filter((c) => c.event === '$identify');
  expect(identify.length).toBeGreaterThanOrEqual(1);
  expect(identify[0]!.distinct_id).toBe(userId);
  expect(identify[0]!.properties.$anon_distinct_id).toBe(anonId);
  const firstIdentify = all.indexOf(identify[0]!);
  const browserBefore = all.slice(0, firstIdentify).filter((c) => c.source === 'browser');
  expect(browserBefore.length).toBeGreaterThan(0);
  expect(new Set(browserBefore.map((c) => c.distinct_id))).toEqual(new Set([anonId]));
  const browserAfter = all.slice(firstIdentify + 1).filter((c) => c.source === 'browser');
  expect(new Set(browserAfter.map((c) => c.distinct_id))).toEqual(new Set([userId]));
  const servers = all.filter((c) => c.source === 'server');
  expect(servers.length).toBeGreaterThan(0);
  // A system event (a step, a cron, a webhook acting for the account) is keyed `account:<id>` by
  // design (events-before-after.md, kind S); anything else about this human is users.id or anonId.
  const keys = new Set([userId, anonId, `account:${accountId}`]);
  const strangers = servers.filter((c) => !keys.has(c.distinct_id ?? ''));
  expect(
    strangers.map((c) => `${c.event} ${c.distinct_id}`),
    'every server event is keyed by users.id, the browser id or (a system event) the account',
  ).toEqual([]);

  // 2. The attribution row.
  expect(attribution).toMatchObject({
    utm_source: 'walk',
    utm_medium: 'test',
    utm_campaign: 'cc41',
    ref: 'd7',
    landing_path: '/',
    referrer_host: 'news.walk.example',
  });

  // 3. Stripe's metadata names the same person.
  const customerId = String(session.params.customer);
  const customer = customers.find((c) => c.id === customerId);
  expect(customer?.params.metadata).toMatchObject({
    posthog_person_distinct_id: userId,
    account_id: accountId,
  });
  expect((session.params.subscription_data as Record<string, unknown>).metadata).toMatchObject({
    posthog_person_distinct_id: userId,
    account_id: accountId,
  });

  // 4. The payment events, and the replay.
  const payments = servers.filter((c) => paymentNames.includes(c.event));
  expect(payments.map((c) => c.event).sort()).toEqual([...paymentNames].sort());
  const at = new Date(delivered.event.created * 1000).toISOString();
  for (const p of payments) {
    expect(p.distinct_id, p.event).toBe(userId);
    expect(p.properties.account_id, p.event).toBe(accountId);
    expect(p.uuid, p.event).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(new Date(p.timestamp ?? '').toISOString(), p.event).toBe(at);
  }
  expect(afterReplay.length, 'the replayed delivery sent no capture').toBe(beforeReplay.length);
  expect(offMachine, 'no request left the machine').toEqual([]);
});
