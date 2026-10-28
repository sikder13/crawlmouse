import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect, type Page } from './pw';
import { HEIGHT, WIDTHS, openPreview } from './pages';

/**
 * A table that fits its container in the locked screen must fit it in the rebuild too. The layout
 * check lets a table scroll sideways (tables of records scroll on phones), so on its own it cannot
 * tell a table the lock also scrolls from one the rebuild made too wide. This compares the two,
 * table by table in page order, rendered side by side at each width.
 */
const SCREENS = [
  { path: '/v2-preview/screens/home', file: 'Final-Home.dc.html' },
  { path: '/v2-preview/screens/result', file: 'Final-Result.dc.html' },
] as const;

const SCREEN_DIR = fileURLToPath(new URL('../../docs/design/v2/screens/', import.meta.url));

/** For each table in page order: does it overflow the element that wraps it? */
async function tableOverflow(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('table')).map((t) => {
      const box = t.parentElement;
      return box ? box.scrollWidth > box.clientWidth + 1 : false;
    }),
  );
}

for (const width of WIDTHS) {
  test.describe(`tables at ${width}px`, () => {
    test.use({ viewport: { width, height: HEIGHT[width] } });

    for (const s of SCREENS) {
      test(`${s.file}: no table overflows where the locked one fits`, async ({ page, context }) => {
        await openPreview(page, s.path);
        const ours = await tableOverflow(page);

        const lockedPage = await context.newPage();
        await lockedPage.goto(pathToFileURL(SCREEN_DIR + s.file).href, { waitUntil: 'load' });
        const locked = await tableOverflow(lockedPage);
        await lockedPage.close();

        expect(ours.length, 'same number of tables').toBe(locked.length);
        const tooWide = ours
          .map((over, i) => (over && !locked[i] ? `table ${i + 1}` : null))
          .filter(Boolean);
        expect(tooWide).toEqual([]);
      });
    }
  });
}
