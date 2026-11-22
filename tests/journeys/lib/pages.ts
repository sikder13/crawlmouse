import { expect, type Locator, type Page, type Response } from '../pw';

/**
 * The status a page answered with, reading a 304 as the 200 it revalidates: a browser that holds the page
 * in its cache (Firefox does on a second visit) asks conditionally, and "not modified" is a correct answer.
 */
export function pageStatus(res: Response | null): number | undefined {
  const s = res?.status();
  return s === 304 ? 200 : s;
}

/** The register id an assertion encodes, put in its message; `unregistered` when nothing explains a failure. */
export type Why = string | undefined;
const why = (id: Why) => id ?? 'unregistered';

/**
 * A finished v2 page: it answers `status`, inside the v2 shell, and is not a kept v1 body (KeptShell's
 * `data-v2-kept`, F-006). Each check names the defect that explains its failure today, if any, so an
 * unexplained failure is never taken for an expected one (lib/step.ts).
 */
export async function expectFinishedV2Page(
  page: Page,
  path: string,
  ids: { status?: Why; shell?: Why; kept?: Why } = {},
  status = 200,
): Promise<void> {
  const res = await page.goto(path);
  expect(pageStatus(res), `${why(ids.status)}: ${path} answers ${status}`).toBe(status);
  await expect(
    page.locator('[data-v2-shell]'),
    `${why(ids.shell)}: ${path} is inside the v2 shell`,
  ).not.toHaveCount(0);
  await expect(
    page.locator('[data-v2-kept]'),
    `${why(ids.kept)}: ${path} is not a kept v1 body`,
  ).toHaveCount(0);
}

/** The page's own content: `main` when the page has one, the body otherwise. */
export async function contentOf(page: Page): Promise<Locator> {
  return (await page.locator('main').count()) > 0
    ? page.locator('main').first()
    : page.locator('body');
}
