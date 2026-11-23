import { expect } from './pw';
import {
  contentOf,
  expectFinishedV2Page,
  pageStatus,
  statusWhy,
  V1_MARKER,
  type PageDefects,
} from './lib/pages';
import { expectedFailOf, RedFailure, step } from './lib/step';

// J0 — visitor who never signs up (STEPS.md). The steps here write nothing; J0.3–J0.8 start checks and
// land with staging. An assertion names a registered defect only when the page shows that defect's own
// symptom (lib/pages.ts), so any other failure is red.

/**
 * Why a header or footer entry does not open a finished v2 page today, by path, with the symptom that
 * shows it (CC-45 J0.2): the Vercel checkpoint answers sign-in with 429 (F-025); v1 pages (F-007, F-027).
 */
const ENTRY: Record<string, PageDefects> = {
  '/login': { status: { id: 'F-025', got: 429 } },
  '/signup': { status: { id: 'F-025', got: 429 } },
  '/pricing': { shell: 'F-007' },
  '/developers': { shell: 'F-027' },
};

step(
  'J0.2',
  'every header and footer entry opens a finished v2 page',
  async ({ page, baseURL }) => {
    await page.goto('/');
    const shell = page.locator('[data-v2-shell]');
    const hrefs = await shell
      .locator('header a[href], footer a[href]')
      .evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).href))]);
    // An entry may name the canonical origin (NEXT_PUBLIC_BASE_URL) rather than the deployment under test.
    const origins = [
      new URL(baseURL!).origin,
      (process.env.JOURNEY_SITE_ORIGIN || 'https://crawlmouse.com').replace(/\/+$/, ''),
    ];
    const paths = hrefs
      .map((h) => new URL(h))
      .filter((u) => origins.includes(u.origin) && !u.hash)
      .map((u) => u.pathname + u.search);
    expect(paths.length, 'header and footer have internal entries').toBeGreaterThan(0);
    const unexplained: [id: string, what: string][] = [];
    const explained: [id: string, what: string][] = [];
    for (const path of [...new Set(paths)]) {
      const res = await page.goto(path);
      const status = pageStatus(res);
      const known = ENTRY[path] ?? {};
      let problem: [id: string, what: string] | null = null;
      if (status !== 200) problem = [statusWhy(status, known.status), `${path} → ${status}`];
      else if ((await page.locator('[data-v2-shell]').count()) === 0) {
        const v1 = (await page.locator(V1_MARKER).count()) > 0;
        problem = [
          v1 && known.shell ? known.shell : 'unregistered',
          `${path} is not in the v2 shell`,
        ];
      } else if ((await page.locator('[data-v2-kept]').count()) > 0) {
        problem = ['F-006', `${path} is a kept v1 body`];
      }
      if (problem) (problem[0] === 'unregistered' ? unexplained : explained).push(problem);
    }
    expect(
      unexplained.map(([, w]) => w),
      'entries that fail for no registered reason',
    ).toEqual([]);
    // An entry rendered as plain "planned" text opens nothing (F-005).
    const planned = await shell.locator('[data-v2-planned]').count();
    if (planned > 0) explained.push(['F-005', `${planned} entries open nothing`]);
    // J0.2 sees every cause at once, so a listed id it no longer sees is stale and must be deleted.
    const seen = new Set(explained.map(([f]) => f));
    const stale = expectedFailOf('J0.2').filter((f) => !seen.has(f));
    if (stale.length > 0) {
      throw new RedFailure(
        `J0.2 no longer fails on ${stale.join(', ')}: delete them from expected-fail.json`,
      );
    }
    const text = explained.map(([f, w]) => `${f}: ${w}`);
    expect(text, text.join('; ')).toEqual([]);
  },
);

type Page9 = [path: string, ids?: PageDefects];
const missing = (id: string): PageDefects => ({ status: { id, got: 404 } });
const pages: [id: string, title: string, paths: Page9[]][] = [
  ['J0.9a', 'pricing', [['/pricing', { shell: 'F-007' }]]],
  [
    'J0.9b',
    'the agency pages',
    [
      ['/agencies', missing('F-024')],
      ['/agency-trial', missing('F-024')],
    ],
  ],
  ['J0.9c', 'help', [['/help']]],
  ['J0.9d', 'guides', [['/guides', { kept: 'F-006' }]]],
  ['J0.9e', 'a blog post', [['/blog/screaming-frog-alternative', { kept: 'F-006' }]]],
  ['J0.9f', 'the research page', [['/blog/research', { kept: 'F-006' }]]],
  ['J0.9h', 'developers', [['/developers', { shell: 'F-027' }]]],
  [
    'J0.9k',
    'every legal page',
    [
      ['/privacy', { kept: 'F-006' }],
      ['/terms', { kept: 'F-006' }],
      ['/aup', { kept: 'F-006' }],
      ['/subprocessors', { kept: 'F-006' }],
      // The footer names Refunds and DPA as planned entries with no page yet (F-005).
      ['/refunds', missing('F-005')],
      ['/dpa', missing('F-005')],
    ],
  ],
];
for (const [id, title, list] of pages) {
  step(id, `${title} is a finished v2 page`, async ({ page }) => {
    for (const [path, ids] of list) await expectFinishedV2Page(page, path, ids);
  });
}

step('J0.9g', 'status shows the product, not internals', async ({ page }) => {
  await expectFinishedV2Page(page, '/status', { kept: 'F-006' });
  const text = await (await contentOf(page)).innerText();
  expect(text, 'F-063: no "not monitored" parts').not.toMatch(/not monitored/i);
  // The page prints "version 0.0.1, commit 8a72eb…" (CC-45); an IP address or a date is not that.
  expect(text, 'F-063: no version number').not.toMatch(/\bversion\s+v?\d+\.\d+\.\d+/i);
  expect(text, 'F-063: no commit').not.toMatch(/\bcommit\s+[0-9a-f]{7,40}\b/i);
});

step('J0.9i', 'the AI-readiness checker describes what a v2 check returns', async ({ page }) => {
  await expectFinishedV2Page(page, '/ai-readiness-checker', { kept: 'F-006' });
  const text = await (await contentOf(page)).innerText();
  expect(text, 'F-032: no 0–100 score').not.toMatch(/(^|[^\d])0\s*[–-]\s*100\b/);
});

step('J0.9j', '/bot describes the v2 crawler', async ({ page }) => {
  await expectFinishedV2Page(page, '/bot', { kept: 'F-006' });
  const text = await (await contentOf(page)).innerText();
  expect(text, 'F-031: names the v2 user agent').toContain('Crawlmouse/2.0');
  expect(text, 'F-031: no v1 crawler name').not.toContain('CrawlmouseBot/1.0');
});

step('J0.9l', 'an unknown address is the v2 404', async ({ page }) => {
  await expectFinishedV2Page(page, '/this-page-does-not-exist-journeys', { shell: 'F-026' }, 404);
});
