import { test, expect, type Page } from './pw';
import { openPreview } from './pages';

/**
 * F-110: with its fields on a signed-in page, the site's settings card holds them at every width.
 * The widths include those where the card sits beside the alerts card and is at its narrowest, and
 * those around the width where its rows stack. A host is one long word, so each width is also
 * measured with a long one in the staging row, as a field and as its value.
 */
const LIVE = '/v2-preview/screens/site?live=1';
// No hyphen: a browser may already break a line at one, so a hyphenated host proves nothing here.
const LONG_HOST = 'staging.northwindoutfitterscompanyandsons.myshopify.com';
const WIDTHS = [390, 700, 760, 761, 900, 1000, 1280, 1301, 1366, 1440, 1536, 1600, 1602, 1920];

async function measure(page: Page, host: string | null) {
  const table = page.getByRole('table', { name: 'Site settings' });
  await expect(table.locator('input[type="text"]').first()).toBeVisible();
  return table.evaluate((t, long) => {
    if (long) {
      const row = [...t.querySelectorAll('tbody tr')].find((r) =>
        r.textContent?.startsWith('Staging'),
      )!;
      row.children[1]!.textContent = long;
      row.querySelector<HTMLInputElement>('input[type="text"]')!.value = long;
    }
    const region = t.parentElement!;
    // The card, not the scroll region: a table wider than a clipping card must fail too.
    const edge = t.closest('section')!.getBoundingClientRect().right;
    const controls = t.querySelectorAll('input:not([type="hidden"]), select, button');
    return {
      inside: region.scrollWidth,
      outside: region.clientWidth,
      past: [...controls].filter((c) => c.getBoundingClientRect().right > edge + 0.5).length,
    };
  }, host);
}

for (const width of WIDTHS) {
  for (const [name, host] of [
    ['its own values', null],
    ['a long host', LONG_HOST],
  ] as const) {
    test(`the site settings card holds its fields at ${width}, with ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openPreview(page, LIVE);
      const { inside, outside, past } = await measure(page, host);
      expect(inside, `table ${inside}px in a card of ${outside}px`).toBeLessThanOrEqual(outside);
      expect(past, 'controls past the card edge').toBe(0);
    });
  }
}

test('in a narrow card a text field has its own line and the room on it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPreview(page, LIVE);
  const table = page.getByRole('table', { name: 'Site settings' });
  const { field, card, below } = await table.evaluate((t) => {
    const input = t.querySelector<HTMLInputElement>('input[type="text"]')!;
    const row = input.closest('tr')!;
    return {
      field: input.getBoundingClientRect().width,
      card: t.getBoundingClientRect().width,
      below:
        input.closest('td')!.getBoundingClientRect().top >=
        row.children[1]!.getBoundingClientRect().bottom - 1,
    };
  });
  expect(below, 'the field sits under the row’s value').toBe(true);
  expect(field, 'the field uses the line').toBeGreaterThan(card * 0.6);
});

test('at 390 the public link’s address has the line, not a sliver beside its buttons', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openPreview(page, LIVE);
  const table = page.getByRole('table', { name: 'Site settings' });
  const { address, card } = await table.evaluate((t) => {
    const row = [...t.querySelectorAll('tbody tr')].find((r) =>
      r.textContent?.startsWith('Public link'),
    )!;
    return {
      address: row.children[1]!.getBoundingClientRect().width,
      card: t.getBoundingClientRect().width,
    };
  });
  expect(address, 'the address cell uses the line').toBeGreaterThan(card * 0.6);
});
