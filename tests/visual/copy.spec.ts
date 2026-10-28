import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect, type Page } from './pw';
import { openPreview } from './pages';

/**
 * The rebuilt screens read exactly as the locked HTML does, spacing included: both are rendered in
 * Chromium and their visible text (innerText) is compared with runs of whitespace collapsed to one
 * space, so a word split in two or two words run together fails, while a line break that became a
 * space does not. Left out on both sides: screen-reader-only text, the typed status glyphs the
 * build draws instead (decision i), and the locked canvas's second keep-bar state (the page opens
 * with the first). The keep bar is compared open.
 */
const SCREENS = [
  { path: '/v2-preview/screens/home', file: 'Final-Home.dc.html', scheme: 'light' },
  { path: '/v2-preview/screens/result', file: 'Final-Result.dc.html', scheme: 'light' },
  { path: '/v2-preview/screens/result', file: 'Final-Result-Dark.dc.html', scheme: 'dark' },
] as const;

const SCREEN_DIR = fileURLToPath(new URL('../../docs/design/v2/screens/', import.meta.url));

const HIDE = `
  [data-v2-sr-only], label[style*="-9999px"], sc-if + sc-if { display: none !important; }
`;

async function visibleText(page: Page) {
  await page.addStyleTag({ content: HIDE });
  const text = await page.evaluate(() => document.body.innerText);
  return text
    .replace(/[●▲■○]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first point where two texts part, with some context either side. */
function firstDifference(a: string, b: string): string | null {
  if (a === b) return null;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}:\n  locked:   …${a.slice(Math.max(0, i - 50), i + 70)}\n  rendered: …${b.slice(Math.max(0, i - 50), i + 70)}`;
}

for (const s of SCREENS) {
  test.describe(`${s.file}`, () => {
    test.use({ viewport: { width: 1280, height: 900 }, colorScheme: s.scheme });

    test('the rebuilt screen reads exactly as the locked HTML, spacing included', async ({
      page,
      context,
    }) => {
      await openPreview(page, s.path);
      const rendered = await visibleText(page);

      const lockedPage = await context.newPage();
      await lockedPage.goto(pathToFileURL(SCREEN_DIR + s.file).href, { waitUntil: 'load' });
      const locked = await visibleText(lockedPage);
      await lockedPage.close();

      expect(locked.length).toBeGreaterThan(500);
      expect(firstDifference(locked, rendered)).toBeNull();
    });
  });
}
