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

async function axe(page: Page): Promise<Finding[]> {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (exclude) => {
    const w = window as unknown as {
      axe: {
        run: (
          ctx: unknown,
          opts: unknown,
        ) => Promise<{
          violations: {
            id: string;
            impact: string | null;
            help: string;
            nodes: { target: string[] }[];
          }[];
        }>;
      };
    };
    const r = await w.axe.run(
      { include: [['body']], exclude: [[exclude], ['nextjs-portal']] },
      { resultTypes: ['violations'] },
    );
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    }));
  }, WORDMARK_ACCENT);
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
          const serious = (await axe(page)).filter(
            (f) => f.impact === 'serious' || f.impact === 'critical',
          );
          expect(serious).toEqual([]);
        });
      }
    });
  }
}

/** Tab through the page; return each focused element and whether it shows a focus indicator. */
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
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
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
        key: `${kind}#${all.indexOf(el)}`,
        kind,
        ring: outline || cs.boxShadow !== 'none',
      };
    });
    if (!s) break;
    if (stops.some((x) => x.key === s.key)) break;
    if (s.kind !== 'dev') stops.push(s);
  }
  return stops;
}

for (const width of WIDTHS) {
  test.describe(`keyboard focus at ${width}px`, () => {
    test.use({ viewport: { width, height: HEIGHT[width] } });

    for (const p of PREVIEWS) {
      test(`${p.name}: every tab stop shows a focus ring`, async ({ page }) => {
        await openPreview(page, p.path);
        const stops = await tabStops(page);
        expect(stops.length).toBeGreaterThan(0);
        expect(stops.filter((s) => !s.ring).map((s) => s.key)).toEqual([]);
      });
    }
  });
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

test.describe('reduced motion', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  const running = (page: Page) =>
    page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);

  test('the Home stage shows the finished map and grades at once, with nothing moving', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      reducedMotion: 'reduce',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.goto('/v2-preview/screens/home', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    expect(await running(page)).toBe(0);
    const state = await page.evaluate(() => {
      const lines = Array.from(document.querySelectorAll('svg[data-v2-motion] line'));
      const nodes = Array.from(
        document.querySelectorAll(
          'svg[data-v2-motion] circle, svg[data-v2-motion] rect, svg[data-v2-motion] polygon',
        ),
      );
      return {
        lines: lines.length,
        undrawn: lines.filter((l) => parseFloat(getComputedStyle(l).strokeDashoffset) !== 0).length,
        hidden: nodes.filter((n) => getComputedStyle(n).opacity !== '1').length,
      };
    });
    expect(state.lines).toBeGreaterThan(0);
    expect(state.undrawn).toBe(0);
    expect(state.hidden).toBe(0);
    await expect(page.getByText('Technical SEO').first()).toBeVisible();
    await context.close();
  });

  test('without the preference the stage does animate, so the check above can fail', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      reducedMotion: 'no-preference',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.goto('/v2-preview/screens/home', { waitUntil: 'load' });
    expect(await running(page)).toBeGreaterThan(0);
    await context.close();
  });
});
