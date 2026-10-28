import { test, expect, type Page } from './pw';
import { HEIGHT, ORANGES, PREVIEWS, WIDTHS, openPreview } from './pages';

/**
 * Text that does not fit where it is shown, at this width: an element whose own text sticks out of
 * its parent sideways, overflows its own box, ends past the viewport, is cut off by an ancestor
 * that hides overflow, or sits under a clip-path or clip. Text inside a horizontal scroll region is exempt (that region is meant to
 * scroll), as is screen-reader-only text.
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

for (const width of WIDTHS) {
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

      test(`${p.name}: orange paint on ${p.kind === 'screen' ? 'exactly one element, the primary action' : 'at most one element'} (rule 3)`, async ({
        page,
      }) => {
        await openPreview(page, p.path);
        const orange = await orangeElements(page);
        if (p.kind === 'screen') {
          expect(orange).toHaveLength(1);
          expect(orange[0]?.primary).toBe(true);
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
