import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from './pw';
import { HEIGHT, PREVIEWS, SCHEMES, WIDTHS, openPreview } from './pages';

const AXE = createRequire(
  fileURLToPath(new URL('../../apps/web/package.json', import.meta.url)),
).resolve('axe-core/axe.min.js');

/**
 * The orange "mouse" of the wordmark is a logotype. WCAG 1.4.3 sets no contrast minimum for
 * logotypes, but axe cannot tell a logotype from text, so that element is left out of the scan.
 * A page shows the wordmark once per brand link (the header's, and the footer's where there is
 * one); a test below checks the selector matches exactly one "mouse" inside each brand link and
 * nothing else.
 */
const WORDMARK_ACCENT = '[data-v2-wordmark] > span';
const BRAND_LINK = 'a[aria-label="Crawlmouse home"]';

async function expectWordmarkExclusionIsTheWordmarkOnly(page: Page) {
  const brands = await page.locator(BRAND_LINK).count();
  expect(brands, 'a page shows the brand link').toBeGreaterThan(0);
  expect(
    await page.locator(WORDMARK_ACCENT).count(),
    'the axe exclusion is the wordmark only',
  ).toBe(brands);
  const perLink = await page
    .locator(BRAND_LINK)
    .evaluateAll((links, sel) => links.map((l) => l.querySelectorAll(sel).length), WORDMARK_ACCENT);
  expect(perLink, 'one accent in each brand link').toEqual(Array<number>(brands).fill(1));
  await expect(page.locator(WORDMARK_ACCENT)).toHaveText(Array<string>(brands).fill('mouse'));
}

interface Finding {
  id: string;
  impact: string | null;
  help: string;
  nodes: string[];
}

/** Findings axe is sure of, and findings it could not decide (`incomplete`). */
async function axe(
  page: Page,
  scope = 'body',
): Promise<{ violations: Finding[]; incomplete: Finding[] }> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(
    async ([exclude, include]) => {
      type Raw = { id: string; impact: string | null; help: string; nodes: { target: string[] }[] };
      const w = window as unknown as {
        axe: {
          run: (ctx: unknown, opts: unknown) => Promise<{ violations: Raw[]; incomplete: Raw[] }>;
        };
      };
      const r = await w.axe.run(
        { include: [[include]], exclude: [[exclude], ['nextjs-portal']] },
        { resultTypes: ['violations', 'incomplete'] },
      );
      const flat = (list: Raw[]) =>
        list.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.map((n) => n.target.join(' ')),
        }));
      return { violations: flat(r.violations), incomplete: flat(r.incomplete) };
    },
    [WORDMARK_ACCENT, scope] as const,
  );
}

const serious = (f: Finding) => f.impact === 'serious' || f.impact === 'critical';

/**
 * axe, twice. First the page as rendered. Then with the decorative link map hidden (axe cannot
 * see the background behind the overlays drawn over it) and every table's scroll region scrolled
 * to its far end (axe cannot judge a column scrolled out of view). A violation at any impact in
 * either pass fails, and so does a serious finding axe could not decide in both passes.
 */
async function axeTwice(page: Page, scope = 'body') {
  const first = await axe(page, scope);
  await page.addStyleTag({ content: 'svg[data-v2-map] { visibility: hidden !important; }' });
  await page.evaluate(() => {
    document.querySelectorAll('[data-v2-scroll-region]').forEach((r) => {
      (r as HTMLElement).scrollLeft = (r as HTMLElement).scrollWidth;
    });
  });
  const second = await axe(page, scope);
  const undecided = (r: { incomplete: Finding[] }) =>
    new Set(r.incomplete.filter(serious).flatMap((f) => f.nodes.map((n) => `${f.id} ${n}`)));
  const later = undecided(second);
  return {
    violations: [...first.violations, ...second.violations],
    undecided: [...undecided(first)].filter((n) => later.has(n)),
  };
}

for (const width of WIDTHS) {
  for (const colorScheme of SCHEMES) {
    test.describe(`axe at ${width}px ${colorScheme}`, () => {
      test.use({ viewport: { width, height: HEIGHT[width] }, colorScheme });

      for (const p of PREVIEWS) {
        test(`${p.name}: no violations at any impact`, async ({ page }) => {
          await openPreview(page, p.path);
          await expectWordmarkExclusionIsTheWordmarkOnly(page);
          const { violations, undecided } = await axeTwice(page);
          expect(violations).toEqual([]);
          expect(undecided).toEqual([]);
        });
      }
    });
  }
}

/**
 * The focused element, and whether its focus ring is visible: an outline at least 2px wide,
 * opaque, at least 3:1 against the colour it is drawn over (WCAG 1.4.11 non-text contrast), and
 * not cut off by an ancestor that hides or scrolls its overflow.
 */
async function focusedStop(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    if (el.tagName.toLowerCase() === 'nextjs-portal')
      return { key: 'nextjs-portal', kind: 'dev', ring: true };
    const cs = getComputedStyle(el);
    const rgba = (c: string) => {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c);
      return m
        ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]
        : null;
    };
    const lum = ([r, g, b]: number[]) => {
      const ch = (v: number) => {
        const x = v / 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(r ?? 0) + 0.7152 * ch(g ?? 0) + 0.0722 * ch(b ?? 0);
    };
    // The colour the ring is drawn over: the element's own background for an inset ring,
    // otherwise the nearest ancestor with an opaque background.
    let host: Element | null = parseFloat(cs.outlineOffset) < 0 ? el : el.parentElement;
    let bg = [255, 255, 255, 1];
    for (; host; host = host.parentElement) {
      const c = rgba(getComputedStyle(host).backgroundColor);
      if (c && (c[3] ?? 0) >= 0.99) {
        bg = c;
        break;
      }
    }
    const ringColour = rgba(cs.outlineColor);
    const [hi, lo] = ringColour ? [lum(ringColour), lum(bg)].sort((a, b) => b - a) : [0, 0];
    const contrast = ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
    // The ring's outer box must not be cut off by an ancestor that hides or scrolls overflow.
    // An inset ring (negative offset) reaches no further than the element itself.
    const reach = Math.max(0, parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth));
    const box = el.getBoundingClientRect();
    const ring = {
      l: box.left - reach,
      r: box.right + reach,
      t: box.top - reach,
      b: box.bottom + reach,
    };
    let clipped = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const ac = getComputedStyle(a);
      const clips =
        ac.overflowX !== 'visible' || ac.overflowY !== 'visible' || ac.clipPath !== 'none';
      if (!clips) continue;
      const ab = a.getBoundingClientRect();
      if (
        ring.l < ab.left - 0.5 ||
        ring.r > ab.right + 0.5 ||
        ring.t < ab.top - 0.5 ||
        ring.b > ab.bottom + 0.5
      ) {
        clipped = true;
        break;
      }
    }
    const outline =
      !clipped &&
      cs.outlineStyle !== 'none' &&
      parseFloat(cs.outlineWidth) >= 2 &&
      ringColour !== null &&
      (ringColour[3] ?? 0) >= 0.99 &&
      contrast >= 3;
    const kind = el.hasAttribute('data-v2-button')
      ? `button:${el.tagName.toLowerCase()}`
      : el.hasAttribute('data-v2-card')
        ? 'card'
        : el.hasAttribute('data-v2-scroll-region')
          ? 'scroll-region'
          : el.tagName.toLowerCase() === 'input'
            ? 'field'
            : el.getAttribute('aria-label') === 'Crawlmouse home'
              ? 'brand'
              : el.tagName.toLowerCase();
    const all = Array.from(document.querySelectorAll('*'));
    return {
      key: `${kind}#${all.indexOf(el)}${clipped ? ' CLIPPED' : ''} ${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} on rgb(${bg.slice(0, 3).join(', ')}) = ${contrast.toFixed(2)}:1`,
      kind,
      ring: outline,
    };
  });
}

/** Tab through the page; return each focused element and whether its focus ring is visible. */
async function tabStops(page: Page, max = 240) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    (document.activeElement as HTMLElement | null)?.blur();
  });
  const stops: { key: string; kind: string; ring: boolean }[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const s = await focusedStop(page);
    if (!s) return stops;
    if (stops.some((x) => x.key.split(' ')[0] === s.key.split(' ')[0])) return stops;
    if (s.kind !== 'dev') stops.push(s);
  }
  // Reaching the cap means the walk stopped before the page ended: say so, never pass on part of it.
  throw new Error(`more than ${max} tab stops; raise the cap rather than check part of the page`);
}

for (const width of WIDTHS) {
  for (const colorScheme of SCHEMES) {
    test.describe(`keyboard focus at ${width}px ${colorScheme}`, () => {
      test.use({ viewport: { width, height: HEIGHT[width] }, colorScheme });

      for (const p of PREVIEWS) {
        test(`${p.name}: each tab stop shows a visible focus ring`, async ({ page }) => {
          await openPreview(page, p.path);
          const stops = await tabStops(page);
          expect(stops.length).toBeGreaterThan(0);
          expect(stops.filter((s) => !s.ring).map((s) => s.key)).toEqual([]);
        });
      }
    });
  }
}

/**
 * The Learn menu open, on the two pages with the marketing header: axe over the header holding the
 * open menu, and the focus ring of each link in it. The tab walk above runs with the menu closed,
 * so it never reaches them. Axe is scoped to the header because the open panel covers the content
 * under it, which axe then cannot judge; that content is checked above with the menu closed.
 */
const MARKETING_PAGES = ['/v2-preview/page-shell', '/v2-preview/screens/home'];

for (const width of WIDTHS) {
  for (const colorScheme of SCHEMES) {
    test.describe(`Learn menu open at ${width}px ${colorScheme}`, () => {
      test.use({ viewport: { width, height: HEIGHT[width] }, colorScheme });

      for (const path of MARKETING_PAGES) {
        test(`${path}: no axe violation at any impact, and a visible ring on each link`, async ({
          page,
        }) => {
          await openPreview(page, path);
          const learn = page.getByRole('button', { name: 'Learn', exact: true });
          await learn.focus();
          await page.keyboard.press('Enter');
          await expect(learn).toHaveAttribute('aria-expanded', 'true');
          const links = await page.locator('[data-v2-nav-menu] ul a').count();
          expect(links).toBeGreaterThan(0);

          const stops = [await focusedStop(page)];
          for (let i = 0; i < links; i++) {
            await page.keyboard.press('Tab');
            stops.push(await focusedStop(page));
          }
          expect(stops.map((s) => s?.kind)).toEqual(['button', ...Array<string>(links).fill('a')]);
          expect(stops.filter((s) => !s?.ring).map((s) => s?.key)).toEqual([]);

          await expect(learn).toHaveAttribute('aria-expanded', 'true');
          const { violations, undecided } = await axeTwice(page, 'header');
          expect(violations).toEqual([]);
          expect(undecided).toEqual([]);
        });
      }
    });
  }
}

test.describe('keyboard focus reaches every interactive primitive', () => {
  test.use({ viewport: { width: 390, height: HEIGHT[390] } });

  test('button, link button, door card, field, overflowing table and brand link', async ({
    page,
  }) => {
    const kinds = new Set<string>();
    for (const path of [
      '/v2-preview/button',
      '/v2-preview/card',
      '/v2-preview/field',
      '/v2-preview/verdict-cell',
      '/v2-preview/page-shell',
    ]) {
      await openPreview(page, path);
      for (const s of await tabStops(page)) {
        kinds.add(s.kind);
        expect(s.ring, `${path} ${s.key}`).toBe(true);
      }
    }
    for (const kind of ['button:button', 'button:a', 'card', 'field', 'scroll-region', 'brand']) {
      expect([...kinds], kind).toContain(kind);
    }
  });
});

/**
 * Reduced motion. Two checks, because motion here comes two ways:
 * - CSS: on every preview, nothing in the page carries a CSS animation under reduced motion.
 * - Script: the crawl screen moves with Web Animations and CSS transitions while it plays. Every
 *   call to Element.animate and every transition that starts is counted while it plays for a few
 *   seconds; under reduced motion the count is zero, and without the preference it is not (the
 *   control that shows the count can fail).
 */
async function motionWhilePlaying(
  browser: import('./pw').Browser,
  reducedMotion: 'reduce' | 'no-preference',
) {
  const context = await browser.newContext({
    reducedMotion,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as { __animate: number; __transitions: number };
    w.__animate = 0;
    w.__transitions = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args: Parameters<typeof animate>) {
      w.__animate++;
      return animate.apply(this, args);
    };
    document.addEventListener('transitionrun', () => w.__transitions++, true);
  });
  // From just before the crawler tests: pages, links, log lines, verdicts and findings all land.
  await page.goto('/v2-preview/screens/crawl?at=66000&play', { waitUntil: 'load' });
  await page.waitForTimeout(8000);
  const counts = await page.evaluate(() => {
    const w = window as unknown as { __animate: number; __transitions: number };
    return { animate: w.__animate, transitions: w.__transitions };
  });
  await context.close();
  return counts;
}

test.describe('reduced motion', () => {
  for (const p of PREVIEWS) {
    test(`${p.name}: nothing in the page carries an animation under reduced motion`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        reducedMotion: 'reduce',
        viewport: { width: 1280, height: 900 },
      });
      const page = await context.newPage();
      await page.goto(p.path, { waitUntil: 'load' });
      const animated = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-v2-shell], [data-v2-shell] *'))
          .filter((e) =>
            [null, '::before', '::after'].some((pseudo) => {
              const c = getComputedStyle(e, pseudo);
              return (
                (pseudo === null || (c.content !== 'none' && c.content !== 'normal')) &&
                c.animationName !== 'none'
              );
            }),
          )
          .map((e) => e.tagName.toLowerCase()),
      );
      await context.close();
      expect(animated).toEqual([]);
    });
  }

  test('the crawl screen, playing, starts no animation and no transition under reduced motion', async ({
    browser,
  }) => {
    expect(await motionWhilePlaying(browser, 'reduce')).toEqual({ animate: 0, transitions: 0 });
  });

  test('without the preference it does move, so the check above can fail', async ({ browser }) => {
    const { animate, transitions } = await motionWhilePlaying(browser, 'no-preference');
    expect(animate).toBeGreaterThan(10);
    expect(transitions).toBeGreaterThan(0);
  });
});

/**
 * The two forms, used from the keyboard: an empty or wrong entry is refused with a message under
 * the field that the field names as its description, the field is marked invalid and keeps focus,
 * and axe finds nothing at any impact with the error showing. A good entry clears the error.
 */
test.describe('the forms say what is wrong, where, and keep focus', () => {
  /** The focused element's id and whether it is marked invalid, and its description's text. */
  const fieldState = (page: Page) =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const described = el.getAttribute('aria-describedby');
      const message = described ? document.getElementById(described) : null;
      return {
        id: el.id,
        invalid: el.getAttribute('aria-invalid'),
        role: message?.getAttribute('role') ?? null,
        text: message?.textContent ?? '',
        // The message sits under the field, within the field's width.
        under: message
          ? (() => {
              const f = el.getBoundingClientRect();
              const m = message.getBoundingClientRect();
              return m.top >= f.bottom - 1 && m.left >= f.left - 1 && m.right <= f.right + 1;
            })()
          : null,
      };
    });

  for (const width of [1280, 390] as const) {
    test.describe(`at ${width}px`, () => {
      test.use({ viewport: { width, height: HEIGHT[width] } });

      test('Home: the address is checked, the error is under the field, axe is clean', async ({
        page,
      }) => {
        await openPreview(page, '/v2-preview/screens/home');
        const field = page.locator('#url');
        await field.focus();
        await page.keyboard.press('Enter');
        let s = await fieldState(page);
        expect(s).toMatchObject({ id: 'url', invalid: 'true', role: 'alert', under: true });
        expect(s.text.length).toBeGreaterThan(0);
        for (const scheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: scheme });
          const { violations } = await axe(page);
          expect(violations, `axe, ${scheme}, with the error showing`).toEqual([]);
        }
        await field.fill('not a website');
        await page.keyboard.press('Enter');
        s = await fieldState(page);
        expect(s).toMatchObject({ id: 'url', invalid: 'true', role: 'alert', under: true });
        await field.fill('example.com');
        await page.keyboard.press('Enter');
        s = await fieldState(page);
        expect(s).toMatchObject({ id: 'url', invalid: null, role: 'status' });
        expect(s.text).toContain('example.com');
      });

      test('Crawl: the email ask refuses an empty address, then confirms and gives focus back', async ({
        page,
      }) => {
        await openPreview(page, '/v2-preview/screens/crawl?at=47000');
        const field = page.locator('#w-email');
        await field.focus();
        await page.keyboard.press('Enter');
        const s = await fieldState(page);
        expect(s).toMatchObject({ id: 'w-email', invalid: 'true', role: 'alert', under: true });
        const { violations } = await axe(page);
        expect(violations, 'axe with the error showing').toEqual([]);
        await field.fill('you@example.com');
        await page.keyboard.press('Enter');
        await expect(page.locator(':focus')).toContainText("We'll email the result");
        await page.keyboard.press('Tab');
        await expect(page.locator(':focus')).toHaveText('Wrong address?');
        await page.keyboard.press('Enter');
        await expect(page.locator(':focus')).toHaveAttribute('id', 'w-email');
      });
    });
  }

  test('Crawl: when the reveal replaces the email ask it holds focus in, focus moves to the reveal', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: HEIGHT[1280] });
    await page.goto('/v2-preview/screens/crawl?at=125000&play', { waitUntil: 'load' });
    await expect(page.locator('[data-v2-replay]')).toHaveAttribute('data-v2-replay', 'playing');
    await page.locator('#w-email').focus();
    await expect(page.getByText('See the full result')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(':focus')).toContainText('Finished in');
  });
});

/*
 * While grades are computed, from 1024px: the step list over the map is clipped out of sight but
 * stays in the accessibility tree, the live region that says "Grading" as it begins; the copy shown
 * under the email ask is inert until the stream ends, so the tree holds the list once. At the end
 * the copy under the ask is the one read.
 */
test.describe('the step list while grades are computed', () => {
  // The step lists in the accessibility tree: not hidden, not inert, not aria-hidden.
  const readLists = (page: Page) =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="list"][aria-live]'))
        .filter((l) => l.querySelector('[aria-current="step"], [role="listitem"]'))
        // The step list, by its first step ("Grading" reads "Graded" once done).
        .filter((l) => (l.textContent ?? '').includes('Read robots.txt'))
        .filter(
          (l) =>
            l.checkVisibility({ visibilityProperty: true }) &&
            !l.closest('[inert], [aria-hidden="true"]'),
        )
        .map((l) => ({
          now: l.querySelector('[aria-current="step"]')?.textContent ?? null,
          over: !!l.closest('[data-v2-replay]'),
        })),
    );

  for (const width of [1024, 1280]) {
    test(`at ${width}px it is read once, from over the map, until the stream ends`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openPreview(page, '/v2-preview/screens/crawl?at=128000');
      expect(await readLists(page)).toEqual([
        { now: expect.stringContaining('Grading'), over: true },
      ]);
      await openPreview(page, '/v2-preview/screens/crawl?at=end');
      expect(await readLists(page)).toEqual([{ now: null, over: false }]);
    });
  }
});

/*
 * Forced colours (Windows High Contrast) draw backgrounds and borders in the system's colours. The
 * legend's keys (a background or a border each) keep their own, so each keeps its shape and is
 * seen; the progress bar's fill is drawn in the text colour; and while grades are computed the
 * emptied step panel draws no frame round nothing.
 */
test.describe('forced colours', () => {
  const marks = (page: Page) =>
    page.evaluate(() => {
      // A CSS module's class, as next dev names it (`File_local__hash`).
      const css = (local: string) => {
        const el = document.querySelector(`[class*="_${local}__"]`);
        return el ? getComputedStyle(el) : null;
      };
      const canvas = getComputedStyle(document.body).backgroundColor;
      const dot = css('keyDot');
      const square = css('keySquare');
      const triangle = css('keyTriangle');
      const fill = css('fill') ?? css('prog');
      const empty = css('statusOffMap');
      return {
        dot: !!dot && dot.backgroundColor !== canvas,
        square: !!square && square.backgroundColor !== canvas,
        triangle:
          !!triangle &&
          triangle.borderLeftColor === 'rgba(0, 0, 0, 0)' &&
          triangle.borderBottomColor !== 'rgba(0, 0, 0, 0)',
        fill: !!fill && fill.backgroundColor !== canvas,
        emptyFrame: empty ? empty.borderTopColor : 'none',
      };
    });

  for (const path of ['/v2-preview/screens/crawl?at=128000', '/v2-preview/screens/home']) {
    test(`${path}: the legend's keys and the bar keep their marks, and no empty frame is drawn`, async ({
      page,
    }) => {
      await page.emulateMedia({ forcedColors: 'active' });
      await page.setViewportSize({ width: 1280, height: 900 });
      await openPreview(page, path);
      const seen = await marks(page);
      expect(seen).toEqual({
        dot: true,
        square: true,
        triangle: true,
        fill: true,
        emptyFrame: path.includes('crawl') ? 'rgba(0, 0, 0, 0)' : 'none',
      });
    });
  }
});
