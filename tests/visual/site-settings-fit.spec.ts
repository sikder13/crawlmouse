import { test, expect } from './pw';
import { openPreview } from './pages';

/**
 * F-110: with its fields on a signed-in page, the site's settings card holds them at every width.
 * The widths include those where the card sits beside the alerts card and is at its narrowest.
 */
const LIVE = '/v2-preview/screens/site?live=1';

for (const width of [390, 761, 900, 1000, 1280, 1301, 1366, 1440, 1536, 1600, 1920]) {
  test(`the site settings card holds its fields at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openPreview(page, LIVE);
    const table = page.getByRole('table', { name: 'Site settings' });
    await expect(table.locator('input[type="text"]').first()).toBeVisible();
    const { inside, outside, past } = await table.evaluate((t) => {
      const region = t.parentElement!;
      const edge = region.getBoundingClientRect().right;
      const controls = t.querySelectorAll('input:not([type="hidden"]), select, button');
      return {
        inside: region.scrollWidth,
        outside: region.clientWidth,
        past: [...controls].filter((c) => c.getBoundingClientRect().right > edge + 0.5).length,
      };
    });
    expect(inside, `table ${inside}px in a card of ${outside}px`).toBeLessThanOrEqual(outside);
    expect(past, 'controls past the card edge').toBe(0);
  });
}
