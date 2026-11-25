import { test, expect, type Page } from './pw';
import { openPreview } from './pages';

/**
 * F-237: the Agency client page's two tables fit their cards at 1280 and 390. A fix title carries a
 * crawled URL with no space in it and a seat its email address, which pushed the effect column and
 * the Change buttons past the card's edge, where the card cut them off. Each table's scroll region
 * must be no wider inside than out, with the fixture's strings and with long unbroken ones added.
 */
const CLIENT = '/v2-preview/screens/agency/client';

const UNBROKEN: Record<string, string> = {
  'as the fixture holds them': '',
  'a long crawled URL': `https://client-3.lab.crawlmouse.com/${'patients/children/retainers/'.repeat(3)}`,
  'a percent-encoded URL': `https://example.com/${'%E3%81%82'.repeat(14)}`,
  'a long email address': `qa+j4-${'m'.repeat(24)}@lab.crawlmouse.com`,
};

async function overflow(page: Page, text: string) {
  return page.locator('main table').evaluateAll((tables, extra) => {
    // The strings that come from outside: the fix titles (the fixes table's row headers) and the
    // client table's values (its second column). Its row labels are ours and short.
    if (extra) {
      const cells = (label: string, selector: string) =>
        tables
          .filter((t) => t.getAttribute('aria-label') === label)
          .flatMap((t) => Array.from(t.querySelectorAll(selector)));
      for (const cell of [
        ...cells('Open fixes', 'tbody th'),
        ...cells('Client settings', 'tbody td:nth-child(2)'),
      ])
        (cell.firstElementChild ?? cell).append(` ${extra}`);
    }
    return tables.map((t) => {
      const region = t.parentElement!;
      const edge = region.getBoundingClientRect();
      // Every control in the table (the packet and Change links) lies inside the region's edges,
      // so none is cut off by the card.
      const cutControls = Array.from(t.querySelectorAll('a, button'))
        .map((c) => ({ text: c.textContent ?? '', box: c.getBoundingClientRect() }))
        .filter(({ box }) => box.left < edge.left - 0.5 || box.right > edge.right + 0.5)
        .map(({ text, box }) => `${text.trim()} at ${box.left}-${box.right}`);
      return {
        inside: region.scrollWidth,
        outside: region.clientWidth,
        controls: t.querySelectorAll('a, button').length,
        cut: cutControls,
        edge: `${edge.left}-${edge.right}`,
      };
    });
  }, text);
}

for (const width of [1280, 390]) {
  for (const [name, text] of Object.entries(UNBROKEN)) {
    test(`the client page's tables fit at ${width}, with ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openPreview(page, CLIENT);
      const regions = await overflow(page, text);
      expect(regions.length, 'the fixes and the This client tables').toBeGreaterThanOrEqual(2);
      for (const { inside, outside, cut, edge } of regions) {
        expect(inside, `table ${inside}px in a region of ${outside}px`).toBeLessThanOrEqual(
          outside,
        );
        expect(cut, `controls outside the region ${edge}`).toEqual([]);
      }
      expect(
        regions.reduce((n, r) => n + r.controls, 0),
        'the tables hold the packet and Change controls',
      ).toBeGreaterThan(0);
    });
  }
}
