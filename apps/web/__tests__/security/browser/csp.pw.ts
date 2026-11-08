import { expect, test, type Page } from '@playwright/test';
import { SENTRY_ORIGIN } from './build-env';

// The report-only CSP in a real browser: the pages load Turnstile, send PostHog events through the
// /ingest proxy and report an error to Sentry, and nothing raises a violation, logs a CSP message or
// files a report. PostHog and Sentry requests are answered here, so nothing leaves CI; Turnstile
// loads from Cloudflare with its always-pass test sitekey.

interface Seen {
  violations: string[];
  consoleCsp: string[];
  ingest: string[];
  sentryEnvelopes: string[];
  cspReports: string[];
  failed: string[];
}

async function watch(page: Page): Promise<Seen> {
  const seen: Seen = {
    violations: [],
    consoleCsp: [],
    ingest: [],
    sentryEnvelopes: [],
    cspReports: [],
    failed: [],
  };
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      w.__csp.push(`${e.disposition} ${e.effectiveDirective} ${e.blockedURI}`),
    );
  });
  page.on('console', (m) => {
    if (/content[- ]security[- ]policy/i.test(m.text())) seen.consoleCsp.push(m.text());
  });
  // An asset that fails to load (a script, a style, an image, a font) is what a CSP or an upgraded URL
  // breaks. Next's route prefetches are aborted by the browser as a matter of course and are not read.
  page.on('requestfailed', (r) => {
    if (['script', 'stylesheet', 'image', 'font'].includes(r.resourceType())) {
      seen.failed.push(`${r.url()} ${r.failure()?.errorText}`);
    }
  });
  await page.route('**/ingest/**', (route) => {
    seen.ingest.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route(`${SENTRY_ORIGIN}/**`, (route) => {
    const url = route.request().url();
    (url.includes('/security/') ? seen.cspReports : seen.sentryEnvelopes).push(url);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  return seen;
}

async function settle(page: Page, seen: Seen) {
  await page.waitForLoadState('networkidle');
  seen.violations.push(
    ...(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)),
  );
}

for (const path of ['/', '/login', '/pricing']) {
  test(`${path}: no CSP violation, with PostHog and Sentry working through it`, async ({
    page,
  }) => {
    const seen = await watch(page);
    await page.goto(path);
    await expect
      .poll(() => seen.ingest.length, { message: 'a PostHog request through /ingest' })
      .toBeGreaterThan(0);

    // A thrown error reaches Sentry's ingest host, which connect-src allows.
    await page.evaluate(() =>
      setTimeout(() => {
        throw new Error('csp check: Sentry reporting');
      }, 0),
    );
    await expect
      .poll(() => seen.sentryEnvelopes.length, { message: 'a Sentry envelope' })
      .toBeGreaterThan(0);

    if (path === '/login') {
      await expect
        .poll(
          () => page.frames().some((f) => f.url().startsWith('https://challenges.cloudflare.com/')),
          {
            message: 'the Turnstile frame',
            timeout: 20_000,
          },
        )
        .toBe(true);
    }

    await settle(page, seen);
    expect(seen.violations).toEqual([]);
    expect(seen.consoleCsp).toEqual([]);
    expect(seen.cspReports).toEqual([]);
    expect(seen.failed.filter((f) => !f.includes('challenges.cloudflare.com'))).toEqual([]);
  });
}

test('the watch sees a violation when one happens (anti-vacuity)', async ({ page }) => {
  await watch(page);
  await page.route('https://script.example/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
  );
  await page.goto('/');
  await page.evaluate(() => {
    const s = document.createElement('script');
    s.src = 'https://script.example/x.js'; // script-src does not list this origin
    document.body.append(s);
  });
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp))
    .toContain('report script-src-elem https://script.example/x.js');
});
