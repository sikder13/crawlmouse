import { test, expect } from './pw';
import { HEIGHT, PREVIEWS, SCHEMES, WIDTHS, fitViewportToPage, openPreview, slugOf } from './pages';

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
          await fitViewportToPage(page);
          await expect(page).toHaveScreenshot(`${slugOf(p.path)}-${width}-${colorScheme}.png`);
        });
      }
    });
  }
}
