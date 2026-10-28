import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from './pw';
import { HEIGHT, WIDTHS, fitViewportToPage } from './pages';

/**
 * Renders of the locked design HTML (docs/design/v2/screens), the "before" images for a review of
 * the rebuilt screens. Off by default; VISUAL_REFERENCE=1 writes them to tests/visual/reference/.
 * The locked pages load IBM Plex from Google Fonts, the face the brand fonts replace.
 */
const SCREENS = [
  { file: 'Final-Home.dc.html', name: 'home', scheme: 'light' },
  { file: 'Final-Result.dc.html', name: 'result', scheme: 'light' },
  { file: 'Final-Result-Dark.dc.html', name: 'result', scheme: 'dark' },
] as const;

const SCREEN_DIR = fileURLToPath(new URL('../../docs/design/v2/screens/', import.meta.url));
const OUT = fileURLToPath(new URL('./reference/', import.meta.url));

test.describe('locked reference renders', () => {
  test.skip(!process.env.VISUAL_REFERENCE, 'set VISUAL_REFERENCE=1 to render the locked HTML');

  for (const width of WIDTHS) {
    for (const s of SCREENS) {
      test(`${s.file} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: HEIGHT[width] });
        await page.goto(pathToFileURL(SCREEN_DIR + s.file).href, { waitUntil: 'load' });
        // The design canvas shows both keep-bar states; the page opens with the first.
        await page.addStyleTag({ content: 'sc-if + sc-if { display: none !important; }' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(3500);
        await fitViewportToPage(page);
        await page.screenshot({
          path: `${OUT}${s.name}-${width}-${s.scheme}.png`,
          animations: 'disabled',
        });
      });
    }
  }
});
