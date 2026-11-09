import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ConsoleMessage } from '@playwright/test';

// Every `keep` page in the v1 inventory, loaded on a production build (tests/e2e/v1-keep.config.ts).
// The page list and the expected values come from the inventory's `e2e` block on each entry, so a new
// keep page is covered without editing this file: a keep page with no `e2e` block fails here until it
// gets one, or a block saying `"skip": "<reason>"`.
//
// Per page: the response status, no console error, and the <title>, the canonical link's href and the
// robots meta's content (null when the element is absent). `finalPath`, when given, is the path the
// page settles on after redirects (a signed-out visit to an owner-only page lands on /login).

interface E2eBlock {
  url: string;
  status: number;
  title: string;
  canonical: string | null;
  robots: string | null;
  finalPath?: string;
  skip?: string;
}

interface InventoryItem {
  kind: string;
  path: string;
  url?: string;
  ruling: string;
  e2e?: E2eBlock | { skip: string };
}

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const inventoryPath = (() => {
  const p = process.env.V1_INVENTORY ?? 'docs/ops/v1-inventory.json';
  return isAbsolute(p) ? p : resolve(repoRoot, p);
})();
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as { items: InventoryItem[] };
const keepPages = inventory.items.filter((i) => i.kind === 'page' && i.ruling === 'keep');

test('the inventory lists keep pages', () => {
  expect(keepPages.length).toBeGreaterThan(0);
});

for (const item of keepPages) {
  test(`${item.path} (${item.url ?? '?'})`, async ({ page, baseURL }) => {
    const e2e = item.e2e;
    expect(e2e, `${item.path} is a keep page with no e2e block in ${inventoryPath}`).toBeDefined();
    if (e2e && 'skip' in e2e && e2e.skip) {
      test.skip(true, e2e.skip);
      return;
    }
    const block = e2e as E2eBlock;

    const errors: ConsoleMessage[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m);
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    const pageUrl = new URL(block.url, baseURL).toString();
    const response = await page.goto(block.url, { waitUntil: 'load' });
    expect(response, `no response for ${block.url}`).not.toBeNull();
    expect(response!.status()).toBe(block.status);
    // Where the page ended up: its own path unless the block names a designed redirect, so a page
    // that starts bouncing to /login fails here and not only on its title.
    expect(new URL(page.url()).pathname).toBe(
      block.finalPath ?? new URL(block.url, baseURL).pathname,
    );

    await page.waitForLoadState('networkidle');
    await expect(page).toHaveTitle(block.title);
    const canonical = page.locator('link[rel="canonical"]');
    expect((await canonical.count()) ? await canonical.first().getAttribute('href') : null).toBe(
      block.canonical,
    );
    const robots = page.locator('meta[name="robots"]');
    expect((await robots.count()) ? await robots.first().getAttribute('content') : null).toBe(
      block.robots,
    );

    // A page whose designed status is an error makes Chromium log one "Failed to load resource" for
    // the document itself. That line, for this page's own URL, is the status already asserted above;
    // any other console error fails.
    const unexpected = errors
      .filter(
        (m) =>
          !(
            block.status >= 400 &&
            m.location().url === pageUrl &&
            m.text().startsWith('Failed to load resource') &&
            m.text().includes(String(block.status))
          ),
      )
      .map((m) => `${m.text()} @ ${m.location().url}`);
    expect([...unexpected, ...pageErrors]).toEqual([]);
  });
}
