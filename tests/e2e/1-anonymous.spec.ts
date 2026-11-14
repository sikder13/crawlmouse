import { expect, test } from './pw';
import { control, shot, sql, STANDIN } from './walk';

/**
 * Journey 1 (CC-38 D4): a visitor checks a site with no account, reads the result and a fix, signs
 * up from it, and lands signed in with the site kept. The check is finished by the walk's worker
 * from the recorded crawl (harness/checks.ts); nothing is fetched.
 */
const J = '1-anonymous';
const HOST = 'anonymous.walk.crawlmouse.com';
const EMAIL = 'visitor@walk.example';

test('anonymous check → result → fix → sign-up → first login', async ({ page }) => {
  await page.goto('/');
  await shot(page, J, 'home');

  const started = page.waitForResponse(
    (r) => r.url().endsWith('/api/checks') && r.request().method() === 'POST',
  );
  await page.getByLabel('Website URL').first().fill(HOST);
  await page.getByRole('button', { name: 'Start the audit' }).first().click();
  expect((await started).status()).toBe(200);
  // The form goes to the check's page as soon as it is answered; the id is read from there.
  await page.waitForURL(/\/audit\/[0-9a-f-]{36}/);
  const checkId = /\/audit\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await shot(page, J, 'waiting');

  const [site] = await sql<{ site_id: string; account_id: string | null }>(
    `select c.site_id, s.account_id from public.checks c join public.sites s on s.id = c.site_id where c.id = $1`,
    [checkId],
  );
  expect(site?.account_id).toBeNull();
  await control('finish', { siteId: site!.site_id });

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(HOST).first()).toBeVisible();
  await shot(page, J, 'result');

  // The first fix the result offers, opened.
  await page.getByRole('link', { name: 'Open the fix' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shot(page, J, 'fix');

  // Sign up from the result: the sign-in link is recorded by the stand-in instead of mailed.
  await page.goto(`/audit/${checkId}`);
  await page
    .getByRole('link', { name: /Keep this audit/ })
    .first()
    .click();
  await shot(page, J, 'sign-up');
  await page.getByPlaceholder('you@company.com').fill(EMAIL);
  const sent = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/'),
  );
  await page.getByRole('button', { name: 'Keep it' }).click();
  const claim = await sent;
  expect(claim.status(), claim.url()).toBeLessThan(300);
  await shot(page, J, 'link-sent');

  const link = (await (
    await fetch(`${STANDIN}/__harness/link?email=${encodeURIComponent(EMAIL)}`)
  ).json()) as {
    token_hash: string;
  };
  await page.goto(`/login/verify?token_hash=${link.token_hash}&type=email`);
  await shot(page, J, 'link-opened');
  // The link page asks once more, so a mail scanner's GET spends nothing.
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'You’re signed in.' })).toBeVisible();
  await expect(page.getByText(`Signed in as ${EMAIL}.`)).toBeVisible();
  await shot(page, J, 'signed-in');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.waitForLoadState('networkidle');
  await shot(page, J, 'first-login');

  // The first login gave the visitor an account, and the checked site is in it.
  const kept = await sql<{ n: number }>(
    `select count(*)::int n from public.sites s join public.users u on u.default_account_id = s.account_id
      where u.email = $1 and s.host = $2`,
    [EMAIL, HOST],
  );
  expect(kept[0]?.n).toBe(1);
  // "One email creates a free account and starts 14 days of Pro": the keep bar's promise.
  const [account] = await sql<{ state: string; trial_variant: string | null }>(
    `select a.state, a.trial_variant from public.accounts a join public.users u on u.default_account_id = a.id
      where u.email = $1`,
    [EMAIL],
  );
  expect(account).toEqual({ state: 'pro_trial', trial_variant: 'no_card' });
});
