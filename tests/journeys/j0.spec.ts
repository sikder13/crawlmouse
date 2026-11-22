import { expect } from './pw';
import { contentOf, expectFinishedV2Page, pageStatus } from './lib/pages';
import { step } from './lib/step';

// J0 — visitor who never signs up (STEPS.md). The steps here write nothing; J0.3–J0.8 start checks and
// land with staging. Each assertion that encodes a registered defect names it (lib/step.ts).

/** Why a header or footer entry does not open a finished v2 page today, by path (CC-45 J0.2). */
const ENTRY = {
  status: { '/login': 'F-025', '/signup': 'F-025' } as Record<string, string>,
  shell: { '/pricing': 'F-007', '/developers': 'F-027' } as Record<string, string>,
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
    const unexplained: string[] = [];
    const explained: string[] = [];
    for (const path of [...new Set(paths)]) {
      const res = await page.goto(path);
      const status = pageStatus(res);
      const v2 = (await page.locator('[data-v2-shell]').count()) > 0;
      const kept = (await page.locator('[data-v2-kept]').count()) > 0;
      const problem =
        status !== 200
          ? [ENTRY.status[path], `${path} → ${status}`]
          : !v2
            ? [ENTRY.shell[path], `${path} is not in the v2 shell`]
            : kept
              ? ['F-006', `${path} is a kept v1 body`]
              : null;
      if (problem)
        (problem[0] ? explained : unexplained).push(
          problem[0] ? `${problem[0]}: ${problem[1]}` : problem[1],
        );
    }
    expect(unexplained, 'entries that fail for no registered reason').toEqual([]);
    // An entry rendered as plain "planned" text opens nothing (F-005).
    const planned = await shell.locator('[data-v2-planned]').count();
    if (planned > 0) explained.push(`F-005: ${planned} entries open nothing`);
    expect(explained, explained.join('; ')).toEqual([]);
  },
);

type Page9 = [path: string, ids?: { status?: string; shell?: string; kept?: string }];
const pages: [id: string, title: string, paths: Page9[]][] = [
  ['J0.9a', 'pricing', [['/pricing', { shell: 'F-007' }]]],
  [
    'J0.9b',
    'the agency pages',
    [
      ['/agencies', { status: 'F-024' }],
      ['/agency-trial', { status: 'F-024' }],
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
      ['/refunds', { status: 'F-005' }],
      ['/dpa', { status: 'F-005' }],
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
  expect(text, 'F-063: no version number').not.toMatch(/\bv?\d+\.\d+\.\d+\b/);
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
