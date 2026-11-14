import { existsSync } from 'node:fs';
import { expect, test } from './pw';
import { control, NEEDS_SEED, qa, SEEDED, shot, signIn } from './walk';

/**
 * Journey 7 (CC-38 D4): the help centre, the status page, the error screen and the support link a
 * person reaches from it (CC-33). The error screen is reached the way a real failure reaches it: the
 * stand-in answers one database request 500 (`fail-once`), and the page's server read throws.
 */
const J = '7-support';
/** CC-33 adds /help and the support links; until it is on the tree those steps are todo (Q1). */
const HAS_HELP = existsSync(new URL('../../apps/web/app/help/page.tsx', import.meta.url));
const NEEDS_CC33 = 'needs /help and the support links from CC-33 (PR #83)';

test('/status answers and names the service', async ({ page }) => {
  const r = await page.goto('/status');
  expect(r?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shot(page, J, 'status');
});

if (HAS_HELP) {
  test('/help lists the articles and one opens', async ({ page }) => {
    expect((await page.goto('/help'))?.status()).toBe(200);
    await shot(page, J, 'help');
    const article = page.locator('main a[href^="/help/"]').first();
    await article.click();
    await expect(page.locator('h1')).toHaveCount(1);
    await shot(page, J, 'help-article');
  });
} else {
  test.fixme(`/help lists the articles and one opens (${NEEDS_CC33})`, () => {});
}

if (HAS_HELP && SEEDED) {
  test('a failed read shows the error screen, with the support link', async ({ page, context }) => {
    await signIn(context, qa('free'));
    await control('fail-once', { path: 'sites' });
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: /email support/i })).toBeVisible();
    const href = await page.getByRole('link', { name: /email support/i }).getAttribute('href');
    expect(href).toMatch(/^mailto:/);
    await shot(page, J, 'error-screen');
  });
} else {
  test.fixme(`a failed read shows the error screen, with the support link (${NEEDS_CC33}; ${NEEDS_SEED})`, () => {});
}
