import { test, expect } from '@playwright/test';

// Pricing page is public (no auth) — this verifies the annual-default toggle and the Pro CTA.
// The full purchase loop (Checkout → webhook → pro_until → CSV) is a manual/live verification
// documented in the Plan 4 plan's "Manual" section (needs `stripe listen` + a logged-in user).
test('pricing toggle switches price and the Pro CTA renders', async ({ page }) => {
  await page.goto('/pricing');
  // Annual is the default.
  await expect(page.getByText('$190', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Monthly' }).click();
  await expect(page.getByText('$19', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Upgrade — Pro/ })).toBeVisible();
});
