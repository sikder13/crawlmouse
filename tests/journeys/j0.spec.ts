import { expect } from './pw';
import { expectFinishedV2Page } from './lib/pages';
import { step } from './lib/step';

// J0 — visitor who never signs up (STEPS.md). The steps here are the ones that write nothing; J0.3–J0.8
// start checks and land with staging. Expected-fail ids come from expected-fail.json (lib/step.ts).

step(
  'J0.2',
  'every header and footer entry opens a finished v2 page',
  { writes: false },
  async ({ page, baseURL }) => {
    await page.goto('/');
    const shell = page.locator('[data-v2-shell]');
    // An entry rendered as plain "planned" text is an entry that opens nothing (F-005).
    await expect(shell.locator('[data-v2-planned]'), 'entries that open nothing').toHaveCount(0);
    const hrefs = await shell
      .locator('header a[href], footer a[href]')
      .evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).href))]);
    const origin = new URL(baseURL!).origin;
    const internal = hrefs.filter((h) => new URL(h).origin === origin && !new URL(h).hash);
    expect(internal.length, 'header and footer have internal entries').toBeGreaterThan(0);
    const failures: string[] = [];
    for (const href of internal) {
      const path = new URL(href).pathname + new URL(href).search;
      const res = await page.goto(path);
      const v2 = await page.locator('[data-v2-shell]').count();
      if (res?.status() !== 200 || v2 === 0)
        failures.push(`${path} → ${res?.status()}${v2 ? '' : ', not v2'}`);
    }
    expect(failures, 'entries that do not open a finished v2 page').toEqual([]);
  },
);

const pages: [id: string, title: string, paths: string[]][] = [
  ['J0.9a', 'pricing', ['/pricing']],
  ['J0.9b', 'the agency pages', ['/agencies', '/agency-trial']],
  ['J0.9c', 'help', ['/help']],
  ['J0.9d', 'guides', ['/guides']],
  ['J0.9e', 'a blog post', ['/blog/screaming-frog-alternative']],
  ['J0.9f', 'the research page', ['/blog/research']],
  ['J0.9h', 'developers', ['/developers']],
  [
    'J0.9k',
    'every legal page',
    ['/privacy', '/terms', '/aup', '/subprocessors', '/refunds', '/dpa', '/cookies'],
  ],
];
for (const [id, title, paths] of pages) {
  step(id, `${title} is a finished v2 page`, { writes: false }, async ({ page }) => {
    for (const path of paths) await expectFinishedV2Page(page, path);
  });
}

step('J0.9g', 'status shows the product, not internals', { writes: false }, async ({ page }) => {
  await expectFinishedV2Page(page, '/status');
  const text = await page.locator('main').innerText();
  expect(text, 'no "not monitored" parts').not.toMatch(/not monitored/i);
  expect(text, 'no version number').not.toMatch(/\bversion\b|\b\d+\.\d+\.\d+\b/i);
});

step(
  'J0.9i',
  'the AI-readiness checker describes what a v2 check returns',
  { writes: false },
  async ({ page }) => {
    await expectFinishedV2Page(page, '/ai-readiness-checker');
    expect(await page.locator('main').innerText()).not.toMatch(/0\s*[–-]\s*100/);
  },
);

step('J0.9j', '/bot describes the v2 crawler', { writes: false }, async ({ page }) => {
  await expectFinishedV2Page(page, '/bot');
  const text = await page.locator('main').innerText();
  expect(text, 'names the v2 user agent').toContain('Crawlmouse/2.0');
  expect(text, 'no v1 crawler name').not.toContain('CrawlmouseBot/1.0');
});

step('J0.9l', 'an unknown address is the v2 404', { writes: false }, async ({ page }) => {
  await expectFinishedV2Page(page, '/this-page-does-not-exist-journeys', 404);
});
