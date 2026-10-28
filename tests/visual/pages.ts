import { expect, type Page } from './pw';
import { PREVIEWS } from '../../apps/web/app/(v2-preview)/v2-preview/_preview/registry';

export { PREVIEWS };

export const WIDTHS = [1280, 390] as const;
export const SCHEMES = ['light', 'dark'] as const;
export const HEIGHT = { 1280: 900, 390: 844 } as const;

/** '/v2-preview/screens/home' -> 'screen-home'; '/v2-preview/button' -> 'button'. */
export const slugOf = (path: string) =>
  path.replace('/v2-preview/', '').replace(/^screens\//, 'screen-');

/**
 * Open a preview and bring it to the state it is captured in: fonts loaded, and on a page with
 * the keep bar, the bar revealed the way a reader reveals it, by scrolling.
 */
export async function openPreview(page: Page, path: string) {
  const res = await page.goto(path, { waitUntil: 'load' });
  expect(res?.status(), `${path} should be served in development`).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  if (await page.locator('[data-v2-keep]').count()) {
    await expect
      .poll(
        async () => {
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          return page.locator('[data-v2-keep="open"]').count();
        },
        { message: 'the keep bar opens once the reader scrolls', timeout: 20_000 },
      )
      .toBe(1);
  }
}

/**
 * Grow the viewport to the page's full height, so one ordinary capture holds the whole page and a
 * sticky element sits where the page ends. The harness does not use Playwright's fullPage mode:
 * in Chromium it left the Home stage's two grade cards out of the image, while an ordinary capture
 * of the same page, and of a viewport this tall, both show them (measured while building CC-21).
 */
export async function fitViewportToPage(page: Page) {
  const size = page.viewportSize();
  if (!size) throw new Error('no viewport');
  for (let i = 0; i < 4; i++) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height === page.viewportSize()?.height) return;
    await page.setViewportSize({ width: size.width, height });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  }
  throw new Error('the page height did not settle after resizing the viewport');
}
