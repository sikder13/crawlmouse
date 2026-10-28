import { test, expect } from './pw';
import { HEIGHT, PREVIEWS, WIDTHS, openPreview } from './pages';

/**
 * Elements whose own text sticks out of their parent sideways, or overflows their own box, at
 * this width. Text inside a horizontal scroll region is exempt (that region is meant to scroll),
 * as is screen-reader-only text.
 */
async function textOutsideContainer(page: import('./pw').Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${(el.textContent ?? '').trim().slice(0, 40)}"`;
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
      if (
        style.display !== 'inline' &&
        el.scrollWidth > el.clientWidth + 1 &&
        style.overflowX === 'visible'
      ) {
        out.push(`${describe(el)} overflows its own box: ${el.scrollWidth} > ${el.clientWidth}`);
      }
      if (r.right > window.innerWidth + 1)
        out.push(`${describe(el)} ends past the viewport at ${Math.round(r.right)}`);
    }
    return out;
  });
}

for (const width of WIDTHS) {
  test.describe(`layout at ${width}px`, () => {
    test.use({ viewport: { width, height: HEIGHT[width] } });

    for (const p of PREVIEWS) {
      test(`${p.name}: no horizontal scroll, every text block inside its container`, async ({
        page,
      }) => {
        await openPreview(page, p.path);
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(scrollWidth, 'page is wider than the viewport').toBeLessThanOrEqual(innerWidth);
        expect(await textOutsideContainer(page)).toEqual([]);
      });

      test(`${p.name}: orange on ${p.kind === 'screen' ? 'exactly one element' : 'at most one element'} (rule 3)`, async ({
        page,
      }) => {
        await openPreview(page, p.path);
        const primaries = await page.locator('[data-v2-primary]').count();
        if (p.kind === 'screen') expect(primaries).toBe(1);
        else expect(primaries).toBeLessThanOrEqual(1);
      });
    }
  });
}
