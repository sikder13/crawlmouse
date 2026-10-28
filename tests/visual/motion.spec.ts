import { test, expect, type Browser, type Page } from './pw';

/**
 * The crawl screen's motion is presentation over state, never state: each recording is played to
 * its end on Playwright's fake clock, once with reduced motion and once without, and the final DOM
 * of the page's main content must be identical. Under reduced motion nothing animates (a11y.spec);
 * here, every element still reaches its final state.
 *
 * The fake clock drives the player (timers, performance.now). The clock moves only once the page
 * has hydrated and its replay reports playing, and the DOM is read only once the replay reports
 * still and the map reports its last layout applied: the layout comes back from a Web Worker in
 * real time, so the clock is stepped until it lands. Web Animations still running are waited out.
 */
/**
 * The page's main content as markup, with two differences of serialisation removed, never of
 * content: inline styles are rewritten through the CSSOM (the server writes
 * `transform:scaleX(0.5526315789473685)`, React updating it leaves `transform: scaleX(0.552632);`),
 * and the comments the server puts between adjacent pieces of text (`41<!-- --> / <!-- -->100`)
 * are dropped, with the text joined as the browser joins it.
 */
const readMain = (page: Page) =>
  page.locator('main').evaluate((m) => {
    const copy = m.cloneNode(true) as HTMLElement;
    copy.querySelectorAll<HTMLElement>('[style]').forEach((e) => {
      e.setAttribute('style', e.style.cssText);
    });
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_COMMENT);
    const comments: Node[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) comments.push(n);
    comments.forEach((c) => c.parentNode?.removeChild(c));
    copy.normalize();
    return copy.outerHTML;
  });

const CRAWLS = [
  { path: '/v2-preview/screens/crawl', ends: true },
  { path: '/v2-preview/screens/crawl/challenged', ends: true },
  { path: '/v2-preview/screens/crawl/clean', ends: false },
] as const;

/**
 * The page opened at its end, paused: the server draws that frame, the map laid out by the same
 * pure function the Worker runs. A replay that stopped short, or whose last layout never landed,
 * cannot equal it.
 */
async function endDom(browser: Browser, path: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${path}?at=end`, { waitUntil: 'load' });
  const html = await readMain(page);
  await context.close();
  return html;
}

async function finalDom(browser: Browser, path: string, reducedMotion: 'reduce' | 'no-preference') {
  const context = await browser.newContext({
    reducedMotion,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto(path, { waitUntil: 'load' });
  const replay = page.locator('[data-v2-replay]');
  await expect(replay, 'the replay starts once the page hydrates').toHaveAttribute(
    'data-v2-replay',
    'playing',
    { timeout: 60_000 },
  );
  await page.clock.runFor(240_000);
  await expect
    .poll(
      async () => {
        await page.clock.runFor(1_000);
        return replay.getAttribute('data-v2-replay');
      },
      { message: 'the replay reaches its end', timeout: 60_000 },
    )
    .toBe('still');
  await expect
    .poll(
      async () => {
        await page.clock.runFor(1_000);
        return page.locator('[data-v2-map]').getAttribute('data-v2-layout');
      },
      { message: 'the map applies its last layout', timeout: 90_000 },
    )
    .toBe('settled');
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
  const html = await readMain(page);
  await context.close();
  return html;
}

test.describe('motion changes nothing but motion', () => {
  test.describe.configure({ timeout: 300_000 });

  for (const c of CRAWLS) {
    test(`${c.path}: the same final DOM with and without reduced motion, and at its end`, async ({
      browser,
    }) => {
      const still = await finalDom(browser, c.path, 'reduce');
      const moving = await finalDom(browser, c.path, 'no-preference');
      expect(still.length).toBeGreaterThan(5_000);
      expect(still.includes('See the full result')).toBe(c.ends);
      expect(moving).toBe(still);
      expect(still, 'the replay ends on the frame the server draws for its end').toBe(
        await endDom(browser, c.path),
      );
    });
  }
});
