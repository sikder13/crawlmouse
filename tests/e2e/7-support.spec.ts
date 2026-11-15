import { expect, test } from './pw';
import { control, qa, shot, signIn } from './walk';

/**
 * Journey 7 (CC-38 D4): the status page, the help centre, the error screen and the support link a
 * person reaches from it (CC-33). The error screen is reached the way a real failure reaches it: the
 * stand-in answers one database request 500 (`fail-once`), and the page's server read throws — the
 * Alerts page's `account_slack_last4`, as CC-33's own proof reached it.
 */
const J = '7-support';

test('/status answers and names the service', async ({ page }) => {
  const r = await page.goto('/status');
  expect(r?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shot(page, J, 'status');
});

test('/help lists the articles and one opens', async ({ page }) => {
  expect((await page.goto('/help'))?.status()).toBe(200);
  await shot(page, J, 'help');
  const article = page.locator('main a[href^="/help/"]').first();
  await article.click();
  await page.waitForURL(/\/help\/[a-z0-9-]+$/);
  await expect(page.locator('h1')).toHaveCount(1);
  await shot(page, J, 'help-article');
});

test('a failed read shows the error screen, with the support link', async ({ page, context }) => {
  await signIn(context, qa('free'));
  await control('fail-once', { path: 'rpc/account_slack_last4' });
  await page.goto('/alerts');
  await expect(
    page.getByRole('heading', { name: 'This page stopped with an error' }),
  ).toBeVisible();
  const support = page.getByRole('link', { name: 'Email support' });
  await expect(support).toBeVisible();
  expect(await support.getAttribute('href')).toMatch(/^mailto:/);
  await shot(page, J, 'error-screen');
});
