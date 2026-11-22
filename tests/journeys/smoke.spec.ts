import { expect } from './pw';
import { step } from './lib/step';

// SMOKE (STEPS.md): the read-only part of the set every gate runs. SMOKE.2–5 need staging accounts
// and a check; they land with the staging seed.

step('SMOKE.1', 'home answers with the v2 page', { writes: false }, async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  await expect(page.locator('[data-v2-shell]')).toHaveCount(1);
});

step(
  'SMOKE.6',
  'robots.txt matches the pinned document',
  { writes: false },
  async ({ request }) => {
    // The document names the site's own origin (lib/site-url.ts), so build it for the origin under test's
    // canonical site: JOURNEY_SITE_ORIGIN, or production's when the deployment does not set its own.
    process.env.NEXT_PUBLIC_BASE_URL = process.env.JOURNEY_SITE_ORIGIN ?? 'https://crawlmouse.com';
    const { robotsTxt } = await import('../../apps/web/lib/robots-txt');
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe(robotsTxt());
  },
);

step(
  'SMOKE.7',
  'the sitemap answers and lists the home page',
  { writes: false },
  async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('<urlset');
    const origin = process.env.JOURNEY_SITE_ORIGIN ?? 'https://crawlmouse.com';
    expect(xml, 'lists the home page').toMatch(
      new RegExp(`<loc>${origin.replace(/[.]/g, '\\.')}/?</loc>`),
    );
  },
);

step(
  'SMOKE.8',
  '/api/health reports ok and the expected commit',
  { writes: false },
  async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean; commit: string | null };
    expect(body.ok).toBe(true);
    const want = process.env.JOURNEY_EXPECT_COMMIT;
    if (want) expect(body.commit ?? '').toMatch(new RegExp(`^${want}`));
  },
);
