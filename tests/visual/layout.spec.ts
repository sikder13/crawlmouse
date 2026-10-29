import { test, expect, type Page } from './pw';
import { HEIGHT, LAYOUT_WIDTHS, ORANGES, PREVIEWS, openPreview } from './pages';
import { PANELS } from '../../apps/web/lib/v2/map-layout';

/**
 * Text that does not fit where it is shown, at this width: an element whose own text sticks out of
 * its parent sideways, overflows its own box, ends past the viewport, is cut off by an ancestor
 * that hides overflow, or sits under a clip-path or clip. Text inside a horizontal scroll region is
 * exempt (that region is meant to scroll), as is screen-reader-only text, and text under
 * `clip-path: inset(50%)`, which clips all of it away: out of sight on purpose, not cut short (the
 * crawl screen's step list over the map while grades are computed, kept for a screen reader).
 */
async function textThatDoesNotFit(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}"`;
    const hides = (v: string) => v === 'hidden' || v === 'clip';
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (
        el.closest('svg, [data-v2-scroll-region], [data-v2-sr-only], nextjs-portal, script, style')
      ) {
        continue;
      }
      const ownText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
      );
      if (!ownText) continue;
      let clippedAway = false;
      for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).clipPath === 'inset(50%)') clippedAway = true;
      }
      if (clippedAway) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const parent = el.parentElement;
      if (parent) {
        const p = parent.getBoundingClientRect();
        if (r.left < p.left - 1 || r.right > p.right + 1) {
          out.push(
            `${describe(el)} spans ${Math.round(r.left)}–${Math.round(r.right)}, parent ${Math.round(p.left)}–${Math.round(p.right)}`,
          );
        }
      }
      if (style.display !== 'inline') {
        if (
          el.scrollWidth > el.clientWidth + 1 &&
          style.overflowX !== 'auto' &&
          style.overflowX !== 'scroll'
        ) {
          out.push(`${describe(el)} is wider than its box: ${el.scrollWidth} > ${el.clientWidth}`);
        }
        if (hides(style.overflowY) && el.scrollHeight > el.clientHeight + 1) {
          out.push(
            `${describe(el)} is cut off at the bottom: ${el.scrollHeight} > ${el.clientHeight}`,
          );
        }
      }
      if (r.right > window.innerWidth + 1)
        out.push(`${describe(el)} ends past the viewport at ${Math.round(r.right)}`);
      for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
        const c = getComputedStyle(a);
        if (c.clipPath !== 'none' || (c.clip !== 'auto' && c.clip !== '')) {
          out.push(`${describe(el)} is clipped by clip-path or clip on ${a.tagName.toLowerCase()}`);
          break;
        }
      }
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        const b = a.getBoundingClientRect();
        if (hides(s.overflowX) && (r.left < b.left - 1 || r.right > b.right + 1)) {
          out.push(`${describe(el)} is cut off sideways by an ancestor that hides overflow`);
          break;
        }
        if (hides(s.overflowY) && (r.top < b.top - 1 || r.bottom > b.bottom + 1)) {
          out.push(`${describe(el)} is cut off vertically by an ancestor that hides overflow`);
          break;
        }
      }
    }
    return out;
  });
}

/**
 * Elements painted in the accent orange, at any opacity, through any computed property that
 * paints: background colour and image (gradients), text and its decoration, borders, outline,
 * box and text shadows, SVG fill and stroke — on each element and on its ::before and ::after when
 * they render. A border, outline or decoration whose style or width leaves it unpainted is not
 * counted. The brand link (mark and wordmark) is not counted (rule 3:
 * the logo is brand).
 */
async function orangeElements(page: Page) {
  return page.evaluate((oranges) => {
    const triples = oranges.map((o) => o.replace(/^rgb\(|\)$/g, '').replace(/\s+/g, ''));
    const isOrange = (v: string) =>
      [...v.matchAll(/rgba?\(([^)]*)\)/g)].some((m) => {
        const parts = (m[1] ?? '').split(',').map((x) => x.trim());
        const alpha = parts[3] === undefined ? 1 : Number(parts[3]);
        return alpha > 0 && triples.includes(parts.slice(0, 3).join(','));
      });
    const out: { tag: string; primary: boolean; props: string[] }[] = [];
    const rendered = (c: string) => c !== 'none' && c !== 'normal';
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (el.closest('a[aria-label="Crawlmouse home"], nextjs-portal')) continue;
      // The element, and its ::before and ::after when they render (their content is set).
      for (const pseudo of [null, '::before', '::after'] as const) {
        const s = getComputedStyle(el, pseudo);
        if (pseudo && !rendered(s.content)) continue;
        if (s.display === 'none' || s.visibility === 'hidden') continue;
        const holdsText = pseudo
          ? /^["'].+["']$/.test(s.content)
          : Array.from(el.childNodes).some(
              (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
            );
        const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
        const painted: [string, string, boolean][] = [
          ['background-color', s.backgroundColor, true],
          ['background-image', s.backgroundImage, true],
          ['color', s.color, holdsText],
          [
            'text-decoration-color',
            s.textDecorationColor,
            holdsText && s.textDecorationLine !== 'none',
          ],
          ['text-shadow', s.textShadow, holdsText],
          ['box-shadow', s.boxShadow, true],
          [
            'outline-color',
            s.outlineColor,
            s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0,
          ],
          ['fill', s.fill, !pseudo && el instanceof SVGElement],
          ['stroke', s.stroke, !pseudo && el instanceof SVGElement],
          ...sides.map(
            (side) =>
              [
                `border-${side.toLowerCase()}-color`,
                s[`border${side}Color`],
                s[`border${side}Style`] !== 'none' && parseFloat(s[`border${side}Width`]) > 0,
              ] as [string, string, boolean],
          ),
        ];
        const props = painted.filter(([, v, on]) => on && isOrange(v)).map(([p]) => p);
        if (props.length) {
          out.push({
            tag: `${el.tagName.toLowerCase()}${pseudo ?? ''}`,
            primary: !pseudo && el.hasAttribute('data-v2-primary'),
            props,
          });
        }
      }
    }
    return out;
  }, ORANGES);
}

/**
 * Panels drawn over a stage (`data-v2-overlay`: the status, legend, fetch log and verdict panels on
 * Crawl, the cards on Home's stage) whose boxes intersect: one would hide the other's text.
 */
async function overlappingPanels(page: Page) {
  return page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll('[data-v2-overlay]'))
      .filter((el) => getComputedStyle(el).display !== 'none')
      .map((el) => ({
        name: (el.textContent ?? '').trim().slice(0, 30),
        r: el.getBoundingClientRect(),
      }));
    const out: string[] = [];
    panels.forEach((a, i) =>
      panels.slice(i + 1).forEach((b) => {
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 0 && h > 0) {
          out.push(`"${a.name}" and "${b.name}" overlap by ${Math.round(w)}×${Math.round(h)} px`);
        }
      }),
    );
    return out;
  });
}

/**
 * Orphan and JavaScript-only pages on a stage map that something else is drawn over: at the
 * centre of each square or triangle the topmost element is not it, or a visible panel drawn over
 * the map (`data-v2-overlay`) overlaps its box, clipping its edge. A panel's box takes in a card
 * drawn round it (`data-v2-card`: the step panel's head while grades are computed). Those two
 * kinds of page are what the map exists to show, and its legend names them. The stage maps are the
 * labelled ones (Home, Crawl); the Result's thumbnail is decorative, inside a card whose link takes
 * the pointer over all of it.
 */
async function coveredKeyPages(page: Page) {
  return page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll('[data-v2-overlay]'))
      .filter((p) => {
        const s = getComputedStyle(p);
        return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0;
      })
      .map((p) => {
        // Together with a card drawn round it (`data-v2-card`), where one is shown.
        const r = p.getBoundingClientRect();
        const card = p.querySelector('[data-v2-card]');
        const c = card && getComputedStyle(card).display !== 'none' ? card : null;
        if (!c) return r;
        const k = c.getBoundingClientRect();
        const left = Math.min(r.left, k.left);
        const top = Math.min(r.top, k.top);
        return new DOMRect(
          left,
          top,
          Math.max(r.right, k.right) - left,
          Math.max(r.bottom, k.bottom) - top,
        );
      })
      .filter((q) => q.width > 0 && q.height > 0);
    return Array.from(
      document.querySelectorAll(
        'svg[data-v2-map][role="img"] :is([data-v2-kind="orphan"], [data-v2-kind="js_only"])',
      ),
    )
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0) return false;
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (top !== el) return true;
        return panels.some(
          (q) => r.right > q.left && r.left < q.right && r.bottom > q.top && r.top < q.bottom,
        );
      })
      .map((el) => el.getAttribute('data-v2-node'));
  });
}

/** Elements with their own text rendered heavier than 600 (rule 5). */
async function heavierThan600(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-v2-shell] *'))
      .filter(
        (el) =>
          Array.from(el.childNodes).some(
            (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim(),
          ) && Number(getComputedStyle(el).fontWeight) > 600,
      )
      .map(
        (el) =>
          `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}" ${getComputedStyle(el).fontWeight}`,
      ),
  );
}

/**
 * The fetch log at moments its lines name their own requesters (the crawler tests mix requests as
 * each crawler with the untagged control and the render): no line runs past the panel's edge, so
 * none needs the sideways scroll the log keeps for one that would.
 */
test.describe('the fetch log holds its lines at 1280px', () => {
  test.use({ viewport: { width: 1280, height: HEIGHT[1280] } });
  for (const path of [
    '/v2-preview/screens/crawl?at=71500',
    '/v2-preview/screens/crawl?at=115000',
    '/v2-preview/screens/crawl/challenged?at=125000',
  ]) {
    test(path, async ({ page }) => {
      await openPreview(page, path);
      const log = page.locator('[data-v2-overlay]', { hasText: 'Recent fetches' });
      const region = log.locator('[data-v2-scroll-region]');
      // A plain heading: the lines shown do not share a requester, so each names its own.
      await expect(log.locator('div').first()).toHaveText('Recent fetches');
      const { scrollWidth, clientWidth, text } = await region.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        text: el.textContent ?? '',
      }));
      expect(scrollWidth, text).toBeLessThanOrEqual(clientWidth);
    });
  }
});

for (const width of LAYOUT_WIDTHS) {
  test.describe(`layout at ${width}px`, () => {
    test.use({ viewport: { width, height: HEIGHT[width] } });

    for (const p of PREVIEWS) {
      test(`${p.name}: no horizontal scroll, and text fits where it is shown`, async ({ page }) => {
        await openPreview(page, p.path);
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(scrollWidth, 'page is wider than the viewport').toBeLessThanOrEqual(innerWidth);
        expect(await textThatDoesNotFit(page)).toEqual([]);
      });

      test(`${p.name}: no panel over the stage covers another, or a key page on the map`, async ({
        page,
      }) => {
        await openPreview(page, p.path);
        expect(await overlappingPanels(page)).toEqual([]);
        // Where any panel is drawn over a map (Home's from 761px); on a phone they are under it.
        // 960, 1024 and 1200 have their own pass below.
        const map = page.locator('svg[data-v2-map][role="img"]');
        if (width > 760 && (await map.count())) {
          await map.first().scrollIntoViewIfNeeded();
          expect(await coveredKeyPages(page)).toEqual([]);
        }
      });

      test(`${p.name}: orange paint on ${p.orange === null ? 'at most one element' : p.orange === 1 ? 'exactly one element, the primary action' : 'no element: nothing for the reader to do yet'} (rule 3)`, async ({
        page,
      }) => {
        await openPreview(page, p.path);
        const orange = await orangeElements(page);
        if (p.orange === 1) {
          expect(orange).toHaveLength(1);
          expect(orange[0]?.primary).toBe(true);
        } else if (p.orange === 0) {
          expect(orange).toEqual([]);
        } else {
          expect(orange.length).toBeLessThanOrEqual(1);
        }
      });

      test(`${p.name}: no text heavier than 600 (rule 5)`, async ({ page }) => {
        await openPreview(page, p.path);
        expect(await heavierThan600(page)).toEqual([]);
      });
    }
  });
}

/*
 * The widths where the panels drawn over the map cover the most of it: 1024px for the step panel,
 * the legend and the fetch log, 1200px once the crawler verdicts and Home's grade cards join them
 * (map-layout.ts PANELS); and 960px, where the crawl screen's panels are under the map and Home's
 * progress card and legend are over it. Every preview at its own moment, and the crawl screen
 * while it runs, after its JavaScript-only pages and orphans are classified, when they light up.
 */
/*
 * While grades are computed (2:06-2:11 on the bad site), from 1024px: the step panel's head stays
 * over the map, seen and on top, with a card drawn round it; the card keeps inside the room the
 * finished map's layout keeps clear for it (PANELS.finished, which is what the layout is asked to
 * avoid at that moment); and under the email ask the step list, the verdicts and the log are shown.
 */
const HEAD_ROOM = PANELS.finished.find((p) => p.name.includes("the step panel's head"))!;
test.describe('while grades are computed', () => {
  for (const width of [1024, 1100, 1200, 1280]) {
    test(`at ${width}px the step panel's head stays over the map, in the room kept for it`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openPreview(page, '/v2-preview/screens/crawl?at=128000');
      const seen = await page.evaluate(() => {
        const head = Array.from(document.querySelectorAll('[data-v2-overlay]')).find((e) =>
          (e.textContent ?? '').startsWith('Grading'),
        );
        if (!head) return null;
        const card = head.querySelector('[data-v2-card]');
        if (!card) return null;
        const box = card.getBoundingClientRect();
        const svg = document.querySelector('svg[data-v2-map][role="img"]') as SVGSVGElement;
        const toMap = svg.getScreenCTM()!.inverse();
        const a = new DOMPoint(box.left, box.top).matrixTransform(toMap);
        const b = new DOMPoint(box.right, box.bottom).matrixTransform(toMap);
        const heading = head.firstElementChild!.getBoundingClientRect();
        const hit = document.elementFromPoint(
          heading.left + heading.width / 2,
          heading.top + heading.height / 2,
        );
        const shown = (el: Element | null | undefined) =>
          !!el && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
        const after = document.querySelector('[data-v2-verdicts="after"]')?.parentElement;
        const underAsk = ['Found so far', 'What each AI crawler gets', 'Recent fetches'].filter(
          (text) =>
            !Array.from(after?.children ?? []).some(
              (c) => (c.textContent ?? '').includes(text) && shown(c),
            ),
        );
        return {
          shown: shown(head) && shown(card),
          onTop: !!hit && head.contains(hit),
          map: { left: a.x, top: a.y, right: b.x, bottom: b.y },
          missingUnderAsk: underAsk,
        };
      });
      expect(seen, 'the head is over the map').not.toBeNull();
      expect(seen!.shown, 'the head and its card are shown').toBe(true);
      expect(seen!.onTop, 'nothing is drawn over the head').toBe(true);
      const room = JSON.stringify({ card: seen!.map, room: HEAD_ROOM });
      expect(seen!.map.right, room).toBeLessThanOrEqual(HEAD_ROOM.right + 0.5);
      expect(seen!.map.bottom, room).toBeLessThanOrEqual(HEAD_ROOM.bottom + 0.5);
      expect(Math.max(0, seen!.map.left), room).toBeGreaterThanOrEqual(HEAD_ROOM.left);
      expect(Math.max(0, seen!.map.top), room).toBeGreaterThanOrEqual(HEAD_ROOM.top);
      expect(seen!.missingUnderAsk, 'shown under the email ask').toEqual([]);
    });
  }
});

const RUNNING = [
  { name: 'crawl at 1:55', path: '/v2-preview/screens/crawl?at=115000' },
  { name: 'crawl at 2:05', path: '/v2-preview/screens/crawl?at=125000' },
  { name: 'crawl at 2:08, grading', path: '/v2-preview/screens/crawl?at=128000' },
  { name: 'challenged crawl at 3:10', path: '/v2-preview/screens/crawl/challenged?at=190000' },
];
for (const width of [960, 1024, 1200, 1280]) {
  test.describe(`the map at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const p of [...PREVIEWS, ...RUNNING]) {
      test(`${p.name}: no panel covers a key page on the map`, async ({ page }) => {
        await openPreview(page, p.path);
        const map = page.locator('svg[data-v2-map][role="img"]');
        test.skip((await map.count()) === 0, 'no stage map');
        await map.first().scrollIntoViewIfNeeded();
        expect(await coveredKeyPages(page)).toEqual([]);
      });
    }
  });
}
