import { expect, type Page } from './pw';
import { PREVIEWS as REGISTRY } from '../../apps/web/app/(v2-preview)/v2-preview/_preview/registry';
import { MAIL_PREVIEW_INDEX as MAIL_REGISTRY } from '../../apps/web/lib/v2/mail/templates/preview-index';
import { KEPT_PREVIEW_INDEX as KEPT_REGISTRY } from '../../apps/web/app/(v2-preview)/kept-preview/_lib/kept-index';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ONCE_SPECS, owner, parsePart, routesNamedIn } from './part';

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
const ALL_PREVIEWS = REGISTRY.flatMap((p) =>
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

/**
 * Every email template's preview page (`apps/web/lib/v2/mail/templates/preview-index.ts`), screenshotted at
 * a mail client's widths: 600 px, the layout's column, and 390 px, a phone.
 */
const ALL_MAIL_PREVIEWS = MAIL_REGISTRY.map((p) => ({
  path: `/mail-preview/${p.slug}`,
  name: `Mail: ${p.name}`,
  slug: `mail-${p.slug}`,
}));
/**
 * Each kept v1 public page (CC-36 D3, `apps/web/app/(v2-preview)/kept-preview/_lib/kept-index.ts`)
 * in both states: `v1`, its own address, which `next dev` serves as v1 (the harness does not set
 * V2_CHECKS_PUBLIC), and `v2`, its preview in the v2 shell. The two go to the same share, by `v1`.
 */
const ALL_KEPT_PAGES = KEPT_REGISTRY.map((p) => ({ ...p, v2: `/kept-preview/${p.slug}` }));

/** This job's share of the routes (part.ts): every route unless VISUAL_PART is set. */
export const PART = parsePart(process.env.VISUAL_PART);
export const ownsPath = owner(
  [...ALL_PREVIEWS, ...ALL_MAIL_PREVIEWS, ...ALL_KEPT_PAGES.map((p) => ({ path: p.v1 }))].map(
    (p) => p.path,
  ),
  PART,
  ONCE_SPECS.flatMap((f) =>
    routesNamedIn(readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), 'utf8')),
  ),
);
export const PREVIEWS = ALL_PREVIEWS.filter((p) => ownsPath(p.path));
export const MAIL_PREVIEWS = ALL_MAIL_PREVIEWS.filter((p) => ownsPath(p.path));
export const KEPT_PAGES = ALL_KEPT_PAGES.filter((p) => ownsPath(p.v1));

export const MAIL_WIDTHS = [600, 390] as const;
export const MAIL_HEIGHT = { 600: 900, 390: 844 } as const;

export const WIDTHS = [1280, 390] as const;
/** The layout checks add 1000px, the narrowest desktop width DESIGN-LOCK §7.1 renders. */
export const LAYOUT_WIDTHS = [1280, 1000, 390] as const;
export const SCHEMES = ['light', 'dark'] as const;
export const HEIGHT = { 1280: 900, 1000: 900, 390: 844 } as const;

/**
 * Open a preview and bring it to the state it is checked in: fonts loaded, every finite animation
 * finished (a check that runs mid-fade sees half-transparent text), and on a page with the keep
 * bar, the bar revealed the way a reader reveals it, by scrolling.
 */
export async function openPreview(page: Page, path: string) {
  const res = await page.goto(path, { waitUntil: 'load' });
  expect(res?.status(), `${path} should be served in development`).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  // A dev server whose cache lost its layout CSS serves the page unstyled with a 200; every check
  // on such a page would be about the wrong page.
  const token = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--v2-bg').trim(),
  );
  expect(token, `${path}: the design tokens are loaded`).not.toBe('');
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

/**
 * Open a kept v1 page at its own address and bring it to rest: fonts loaded, the network quiet
 * (its header asks for the session), every finite animation finished. It loads no v2 tokens, so
 * `openPreview`'s check for them does not apply.
 */
export async function openV1Page(page: Page, path: string) {
  const res = await page.goto(path, { waitUntil: 'load' });
  expect(res?.status(), `${path} should be served in development`).toBe(200);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await settleAnimations(page);
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
  // A page at least a screen tall (the crawl screen's main) would grow with the viewport and never
  // settle: its minimum is fixed first at what the first screen made it, in pixels.
  await page.evaluate(() =>
    document.querySelectorAll('main').forEach((m) => {
      m.style.minHeight = getComputedStyle(m).minHeight;
    }),
  );
  for (let i = 0; i < 4; i++) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height === page.viewportSize()?.height) return;
    await page.setViewportSize({ width: size.width, height });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  }
  throw new Error('the page height did not settle after resizing the viewport');
}
