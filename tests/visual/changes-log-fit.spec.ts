import { test, expect, type Page } from './pw';
import { openPreview } from './pages';

/**
 * F-100: the account's Changes log fits a desktop window. The table's scroll region must not be
 * wider inside than out, so the cause and who was told are on screen without scrolling sideways.
 * A fix title carries a crawled URL and a notice a Slack channel, so the rows are also measured
 * with long strings that hold no space, of the shapes that broke the layout.
 */
const LOG = '/v2-preview/screens/changes-log';

const UNBROKEN: Record<string, string> = {
  'as the fixture holds them': '',
  'a percent-encoded URL': `https://example.com/${'%E3%81%82'.repeat(14)}`,
  'an underscored URL': `https://example.com/${'long_path_name_'.repeat(6)}`,
  'a query string': `https://example.com/p?${'utm_source=newsletter&'.repeat(4)}`,
  'a long Slack channel': `#${'c'.repeat(46)}`,
};

async function widths(page: Page, text: string) {
  return page
    .locator('table')
    .first()
    .evaluate((table, extra) => {
      if (extra) {
        for (const cell of Array.from(table.querySelectorAll('tbody th, tbody td'))) {
          (cell.firstElementChild ?? cell).append(` ${extra}`);
        }
      }
      const region = table.parentElement!;
      return { inside: region.scrollWidth, outside: region.clientWidth };
    }, text);
}

for (const width of [1280, 1440]) {
  for (const [name, text] of Object.entries(UNBROKEN)) {
    test(`the Changes log's table fits at ${width}, with ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openPreview(page, LOG);
      const { inside, outside } = await widths(page, text);
      expect(inside, `table ${inside}px in a region of ${outside}px`).toBeLessThanOrEqual(outside);
      await expect(page.getByRole('columnheader', { name: /who was told/i })).toBeInViewport({
        ratio: 1,
      });
    });
  }
}
