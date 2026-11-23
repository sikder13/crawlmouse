import { test, expect } from './pw';
import { openPreview } from './pages';

/**
 * F-100: the account's Changes log fits a desktop window. The table's scroll region must not be
 * wider inside than out, so the cause and who was told are on screen without scrolling sideways.
 */
const LOG = '/v2-preview/screens/changes-log';

for (const width of [1280, 1440]) {
  test(`the Changes log's table fits at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openPreview(page, LOG);
    const region = page.locator('table').first().locator('xpath=..');
    const { inside, outside } = await region.evaluate((el) => ({
      inside: el.scrollWidth,
      outside: el.clientWidth,
    }));
    expect(inside, `table ${inside}px in a region of ${outside}px`).toBeLessThanOrEqual(outside);
    await expect(page.getByRole('columnheader', { name: /who was told/i })).toBeInViewport({
      ratio: 1,
    });
  });
}
