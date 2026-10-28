import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from './pw';

/**
 * A frame strip of the crawl screen's replay, for review: the stage at moments through the bad-site
 * recording, each opened paused there. Off by default; VISUAL_FRAMES=1 writes
 * tests/visual/frames/crawl-<ms>.png, the stage at each moment at 1280px, light.
 */
const MOMENTS = [3_000, 20_000, 47_000, 71_500, 90_000, 115_000, 131_000];
const OUT = fileURLToPath(new URL('./frames/', import.meta.url));

test.describe('crawl frame strip', () => {
  test.skip(!process.env.VISUAL_FRAMES, 'set VISUAL_FRAMES=1 to draw the frame strip');
  test.use({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });

  for (const at of MOMENTS) {
    test(`at ${at} ms`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true });
      await page.goto(`/v2-preview/screens/crawl?at=${at}`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      // An unstyled render (the dev server's cache can lose its layout CSS) is refused, not drawn.
      const token = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--v2-bg').trim(),
      );
      expect(token, 'the design tokens are loaded').not.toBe('');
      // The stage: the status panel, the map, the log and the crawler verdicts.
      const stage = page.locator('main > section').nth(1);
      await stage.screenshot({
        path: `${OUT}crawl-${String(at).padStart(6, '0')}.png`,
        animations: 'disabled',
      });
    });
  }
});
