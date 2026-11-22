import { expect, type Page } from '../pw';

/**
 * A finished v2 page: it answers `status`, inside the v2 shell, with no "planned" placeholder in its own
 * content. The shared header and footer carry planned entries on every page today (F-005); those are
 * J0.2's, so they are not counted here, or every page would fail for one footer. A kept v1 body inside
 * the v2 shell is not finished either.
 */
export async function expectFinishedV2Page(page: Page, path: string, status = 200): Promise<void> {
  const res = await page.goto(path);
  expect(res?.status(), `${path} status`).toBe(status);
  await expect(page.locator('[data-v2-shell]'), `${path} is inside the v2 shell`).not.toHaveCount(
    0,
  );
  await expect(
    page.locator('main [data-v2-planned]'),
    `${path} shows no planned placeholder`,
  ).toHaveCount(0);
  // A kept v1 body inside the v2 shell (F-006, RC-08) is marked `data-v2-kept` by KeptShell.
  await expect(page.locator('[data-v2-kept]'), `${path} is not a kept v1 body`).toHaveCount(0);
}
