import { expect, test, type Page } from './pw';
import { control, events, NEEDS_SEED, qa, SEEDED, shot, signIn, sql } from './walk';

/**
 * Journey 4 (CC-38 D4): `qa+agencytrial` starts the Agency trial (card taken at Checkout, then the
 * webhook), adds clients up to six, invites a developer scoped to one client; the developer sees only
 * that client; the owner makes a client report, shares it, the proof page opens signed out, and the
 * share is revoked. CC-37 D5's two developer assertions (no card, no mint) wait for CC-37.
 */
const J = '4-agency';
const DEV = 'developer@walk.example';
const CLIENTS = [2, 3, 4, 5, 6].map((n) => `client-${n}.walk.crawlmouse.com`);

test.skip(!SEEDED, NEEDS_SEED);
test.describe.configure({ mode: 'serial' });

const agency = async () =>
  (
    await sql<{ id: string; state: string }>(
      `select a.id, a.state from public.accounts a join public.qa_accounts q on q.account_id = a.id
        where q.qa_key = 'agencytrial' and a.kind = 'agency'`,
    )
  )[0]!;

/** The agency is a second account: a browser acts in the personal one until it switches. */
async function openAgency(page: Page): Promise<void> {
  await page.goto('/agency');
  await page.getByRole('button', { name: 'Open QA Agency Trial' }).click();
  await page.waitForLoadState('networkidle');
}

test('the Agency trial starts through Checkout and the webhook', async ({ page, context }) => {
  await signIn(context, qa('agencytrial'));
  expect((await agency()).state).toBe('free');
  await page.goto('/agency-trial');
  await shot(page, J, 'agency-trial');
  await page.route('https://checkout.stripe.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Stripe Checkout</h1>' }),
  );
  const asked = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/agency-trial'),
  );
  // The seeded first client is a lab host; the walk's names are the ones its preload resolves.
  await page.getByLabel(/First client site/).fill('client-1.walk.crawlmouse.com');
  await page.getByRole('checkbox', { name: /I agree that after 14 days/ }).check();
  await page.getByRole('button', { name: 'Start a 14-day trial' }).click();
  expect((await asked).status()).toBeLessThan(400);
  await page.waitForURL(/^https:\/\/checkout\.stripe\.com\/c\/pay\//);

  const sessions =
    await control<{ id: string; params: Record<string, unknown>; status: string }[]>('sessions');
  const open = sessions.filter((s) => s.status === 'open');
  expect(open).toHaveLength(1);
  // The trial's session takes a card and starts the trial (lib/billing/agency-trial.ts).
  expect(open[0]!.params.payment_method_collection).toBe('always');
  expect((open[0]!.params.subscription_data as Record<string, string>).trial_period_days).toBe(
    '14',
  );
  const delivered = await control<{ status: number; body: string }>('complete', {
    sessionId: open[0]!.id,
  });
  expect(delivered.status, delivered.body).toBe(200);
  expect((await agency()).state).toBe('agency_trial');

  // The trial is a second account: the workspace offers the switch into it.
  await openAgency(page);
  await shot(page, J, 'matrix');

  // Five more clients through the matrix's form, to six.
  for (const host of CLIENTS) {
    await page.getByPlaceholder('example.com').fill(host);
    const added = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith('/api/sites'),
    );
    await page.getByRole('button', { name: /^Add a client site/ }).click();
    expect((await added).status()).toBeLessThan(400);
    await page.waitForLoadState('networkidle');
  }
  const six = await sql<{ host: string }>(
    `select host from public.sites where account_id = $1 and removed_at is null order by host`,
    [(await agency()).id],
  );
  expect(six.map((s) => s.host)).toEqual(['client-1.walk.crawlmouse.com', ...CLIENTS].sort());
  await shot(page, J, 'six-clients');
});

test('a developer invited to one client sees that client and no other', async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, qa('agencytrial'));
  await openAgency(page);
  await page.goto('/seats');
  await shot(page, J, 'seats');
  await page.getByLabel('Their email address').fill(DEV);
  await page.getByLabel('Role', { exact: true }).selectOption({ label: 'Developer' });
  await page.getByLabel('Clients', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('checkbox', { name: CLIENTS[1]! }).check();
  const invited = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/seats'),
  );
  await page.getByRole('button', { name: 'Send the invitation' }).click();
  expect((await invited).status()).toBeLessThan(400);
  await page.waitForLoadState('networkidle');
  await shot(page, J, 'invited');

  // The mail's link, minted as the mailer mints it from the recorded event (issue_seat_invite).
  const [mail] = (await events('seat.invite.requested')).slice(-1);
  expect(mail).toBeDefined();
  const [issued] = await sql<{ token: string }>(
    `select token from public.issue_seat_invite($1, $2, now())`,
    [mail!.data.seat_id, mail!.data.seq],
  );
  await control('user', { email: DEV });
  const dev = await browser.newContext();
  await signIn(dev, DEV);
  const devPage = await dev.newPage();
  await devPage.goto(`/invite/${issued!.token}`);
  await shot(devPage, J, 'invite-page');
  await devPage
    .getByRole('button', { name: /accept|join/i })
    .first()
    .click();
  await devPage.waitForLoadState('networkidle');
  await devPage.goto('/agency');
  await shot(devPage, J, 'developer-matrix');
  await expect(devPage.getByText(CLIENTS[1]!).first()).toBeVisible();
  for (const other of [
    'client-1.walk.crawlmouse.com',
    ...CLIENTS.filter((c) => c !== CLIENTS[1]),
  ]) {
    await expect(devPage.getByText(other)).toHaveCount(0);
  }
  // Not listed is not enough: another client's site page, opened by its address, is refused.
  const [other] = await sql<{ id: string }>(
    `select id from public.sites where host = 'client-1.walk.crawlmouse.com' and removed_at is null`,
  );
  const refused = await devPage.goto(`/sites/${other!.id}`);
  expect(refused?.status()).toBe(404);
  await shot(devPage, J, 'developer-other-client');
  await dev.close();
});

test('a client report, its share link, the proof page signed out, and the share revoked', async ({
  page,
  context,
  browser,
}) => {
  await signIn(context, qa('agencytrial'));
  await openAgency(page);
  const host = CLIENTS[0]!;
  const [site] = await sql<{ id: string }>(
    `select id from public.sites where host = $1 and removed_at is null`,
    [host],
  );
  // Two finished checks: the first audit, then a re-check run from the site's page.
  await control('finish', { siteId: site!.id });
  await page.goto(`/sites/${site!.id}`);
  await page.getByRole('button', { name: 'Run a check now' }).first().click();
  await page.waitForLoadState('networkidle');
  await control('finish', { siteId: site!.id });

  await page.goto('/reports');
  await page.getByRole('combobox').first().selectOption({ label: host });
  await page.getByRole('button', { name: 'Show' }).click();
  await page.waitForLoadState('networkidle');
  await shot(page, J, 'reports-for-client');

  const made = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/reports'),
  );
  await page.getByRole('button', { name: 'Compare these two' }).click();
  expect((await made).status()).toBeLessThan(400);
  await page.waitForLoadState('networkidle');
  await page.goto('/reports');
  await shot(page, J, 'report-made');

  await page.getByRole('button', { name: 'Link' }).first().click();
  // The new link is shown once, for a short while, in the row.
  const shown = page.locator('code', { hasText: '/s/' }).first();
  await expect(shown).toBeVisible();
  await shot(page, J, 'share-link');
  const share = new URL((await shown.textContent())!.trim()).pathname;
  expect(share).toMatch(/^\/s\//);

  // Opened with no session: the proof page.
  const visitor = await browser.newContext();
  const outsider = await visitor.newPage();
  const opened = await outsider.goto(share);
  expect(opened?.status()).toBe(200);
  await expect(outsider.getByRole('heading', { level: 1 })).toBeVisible();
  await shot(outsider, J, 'proof-signed-out');

  // Revoked: the link answers 410.
  await page
    .getByRole('button', { name: /^Withdraw link/ })
    .first()
    .click();
  await page.waitForLoadState('networkidle');
  await shot(page, J, 'revoked');
  const after = await outsider.goto(share);
  expect(after?.status()).toBe(410);
  await shot(outsider, J, 'proof-gone');
  await visitor.close();
});

test.fixme('the developer cannot see the card or mint a report (CC-37 D5; needs CC-37 on origin/main)', () => {});
