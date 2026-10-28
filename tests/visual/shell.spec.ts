import { test, expect, type Page } from './pw';
import { HEIGHT, openPreview } from './pages';
import { FOOTER_COLUMNS, MARKETING_NAV, isGroup } from '../../apps/web/components/v2/footer-links';

/**
 * The marketing header's Learn menu and the footer, in a real browser: what jsdom cannot show
 * (keyboard order, focus leaving by Tab, layout at each width, hover paint). Axe and focus rings
 * on the open menu are checked in a11y.spec.ts with the rest of the accessibility checks.
 */
const SHELL_PAGE = '/v2-preview/page-shell';
const LEARN = MARKETING_NAV.find(isGroup);
if (!LEARN) throw new Error('the marketing nav has no Learn group');
const LEARN_LINKS = LEARN.items.filter((i) => !i.planned).map((i) => i.label);

const learn = (page: Page) => page.getByRole('button', { name: 'Learn', exact: true });
const panel = (page: Page) => page.locator('[data-v2-nav-menu] ul');
const focusedText = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText.trim() ?? '');

/** Tab from the top of the page until the Learn button has focus, as a keyboard reader gets there. */
async function tabToLearn(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    if (await learn(page).evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('Tab never reached the Learn button');
}

for (const width of [1280, 390] as const) {
  test.describe(`Learn menu at ${width}px`, () => {
    test.use({ viewport: { width, height: HEIGHT[width] } });

    test('opens from the keyboard, Tab walks its links in order, Escape closes it and returns focus', async ({
      page,
    }) => {
      await openPreview(page, SHELL_PAGE);
      await tabToLearn(page);
      await expect(learn(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(panel(page)).toBeHidden();

      await page.keyboard.press('Enter');
      await expect(learn(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(panel(page)).toBeVisible();

      const reached: string[] = [];
      for (const _ of LEARN_LINKS) {
        await page.keyboard.press('Tab');
        reached.push(await focusedText(page));
      }
      expect(reached).toEqual(LEARN_LINKS);

      await page.keyboard.press('Escape');
      await expect(learn(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(panel(page)).toBeHidden();
      expect(await learn(page).evaluate((el) => el === document.activeElement)).toBe(true);

      await page.keyboard.press('Space');
      await expect(learn(page)).toHaveAttribute('aria-expanded', 'true');
    });

    test('closes when Tab moves focus past its last link', async ({ page }) => {
      await openPreview(page, SHELL_PAGE);
      await tabToLearn(page);
      await page.keyboard.press('Enter');
      for (const _ of LEARN_LINKS) await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(learn(page)).toHaveAttribute('aria-expanded', 'false');
      expect(await focusedText(page)).toBe('Pricing');
    });

    test('closes on a click outside it', async ({ page }) => {
      await openPreview(page, SHELL_PAGE);
      await learn(page).click();
      await expect(panel(page)).toBeVisible();
      // Below the open panel: on a phone it spans the row and covers what sits under it.
      const box = await panel(page).boundingBox();
      if (!box) throw new Error('the open panel has no box');
      await page.mouse.click(8, box.y + box.height + 24);
      await expect(panel(page)).toBeHidden();
    });

    test('opens inside the viewport, with no horizontal scroll', async ({ page }) => {
      await openPreview(page, SHELL_PAGE);
      await learn(page).click();
      const box = await panel(page).boundingBox();
      if (!box) throw new Error('the open panel has no box');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    });
  });
}

/** The footer's column layout: how many distinct left edges the columns sit on, and where the brand is. */
async function footerLayout(page: Page) {
  return page.evaluate(() => {
    const footer = document.querySelector('footer');
    if (!footer) throw new Error('no footer');
    const cols = Array.from(footer.querySelectorAll('[data-v2-footer-column]')).map((c) =>
      c.getBoundingClientRect(),
    );
    const brand = footer.querySelector('[data-v2-footer-brand]')?.getBoundingClientRect();
    if (!brand || !cols[0]) throw new Error('no brand block or columns');
    return {
      columns: cols.length,
      lefts: new Set(cols.map((c) => Math.round(c.left))).size,
      brandBeside: brand.right <= cols[0].left && brand.top < cols[0].bottom,
      brandAbove: brand.bottom <= Math.min(...cols.map((c) => c.top)),
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
}

const LAYOUTS = [
  { width: 1280, lefts: 4, brand: 'beside' },
  { width: 768, lefts: 2, brand: 'above' },
  { width: 390, lefts: 1, brand: 'above' },
] as const;

for (const l of LAYOUTS) {
  test.describe(`footer at ${l.width}px`, () => {
    test.use({ viewport: { width: l.width, height: 900 } });

    test(`sets its four columns on ${l.lefts} column line(s), the brand ${l.brand} them, with no horizontal scroll`, async ({
      page,
    }) => {
      await openPreview(page, SHELL_PAGE);
      const f = await footerLayout(page);
      expect(f.columns).toBe(FOOTER_COLUMNS.length);
      expect(f.lefts).toBe(l.lefts);
      expect(l.brand === 'beside' ? f.brandBeside : f.brandAbove).toBe(true);
      expect(f.scrollWidth).toBeLessThanOrEqual(f.innerWidth);
    });
  });
}

test.describe('footer links', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('show a visible hover: the muted colour turns to the text colour, underlined', async ({
    page,
  }) => {
    await openPreview(page, SHELL_PAGE);
    const link = page.locator('footer nav a', { hasText: 'Pricing' });
    const paint = () =>
      link.evaluate((el) => {
        const s = getComputedStyle(el);
        return { color: s.color, line: s.textDecorationLine };
      });
    const before = await paint();
    await link.hover();
    const after = await paint();
    expect(before.line).toBe('none');
    expect(after.line).toBe('underline');
    expect(after.color).not.toBe(before.color);
  });

  test('point only at the map’s targets: no "#" and no empty href in the header or footer', async ({
    page,
  }) => {
    await openPreview(page, SHELL_PAGE);
    const hrefs = await page
      .locator('header a, footer a')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    const allowed = new Set([
      '/',
      ...MARKETING_NAV.flatMap((e) => (isGroup(e) ? e.items : [e])).flatMap((i) =>
        i.planned ? [] : [i.href],
      ),
      ...FOOTER_COLUMNS.flatMap((c) => c.items).flatMap((i) =>
        'href' in i && i.href ? [i.href] : [],
      ),
      '/login',
    ]);
    expect(hrefs.length).toBeGreaterThan(15);
    expect(hrefs.filter((h) => !h || h === '#' || !allowed.has(h))).toEqual([]);
  });
});
