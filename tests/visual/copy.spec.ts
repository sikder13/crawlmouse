import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect, type Page } from './pw';
import { HEIGHT, WIDTHS, openPreview } from './pages';
import {
  FOOTER_COLUMNS,
  FOOTER_COPY,
  MARKETING_NAV,
  SUPPORT_EMAIL,
} from '../../apps/web/components/v2/footer-links';
import {
  applyChanges,
  withoutAddedText,
  type LockedScreen,
} from '../../apps/web/lib/v2/copy-registry';

/**
 * The rebuilt screens read exactly as the locked HTML does, spacing included, apart from the
 * changes apps/web/lib/v2/copy-registry.ts lists: both are rendered in Chromium and their visible
 * text (innerText) is compared with runs of whitespace collapsed to one space, so a word split in
 * two or two words run together fails, while a line break that became a space does not. The
 * registry's changes are applied to the locked text first; an entry that matches nothing fails.
 * Left out on both sides: screen-reader-only text, the typed status glyphs the build draws instead
 * (decision i), and the locked canvas's second state of a toggled block (the page opens with the
 * first). Left out of the rebuild: what the brief adds (`data-v2-addition`, the evidence class
 * beside a verdict, and the registered added text). The keep bar is compared open; the crawl
 * screen at the moment it was locked. Both widths, since a phone layout can hide or show copy the
 * desktop one does not.
 *
 * The header's primary navigation and the footer are left out on both sides: CC-21b changed them
 * from the lock on purpose, and the second test checks their spacing against
 * components/v2/footer-links.ts instead.
 */
const SCREENS: { path: string; file: string; scheme: 'light' | 'dark'; screen: LockedScreen }[] = [
  { path: '/v2-preview/screens/home', file: 'Final-Home.dc.html', scheme: 'light', screen: 'home' },
  {
    path: '/v2-preview/screens/result',
    file: 'Final-Result.dc.html',
    scheme: 'light',
    screen: 'result',
  },
  {
    path: '/v2-preview/screens/result',
    file: 'Final-Result-Dark.dc.html',
    scheme: 'dark',
    screen: 'result',
  },
  {
    path: '/v2-preview/screens/crawl?at=47000',
    file: 'Final-Crawl.dc.html',
    scheme: 'light',
    screen: 'crawl',
  },
];

const SCREEN_DIR = fileURLToPath(new URL('../../docs/design/v2/screens/', import.meta.url));

const HIDE = `
  [data-v2-sr-only], label[style*="-9999px"], sc-if + sc-if { display: none !important; }
`;
const ADDED = '[data-v2-addition], [data-v2-evidence] { display: none !important; }';
const SHELL = 'nav[aria-label="Primary"], footer';

const collapse = (text: string) =>
  text
    .replace(/[●▲■○]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

async function visibleText(page: Page, rebuilt?: LockedScreen) {
  await page.addStyleTag({
    content: `${HIDE} ${SHELL} { display: none !important; } ${rebuilt ? ADDED : ''}`,
  });
  const text = await page.evaluate(() => document.body.innerText);
  return collapse(rebuilt ? withoutAddedText(text, rebuilt) : text);
}

/** The visible text of one element, screen-reader text left out. */
async function textOf(page: Page, selector: string) {
  await page.addStyleTag({ content: HIDE });
  return collapse(await page.locator(selector).innerText());
}

/** What the header shows with the Learn menu closed, and the footer, word for word, from the map. */
const NAV_FROM_MAP = MARKETING_NAV.map((e) => e.label).join(' ');
const footerFromMap = () =>
  [
    'crawlmouse',
    FOOTER_COPY.line,
    FOOTER_COPY.company,
    SUPPORT_EMAIL,
    'Copy address',
    `© ${new Date().getFullYear()}`,
    ...FOOTER_COLUMNS.flatMap((c) => [c.title, ...c.items.map((i) => i.label)]),
  ].join(' ');

/** The first point where two texts part, with some context either side. */
function firstDifference(a: string, b: string): string | null {
  if (a === b) return null;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}:\n  locked:   …${a.slice(Math.max(0, i - 50), i + 70)}\n  rendered: …${b.slice(Math.max(0, i - 50), i + 70)}`;
}

for (const width of WIDTHS) {
  for (const s of SCREENS) {
    test.describe(`${s.file} at ${width}px`, () => {
      test.use({ viewport: { width, height: HEIGHT[width] }, colorScheme: s.scheme });

      test('the rebuilt screen reads as the locked HTML with the registered changes, spacing included', async ({
        page,
        context,
      }) => {
        await openPreview(page, s.path);
        const rendered = await visibleText(page, s.screen);

        const lockedPage = await context.newPage();
        await lockedPage.goto(pathToFileURL(SCREEN_DIR + s.file).href, { waitUntil: 'load' });
        const locked = await visibleText(lockedPage);
        await lockedPage.close();

        expect(locked.length).toBeGreaterThan(500);
        expect(firstDifference(applyChanges(locked, s.screen), rendered)).toBeNull();
      });
    });
  }

  test.describe(`header and footer copy at ${width}px`, () => {
    test.use({ viewport: { width, height: HEIGHT[width] } });

    test('read as footer-links.ts says, spacing included', async ({ page }) => {
      await openPreview(page, '/v2-preview/screens/home');
      expect(
        firstDifference(NAV_FROM_MAP, await textOf(page, 'nav[aria-label="Primary"]')),
      ).toBeNull();
      expect(firstDifference(footerFromMap(), await textOf(page, 'footer'))).toBeNull();
    });
  });
}
