import { test, expect, type Page } from './pw';
import {
  HEIGHT,
  KEPT_PAGES,
  MAIL_HEIGHT,
  MAIL_PREVIEWS,
  MAIL_WIDTHS,
  PREVIEWS,
  SCHEMES,
  WIDTHS,
  fitViewportToPage,
  openPreview,
  openV1Page,
} from './pages';

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
          await expect(page).toHaveScreenshot(`${p.slug}-${width}-${colorScheme}.png`);
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

// Each email template's preview at a mail client's widths, light and dark (CC-28 D2): the message's
// HTML in its frame, between its subject and its text part.
for (const width of MAIL_WIDTHS) {
  for (const colorScheme of SCHEMES) {
    test.describe(`mail ${width}px ${colorScheme}`, () => {
      test.use({ viewport: { width, height: MAIL_HEIGHT[width] }, colorScheme });

      for (const p of MAIL_PREVIEWS) {
        test(`${p.name}`, async ({ page }) => {
          await openPreview(page, p.path);
          await fitViewportToPage(page);
          await expect(page).toHaveScreenshot(`${p.slug}-${width}-${colorScheme}.png`);
        });
      }
    });
  }
}

// Each kept v1 public page (CC-36 D3) at 1280 and 390 px: as v1 serves it at its own address, which
// has no dark scheme, and in the v2 shell as its target draws it, light and dark.
for (const width of WIDTHS) {
  for (const colorScheme of SCHEMES) {
    test.describe(`kept ${width}px ${colorScheme}`, () => {
      test.use({ viewport: { width, height: HEIGHT[width] }, colorScheme });

      for (const p of KEPT_PAGES) {
        if (colorScheme === 'light') {
          test(`${p.name}, v1`, async ({ page }) => {
            await openV1Page(page, p.v1);
            await fitViewportToPage(page);
            await expect(page).toHaveScreenshot(`kept-${p.slug}-v1-${width}.png`);
          });
        }
        test(`${p.name}, in the v2 shell`, async ({ page }) => {
          await openPreview(page, p.v2);
          await pinYear(page);
          await fitViewportToPage(page);
          await expect(page).toHaveScreenshot(`kept-${p.slug}-v2-${width}-${colorScheme}.png`);
        });
      }
    });
  }
}
