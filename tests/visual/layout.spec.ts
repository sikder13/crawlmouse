import { test, expect, type Page } from './pw';
import { HEIGHT, ORANGES, PREVIEWS, WIDTHS, openPreview } from './pages';

/**
 * Text that does not fit where it is shown, at this width: an element whose own text sticks out of
 * its parent sideways, overflows its own box, ends past the viewport, or is cut off by an ancestor
 * that hides overflow. Text inside a horizontal scroll region is exempt (that region is meant to
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
 * Elements painted in the accent orange, by computed style: fill, stroke, background, border or
 * text. The brand link (mark and wordmark) is not counted (rule 3: the logo is brand).
 */
async function orangeElements(page: Page) {
  return page.evaluate((oranges) => {
    const out: { tag: string; primary: boolean; text: string }[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (el.closest('a[aria-label="Crawlmouse home"], nextjs-portal')) continue;
      const s = getComputedStyle(el);
      const paints = [
        s.backgroundColor,
        s.color,
        s.borderTopColor,
        s.borderRightColor,
        s.borderBottomColor,
        s.borderLeftColor,
        s.fill,
        s.stroke,
      ];
      const own =
        el.childNodes.length === 0 ||
        Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE);
      // A text colour counts only on an element that holds text; borders and fills count anywhere.
      const hit = paints.some((p, i) => oranges.includes(p) && (i !== 1 || own));
      if (hit && s.display !== 'none') {
        out.push({
          tag: el.tagName.toLowerCase(),
          primary: el.hasAttribute('data-v2-primary'),
          text: (el.textContent ?? '').trim().slice(0, 30),
        });
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
