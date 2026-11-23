import { expect, type Locator, type Page, type Response } from '../pw';

/**
 * The status a page answered with, reading a 304 as the 200 it revalidates: a browser that holds the page
 * in its cache (Firefox does on a second visit) asks conditionally, and "not modified" is a correct answer.
 */
export function pageStatus(res: Response | null): number | undefined {
  const s = res?.status();
  return s === 304 ? 200 : s;
}

/**
 * A registered defect and the symptom that shows it. An assertion names the id only when the page shows
 * that symptom, so a different failure on the same page (a 500 where CC-45 saw a 404, a blank page where
 * it saw a v1 one) is never taken for the old defect.
 */
export interface StatusDefect {
  id: string;
  /** The status CC-45 saw. */
  got: number;
}
export interface PageDefects {
  status?: StatusDefect;
  /** A v1 page with no v2 shell: named only when the v1 layout's cream marker is present. */
  shell?: string;
  /** A kept v1 body inside the v2 shell: KeptShell's `data-v2-kept` is its own marker. */
  kept?: string;
}

/** The v1 layout's cream classes (components/layout/Header.tsx, the v1 404): proof a page is v1, not blank. */
export const V1_MARKER = '[class*="bg-cream"]';

const UNREGISTERED = 'unregistered';

/** The id that explains a status, or `unregistered` when the page shows another status than the defect's. */
export function statusWhy(actual: number | undefined, defect: StatusDefect | undefined): string {
  return defect && actual === defect.got ? defect.id : UNREGISTERED;
}

/**
 * A finished v2 page: it answers `status`, inside the v2 shell, and is not a kept v1 body. Each check
 * names the defect that explains its failure today only when the page shows that defect's symptom.
 */
export async function expectFinishedV2Page(
  page: Page,
  path: string,
  ids: PageDefects = {},
  status = 200,
): Promise<void> {
  const res = await page.goto(path);
  const actual = pageStatus(res);
  expect(
    actual,
    `${actual === status ? '' : statusWhy(actual, ids.status)}: ${path} answers ${status}`,
  ).toBe(status);
  // The 404's shell is loaded on demand, so it can arrive just after the response. A v1 page still fails below.
  await page
    .locator('[data-v2-shell]')
    .first()
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  if ((await page.locator('[data-v2-shell]').count()) === 0) {
    const v1 = (await page.locator(V1_MARKER).count()) > 0;
    throw new Error(
      `${v1 && ids.shell ? ids.shell : UNREGISTERED}: ${path} is not inside the v2 shell${v1 ? ' (a v1 page)' : ''}`,
    );
  }
  await expect(
    page.locator('[data-v2-kept]'),
    `${ids.kept ?? UNREGISTERED}: ${path} is not a kept v1 body`,
  ).toHaveCount(0);
}

/** The page's own content: `main` when the page has one, the body otherwise. */
export async function contentOf(page: Page): Promise<Locator> {
  return (await page.locator('main').count()) > 0
    ? page.locator('main').first()
    : page.locator('body');
}
