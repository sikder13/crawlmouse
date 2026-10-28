import { expect, type Page } from './pw';
import { PREVIEWS as REGISTRY } from '../../apps/web/app/(v2-preview)/v2-preview/_preview/registry';

/** '/v2-preview/screens/home' -> 'screen-home'; '/v2-preview/button' -> 'button'. */
export const slugOf = (path: string) =>
  path
    .replace('/v2-preview/', '')
    .replace(/^screens\//, 'screen-')
    .replace(/\//g, '-');

/**
 * Every page the harness checks: each preview, and a screen that plays a recording once at each
 * of its moments, opened paused there. `orange` is how many orange elements it should show.
 */
export const PREVIEWS = REGISTRY.flatMap((p) =>
  p.moments
    ? p.moments.map((m) => ({
        path: `${p.path}${m.query}`,
        name: `${p.name} (${m.name})`,
        kind: p.kind,
        slug: `${slugOf(p.path)}-${m.name}`,
        orange: m.orange,
      }))
    : [{ ...p, slug: slugOf(p.path), orange: p.orange ?? (p.kind === 'screen' ? 1 : null) }],
);

export const WIDTHS = [1280, 390] as const;
export const SCHEMES = ['light', 'dark'] as const;
export const HEIGHT = { 1280: 900, 390: 844 } as const;

/**
 * Open a preview and bring it to the state it is checked in: fonts loaded, every finite animation
 * finished (the Home stage's cards fade in over 3.4 s, and a check that runs mid-fade sees
 * half-transparent text), and on a page with the keep bar, the bar revealed the way a reader
 * reveals it, by scrolling.
 */
export async function openPreview(page: Page, path: string) {
  const res = await page.goto(path, { waitUntil: 'load' });
  expect(res?.status(), `${path} should be served in development`).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await settleAnimations(page);
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

/** Wait until every animation on the page that has an end has reached it. */
export async function settleAnimations(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

/** The site's accent oranges as computed colours: --v2-acc and its hover, --v2-acc2. */
export const ORANGES = ['rgb(255, 120, 73)', 'rgb(255, 131, 82)'];

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
