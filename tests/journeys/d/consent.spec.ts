import type { BrowserContext, Page } from '../pw';
import { expect } from '../pw';
import { step } from '../lib/step';

// RC-15's defects, read from a real browser. Nothing here reaches PostHog or Sentry: their hosts and
// the /ingest proxy are answered in the browser. A region is set with the cookie the middleware
// writes, before the page's scripts read it, because a test cannot choose the country Vercel sees.

const REGION_COOKIE = 'cm_consent_required';
const PH_NAME = /^(?:__)?ph_/;
const BAR = '[role="dialog"][aria-label="Analytics consent"]';
/** Time for a late start to show itself after `load`. */
const SETTLE_MS = 3_000;
/** posthog-js's default `remote_config_refresh_interval_ms`. */
const REFRESH_MS = 5 * 60 * 1000;
/** Longer than the SDK's send queue holds an event. */
const QUEUE_MS = 10_000;

const isAnalytics = (url: URL) =>
  url.hostname === 'posthog.com' ||
  url.hostname.endsWith('.posthog.com') ||
  url.pathname === '/ingest' ||
  url.pathname.startsWith('/ingest/');

/** Answers every analytics request here, and returns the list of them as they happen. */
async function holdAnalytics(context: BrowserContext): Promise<URL[]> {
  const seen: URL[] = [];
  await context.route(isAnalytics, async (route) => {
    const url = new URL(route.request().url());
    seen.push(url);
    // The remote config loads as a script: an empty one is what starts the SDK's refresh timer.
    await (url.pathname.endsWith('/config.js')
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
      : route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  });
  await context.route(
    (url) => url.hostname.endsWith('.sentry.io'),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  return seen;
}

/** The visitor's region, as the page's scripts will read it on each load. */
const inRegion = (context: BrowserContext, required: '0' | '1') =>
  context.addInitScript(
    ([name, value]) => {
      document.cookie = `${name}=${value}; path=/`;
    },
    [REGION_COOKIE, required] as const,
  );

async function open(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('load');
  await page.waitForTimeout(SETTLE_MS);
}

/** The names of what PostHog would have left in this browser. */
async function traces(page: Page, context: BrowserContext): Promise<string[]> {
  const cookies = (await context.cookies()).map((c) => c.name);
  const stored = await page.evaluate(() => Object.keys(localStorage));
  return [...cookies, ...stored].filter((n) => PH_NAME.test(n));
}

async function expectNothingStarted(
  page: Page,
  context: BrowserContext,
  seen: URL[],
  when: string,
) {
  expect(await traces(page, context), `F-048: PostHog left storage ${when}`).toEqual([]);
  expect(
    seen.map((u) => u.href),
    `F-048: PostHog sent requests ${when}`,
  ).toEqual([]);
}

step(
  'D.F-048',
  'where consent is required, PostHog does not start before a choice or after Decline',
  async ({ page, context }) => {
    const seen = await holdAnalytics(context);
    await inRegion(context, '1');
    await open(page);
    await expect(page.locator(BAR)).toBeVisible();
    await expectNothingStarted(page, context, seen, 'before any choice');

    await page.locator(BAR).getByRole('button', { name: 'Decline' }).click();
    await expect(page.locator(BAR)).toBeHidden();
    await open(page);
    await expect(page.locator(BAR)).toBeHidden();
    await expectNothingStarted(page, context, seen, 'after Decline');
  },
);

step(
  'D.F-048',
  'after Decline on a page that keeps running, nothing more is sent, on the refresh timer either',
  async ({ page, context }) => {
    const seen = await holdAnalytics(context);
    await inRegion(context, '1');
    await page.clock.install();
    await open(page);
    await page.locator(BAR).getByRole('button', { name: 'Allow analytics' }).click();
    const flags = () => seen.filter((u) => u.pathname.includes('/flags')).length;
    await expect.poll(flags, { message: 'PostHog never asked for flags' }).toBeGreaterThan(0);

    // The control: while analytics run, the refresh does call /flags.
    const before = flags();
    await page.clock.runFor(REFRESH_MS);
    await expect.poll(flags, { message: 'the refresh timer did not run' }).toBeGreaterThan(before);

    await page.locator('footer').last().getByRole('button', { name: 'Cookie settings' }).click();
    await page.locator(BAR).getByRole('button', { name: 'Decline' }).click();
    await expect(page.locator(BAR)).toBeHidden();
    // An event queued before the Decline was captured with consent and may still go.
    await page.clock.runFor(QUEUE_MS);
    await page.waitForTimeout(500);
    const sent = seen.length;

    await page.clock.runFor(REFRESH_MS * 2);
    await page.waitForTimeout(1_000);
    expect(
      seen.slice(sent).map((u) => u.href),
      'F-048: PostHog sent a request after Decline',
    ).toEqual([]);
    expect(await traces(page, context), 'F-048: PostHog left storage after Decline').toEqual([]);
  },
);

step(
  'D.F-049',
  'analytics go through /ingest, with no surveys, dead-click or web-vitals add-on',
  async ({ page, context, baseURL }) => {
    const seen = await holdAnalytics(context);
    await inRegion(context, '0');
    await open(page);
    await expect
      .poll(() => seen.length, { message: 'PostHog never started where it may', timeout: 15_000 })
      .toBeGreaterThan(0);
    const origin = new URL(baseURL!).origin;
    const direct = seen.filter((u) => u.origin !== origin).map((u) => u.href);
    expect(direct, 'F-049: analytics went straight to PostHog').toEqual([]);
    const addOns = seen
      .filter((u) => /surveys|dead-clicks|web-vitals/.test(u.pathname))
      .map((u) => u.href);
    expect(addOns, 'F-049: an add-on nothing reads was loaded').toEqual([]);
  },
);

step(
  'D.F-045',
  'the Sentry SDK is not in the first load, and still loads afterwards',
  async ({ page, context, request }) => {
    // The scripts the page's HTML names are its first load; the SDK's name is a string in its code.
    const html = await (await request.get('/')).text();
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="(\/_next\/[^"]+)"/g)].map((m) =>
      m[1]!.replaceAll('&amp;', '&'),
    );
    expect(scripts.length, 'the page names no scripts to read').toBeGreaterThan(0);
    const withSdk: string[] = [];
    for (const src of scripts) {
      if ((await (await request.get(src)).text()).includes('sentry.javascript')) withSdk.push(src);
    }
    expect(withSdk, 'F-045: the Sentry SDK is in the first load').toEqual([]);

    await holdAnalytics(context);
    await inRegion(context, '1');
    await open(page);
    await page.waitForFunction(() => '__SENTRY__' in window, undefined, { timeout: 20_000 });
  },
);

step('D.F-067', 'the consent bar does not cover the footer', async ({ page, context }) => {
  await holdAnalytics(context);
  await inRegion(context, '1');
  await open(page);
  await expect(page.locator(BAR)).toBeVisible();
  const control = page.locator('footer').last().getByRole('button', { name: 'Cookie settings' });
  await control.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const covered = await control.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return !(top !== null && (el === top || el.contains(top)));
  });
  expect(covered, 'F-067: the consent bar covers the footer').toBe(false);
});

step(
  'D.F-088',
  'Cookie settings moves focus into the bar, and Escape leaves the choice unmade',
  async ({ page, context }) => {
    await holdAnalytics(context);
    await inRegion(context, '1');
    await open(page);
    await page.locator(BAR).getByRole('button', { name: 'Decline' }).click();
    await expect(page.locator(BAR)).toBeHidden();

    const control = page.locator('footer').last().getByRole('button', { name: 'Cookie settings' });
    await control.scrollIntoViewIfNeeded();
    await control.click();
    await expect(page.locator(BAR)).toBeVisible();
    const inside = await page.locator(BAR).evaluate((bar) => bar.contains(document.activeElement));
    expect(inside, 'F-088: the bar did not take focus').toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.locator(BAR), 'F-088: Escape did not close the bar').toBeHidden();
    const decision = await page.evaluate(() => localStorage.getItem('cm_consent'));
    expect(decision, 'F-088: Escape changed the recorded decision').toBe('denied');
  },
);
