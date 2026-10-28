import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from './pw';
import { HEIGHT, PREVIEWS, SCHEMES, WIDTHS, openPreview } from './pages';

const AXE = createRequire(
  fileURLToPath(new URL('../../apps/web/package.json', import.meta.url)),
).resolve('axe-core/axe.min.js');

/**
 * The orange "mouse" of the wordmark is a logotype. WCAG 1.4.3 sets no contrast minimum for
 * logotypes, but axe cannot tell a logotype from text, so this one element is left out of the
 * scan. A test below checks the selector matches exactly that element and nothing else.
 */
const WORDMARK_ACCENT = '[data-v2-wordmark] > span';

interface Finding {
  id: string;
  impact: string | null;
  help: string;
  nodes: string[];
}

/** Findings axe is sure of, and findings it could not decide (`incomplete`). */
async function axe(page: Page): Promise<{ violations: Finding[]; incomplete: Finding[] }> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (exclude) => {
    type Raw = { id: string; impact: string | null; help: string; nodes: { target: string[] }[] };
    const w = window as unknown as {
      axe: {
        run: (ctx: unknown, opts: unknown) => Promise<{ violations: Raw[]; incomplete: Raw[] }>;
      };
    };
    const r = await w.axe.run(
      { include: [['body']], exclude: [[exclude], ['nextjs-portal']] },
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
  }, WORDMARK_ACCENT);
}

const serious = (f: Finding) => f.impact === 'serious' || f.impact === 'critical';

/**
 * axe, twice. First the page as rendered. Then with the decorative link map hidden (axe cannot
 * see the background behind the overlays drawn over it) and every table's scroll region scrolled
 * to its far end (axe cannot judge a column scrolled out of view). A serious finding in either
 * pass fails, and so does a serious finding axe could not decide in both passes.
 */
async function axeTwice(page: Page) {
  const first = await axe(page);
  await page.addStyleTag({ content: 'svg[data-v2-motion] { visibility: hidden !important; }' });
  await page.evaluate(() => {
    document.querySelectorAll('[data-v2-scroll-region]').forEach((r) => {
      (r as HTMLElement).scrollLeft = (r as HTMLElement).scrollWidth;
    });
  });
  const second = await axe(page);
  const undecided = (r: { incomplete: Finding[] }) =>
    new Set(r.incomplete.filter(serious).flatMap((f) => f.nodes.map((n) => `${f.id} ${n}`)));
  const later = undecided(second);
  return {
    violations: [...first.violations, ...second.violations].filter(serious),
    undecided: [...undecided(first)].filter((n) => later.has(n)),
  };
}

for (const width of WIDTHS) {
  for (const colorScheme of SCHEMES) {
    test.describe(`axe at ${width}px ${colorScheme}`, () => {
      test.use({ viewport: { width, height: HEIGHT[width] }, colorScheme });

      for (const p of PREVIEWS) {
        test(`${p.name}: no serious or critical violations`, async ({ page }) => {
          await openPreview(page, p.path);
          expect(
            await page.locator(WORDMARK_ACCENT).count(),
            'the axe exclusion is the wordmark only',
          ).toBe(1);
          await expect(page.locator(WORDMARK_ACCENT)).toHaveText('mouse');
          const { violations, undecided } = await axeTwice(page);
          expect(violations).toEqual([]);
          expect(undecided).toEqual([]);
        });
      }
    });
  }
}

/**
 * Tab through the page; return each focused element and whether its focus ring is visible: an
 * outline at least 2px wide, opaque, at least 3:1 against the colour it is drawn over (WCAG
 * 1.4.11 non-text contrast), and not cut off by an ancestor that hides or scrolls its overflow.
 */
async function tabStops(page: Page, max = 120) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    (document.activeElement as HTMLElement | null)?.blur();
  });
  const stops: { key: string; kind: string; ring: boolean }[] = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const s = await page.evaluate(() => {
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
    if (!s) break;
    if (stops.some((x) => x.key.split(' ')[0] === s.key.split(' ')[0])) break;
    if (s.kind !== 'dev') stops.push(s);
  }
  return stops;
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
 * Reduced motion, checked on the computed animation-name of each element that animates on the
 * Home stage (edges, nodes, progress bar, grade cards). The name stays set after an animation
 * finishes, so this does not depend on when the check runs relative to the animation.
 */
const ANIMATED_ON_STAGE =
  'svg[data-v2-motion] line, svg[data-v2-motion] circle, svg[data-v2-motion] rect, svg[data-v2-motion] polygon, [class*="HomeScreen_prog__"], [class*="HomeScreen_late__"]';

async function stageAnimationNames(
  browser: import('./pw').Browser,
  reducedMotion: 'reduce' | 'no-preference',
) {
  const context = await browser.newContext({
    reducedMotion,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto('/v2-preview/screens/home', { waitUntil: 'load' });
  const names = await page.evaluate(
    (sel) =>
      Array.from(document.querySelectorAll(sel)).map((e) => getComputedStyle(e).animationName),
    ANIMATED_ON_STAGE,
  );
  const animatedAnywhere = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-v2-shell], [data-v2-shell] *'))
      .filter((e) => getComputedStyle(e).animationName !== 'none')
      .map(
        (e) => `${e.tagName.toLowerCase()}.${String(e.getAttribute('class') ?? '').slice(0, 40)}`,
      ),
  );
  const shown = await page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('svg[data-v2-motion] line'));
    const nodes = Array.from(
      document.querySelectorAll(
        'svg[data-v2-motion] circle, svg[data-v2-motion] rect, svg[data-v2-motion] polygon',
      ),
    );
    const late = document.querySelector('[class*="HomeScreen_late__"]');
    return {
      undrawn: lines.filter((l) => parseFloat(getComputedStyle(l).strokeDashoffset) !== 0).length,
      hidden: nodes.filter((n) => getComputedStyle(n).opacity !== '1').length,
      cards: late ? getComputedStyle(late).opacity : null,
    };
  });
  await context.close();
  return { names, shown, animatedAnywhere };
}

test.describe('reduced motion', () => {
  test('the Home stage has no animation at all, and shows the finished map and grades', async ({
    browser,
  }) => {
    const { names, shown, animatedAnywhere } = await stageAnimationNames(browser, 'reduce');
    expect(names.length).toBeGreaterThan(150);
    expect([...new Set(names)]).toEqual(['none']);
    // Not only the elements known to animate: nothing in the page shell carries an animation.
    expect(animatedAnywhere).toEqual([]);
    expect(shown).toEqual({ undrawn: 0, hidden: 0, cards: '1' });
  });

  for (const p of PREVIEWS.filter((x) => x.path !== '/v2-preview/screens/home')) {
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
          .filter((e) => getComputedStyle(e).animationName !== 'none')
          .map((e) => e.tagName.toLowerCase()),
      );
      await context.close();
      expect(animated).toEqual([]);
    });
  }

  test('without the preference each of those elements animates, so the check above can fail', async ({
    browser,
  }) => {
    const { names } = await stageAnimationNames(browser, 'no-preference');
    expect(names.length).toBeGreaterThan(150);
    expect(names.filter((n) => n === 'none')).toEqual([]);
  });
});
