import { test, expect, type Page } from './pw';
import { HEIGHT, PREVIEWS, SCHEMES, WIDTHS, fitViewportToPage, openPreview, slugOf } from './pages';

/**
 * The footer renders the current year, so a baseline would move every 1 January. Screenshots show
 * it pinned; __tests__/v2/footer.test.tsx checks the footer renders the real one.
 */
const PINNED_YEAR = '2026';

async function pinYear(page: Page) {
  await page.evaluate((year) => {
    document.querySelectorAll('[data-v2-year]').forEach((el) => {
      el.textContent = year;
    });
  }, PINNED_YEAR);
}

// One whole-page baseline per preview page, width and colour scheme (see fitViewportToPage). A
// diff above 0.2% of the pixels fails (playwright.config.ts). README.md says how to update a
// baseline on purpose.
for (const width of WIDTHS) {
  for (const colorScheme of SCHEMES) {
    test.describe(`${width}px ${colorScheme}`, () => {
      test.use({ viewport: { width, height: HEIGHT[width] }, colorScheme });

      for (const p of PREVIEWS) {
        test(`${p.name}`, async ({ page }) => {
          await openPreview(page, p.path);
          await pinYear(page);
          await fitViewportToPage(page);
          await expect(page).toHaveScreenshot(`${slugOf(p.path)}-${width}-${colorScheme}.png`);
        });
      }

      // The footer on its own, from the PageShell preview: the same pixels as the bottom of that
      // page's baseline, cut out so a change to the footer reads at a glance.
      test('footer', async ({ page }) => {
        await openPreview(page, '/v2-preview/page-shell');
        await pinYear(page);
        await fitViewportToPage(page);
        await expect(page.locator('footer')).toHaveScreenshot(`footer-${width}-${colorScheme}.png`);
      });
    });
  }
}
