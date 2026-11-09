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
  { path: '/v2-preview/screens/segment/access', file: 'Final-Segment.dc.html' },
  { path: '/v2-preview/screens/segment/nojs', file: 'Final-Seg-JS.dc.html' },
  { path: '/v2-preview/screens/segment/structure', file: 'Final-Seg-Structure.dc.html' },
  { path: '/v2-preview/screens/segment/content', file: 'Final-Seg-Content.dc.html' },
  { path: '/v2-preview/screens/segment/signals', file: 'Final-Seg-Signals.dc.html' },
  { path: '/v2-preview/screens/segment/changes', file: 'Final-Seg-Changes.dc.html' },
  { path: '/v2-preview/screens/fix', file: 'Final-Fix.dc.html' },
  { path: '/v2-preview/screens/map', file: 'Final-LinkMap.dc.html' },
  { path: '/v2-preview/screens/dashboard/day0', file: 'Final-Dashboard-Day0.dc.html' },
  // The locked competitor card's table (the sixth) is not built: competitor data is a later step.
  { path: '/v2-preview/screens/dashboard', file: 'Final-Dashboard.dc.html', lockedOmit: [5] },
  { path: '/v2-preview/screens/site', file: 'Final-Site.dc.html' },
] as const;

const SCREEN_DIR = fileURLToPath(new URL('../../docs/design/v2/screens/', import.meta.url));

/**
 * For each drawn table in page order: does it overflow the element that wraps it? A table for
 * screen readers only (a chart's text alternative) is not drawn, so it is not counted.
 */
async function tableOverflow(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('table'))
      .filter((t) => !t.closest('[data-v2-sr-only]'))
      .map((t) => {
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
        const omit: readonly number[] = 'lockedOmit' in s ? s.lockedOmit : [];
        const locked = (await tableOverflow(lockedPage)).filter((_, i) => !omit.includes(i));
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
