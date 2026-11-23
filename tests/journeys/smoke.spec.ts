import { expect } from './pw';
import { step } from './lib/step';

// SMOKE (STEPS.md): the read-only part of the set every gate runs. SMOKE.2–5 need staging accounts and a
// check; they land with the staging seed.

/** The site's canonical origin as the deployment states it (NEXT_PUBLIC_BASE_URL), without a trailing slash. */
const siteOrigin = () =>
  (process.env.JOURNEY_SITE_ORIGIN || 'https://crawlmouse.com').replace(/\/+$/, '');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

step('SMOKE.1', 'home answers with the v2 page', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  await expect(page.locator('[data-v2-shell]')).toHaveCount(1);
});

step('SMOKE.6', 'robots.txt matches the pinned document', async ({ request }) => {
  // robotsTxt() reads NEXT_PUBLIC_BASE_URL when it is called, so set it to the origin under test first.
  process.env.NEXT_PUBLIC_BASE_URL = siteOrigin();
  const { robotsTxt } = await import('../../apps/web/lib/robots-txt');
  const res = await request.get('/robots.txt');
  expect(res.status()).toBe(200);
  expect(await res.text()).toBe(robotsTxt());
});

step('SMOKE.7', 'the sitemap answers and lists the home page', async ({ request }) => {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  const xml = await res.text();
  expect(xml).toContain('<urlset');
  expect(xml, 'lists the home page').toMatch(new RegExp(`<loc>${escape(siteOrigin())}/?</loc>`));
});

step(
  'SMOKE.8',
  '/api/health reports ok, and the expected commit when one is given',
  async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean; commit: string | null };
    expect(body.ok).toBe(true);
    const want = process.env.JOURNEY_EXPECT_COMMIT;
    if (want)
      expect(
        (body.commit ?? '').startsWith(want),
        `commit ${body.commit} starts with ${want}`,
      ).toBe(true);
  },
);
