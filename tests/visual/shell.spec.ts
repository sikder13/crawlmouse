import { test, expect, type Page } from './pw';
import { HEIGHT, openPreview } from './pages';
import {
  FOOTER_COLUMNS,
  LOG_IN,
  MARKETING_NAV,
  isGroup,
} from '../../apps/web/components/v2/footer-links';

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

    test('closes on Escape after a mouse open and a click on its padding (focus on nothing)', async ({
      page,
    }) => {
      await openPreview(page, SHELL_PAGE);
      await learn(page).click();
      const box = await panel(page).boundingBox();
      if (!box) throw new Error('the open panel has no box');
      await page.mouse.click(box.x + 3, box.y + 3);
      await expect(panel(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(learn(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(panel(page)).toBeHidden();
    });

    test('opens wholly inside the viewport, where it should, with no horizontal scroll', async ({
      page,
    }) => {
      await openPreview(page, SHELL_PAGE);
      await learn(page).click();
      const g = await page.evaluate(() => {
        const ul = document.querySelector('[data-v2-nav-menu] ul') as HTMLElement;
        const button = document.querySelector('[data-v2-nav-menu] button') as HTMLElement;
        const nav = document.querySelector('nav[aria-label="Primary"]') as HTMLElement;
        const link = ul.querySelector('a') as HTMLElement;
        const r = (el: Element) => el.getBoundingClientRect();
        return {
          panel: r(ul).toJSON() as DOMRect,
          button: r(button).toJSON() as DOMRect,
          nav: r(nav).toJSON() as DOMRect,
          linkText: r(link).left + parseFloat(getComputedStyle(link).paddingLeft),
          vw: window.innerWidth,
          vh: window.innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      expect(g.panel.left).toBeGreaterThanOrEqual(0);
      expect(g.panel.top).toBeGreaterThanOrEqual(0);
      expect(g.panel.right).toBeLessThanOrEqual(g.vw);
      expect(g.panel.bottom).toBeLessThanOrEqual(g.vh);
      expect(g.scrollWidth).toBeLessThanOrEqual(g.vw);
      if (width === 390) {
        // A phone: the panel spans the nav row, 8px under it.
        expect(Math.abs(g.panel.top - (g.nav.bottom + 8))).toBeLessThanOrEqual(1);
        expect(Math.abs(g.panel.left - g.nav.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(g.panel.right - g.nav.right)).toBeLessThanOrEqual(1);
      } else {
        // Under the button, 12px down, its links' text lined up with the button's label.
        expect(Math.abs(g.panel.top - (g.button.bottom + 12))).toBeLessThanOrEqual(1);
        expect(Math.abs(g.linkText - g.button.left)).toBeLessThanOrEqual(1);
      }
    });

    test('draws the panel as a hairline surface: a 1px line border on each side, on the raised surface', async ({
      page,
    }) => {
      await openPreview(page, SHELL_PAGE);
      await learn(page).click();
      const look = await page.evaluate(() => {
        const ul = document.querySelector('[data-v2-nav-menu] ul') as HTMLElement;
        const probe = document.createElement('div');
        probe.style.color = 'var(--v2-line)';
        probe.style.backgroundColor = 'var(--v2-s1)';
        ul.parentElement?.appendChild(probe);
        const t = getComputedStyle(probe);
        const s = getComputedStyle(ul);
        const out = {
          border: (['Top', 'Right', 'Bottom', 'Left'] as const).map((side) => [
            s.getPropertyValue(`border-${side.toLowerCase()}-width`),
            s.getPropertyValue(`border-${side.toLowerCase()}-style`),
            s.getPropertyValue(`border-${side.toLowerCase()}-color`),
          ]),
          line: t.color,
          background: s.backgroundColor,
          surface: t.backgroundColor,
          shadow: s.boxShadow,
        };
        probe.remove();
        return out;
      });
      expect(look.border).toEqual(Array(4).fill(['1px', 'solid', look.line]));
      expect(look.background).toBe(look.surface);
      expect(look.shadow).toBe('none');
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

// The two breakpoints (1024 and 600) from each side, and the widths the brief names.
const LAYOUTS = [
  { width: 1280, lefts: 4, brand: 'beside' },
  { width: 1024, lefts: 4, brand: 'beside' },
  { width: 1023, lefts: 2, brand: 'above' },
  { width: 768, lefts: 2, brand: 'above' },
  { width: 600, lefts: 2, brand: 'above' },
  { width: 599, lefts: 1, brand: 'above' },
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

  // The Result screen's app header keeps its own unwired actions (Share, Re-run), outside this step.
  const PAGES = [
    { path: SHELL_PAGE, links: 'header a, footer a' },
    { path: '/v2-preview/screens/home', links: 'header a, footer a' },
    { path: '/v2-preview/screens/result', links: 'footer a' },
  ];
  const allowed = new Set([
    '/',
    LOG_IN.href,
    ...MARKETING_NAV.flatMap((e) => (isGroup(e) ? e.items : [e])).flatMap((i) =>
      i.planned ? [] : [i.href],
    ),
    ...FOOTER_COLUMNS.flatMap((c) => c.items).flatMap((i) =>
      'href' in i && i.href ? [i.href] : [],
    ),
  ]);

  for (const p of PAGES) {
    test(`point only at the map’s targets, never "#" or empty: ${p.path} (${p.links})`, async ({
      page,
    }) => {
      await openPreview(page, p.path);
      const hrefs = await page
        .locator(p.links)
        .evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      expect(hrefs.length).toBeGreaterThan(15);
      expect(hrefs.filter((h) => !h || h === '#' || !allowed.has(h))).toEqual([]);
    });
  }
});
