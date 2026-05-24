import { test, expect } from '@playwright/test';

test.describe('landing page', () => {
  test('renders the hero headline and URL form', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /grade your store/i })).toBeVisible();
    await expect(page.getByPlaceholder(/your-store\.com/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /grade it/i })).toBeVisible();
  });

  test('shows validation error for invalid URLs', async ({ page }) => {
    await page.goto('/');
    const input = page.getByPlaceholder(/your-store\.com/i);
    const button = page.getByRole('button', { name: /grade it/i });
    await input.fill('not a url');
    await button.click();
    await expect(page.getByText(/please enter a valid url|invalid/i)).toBeVisible({ timeout: 5000 });
  });

  test('header navigation works', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation').getByRole('link', { name: 'Pricing' }).click();
    await expect(page).toHaveURL(/\/pricing/);
  });
});
