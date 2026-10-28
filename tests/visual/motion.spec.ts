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
 *
 * Markup cannot show what an animation leaves behind, so the run with motion must also end with
 * no animation left on the page (one that holds its last frame stays listed) and with every element
 * in the main content at the same computed opacity and transform as without motion.
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

/** Each element's computed opacity and transform, in document order. */
const readLook = (page: Page) =>
  page.locator('main').evaluate((m) =>
    Array.from(m.querySelectorAll('*')).map((e) => {
      const s = getComputedStyle(e);
      return `${s.opacity} ${s.transform}`;
    }),
  );

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
  const look = await readLook(page);
  const animations = await page.evaluate(() => document.getAnimations().length);
  await context.close();
  return { html, look, animations };
}

test.describe('motion changes nothing but motion', () => {
  test.describe.configure({ timeout: 300_000 });

  for (const c of CRAWLS) {
    test(`${c.path}: the same final DOM with and without reduced motion, and at its end`, async ({
      browser,
    }) => {
      const still = await finalDom(browser, c.path, 'reduce');
      const moving = await finalDom(browser, c.path, 'no-preference');
      expect(still.html.length).toBeGreaterThan(5_000);
      expect(still.html.includes('See the full result')).toBe(c.ends);
      expect(moving.html).toBe(still.html);
      expect(moving.animations, 'no animation is left on the page').toBe(0);
      expect(moving.look, 'motion leaves no element at another opacity or transform').toEqual(
        still.look,
      );
      expect(still.html, 'the replay ends on the frame the server draws for its end').toBe(
        await endDom(browser, c.path),
      );
    });
  }
});

/**
 * Layout shift over a whole replay, as a reader sees it: the page at a desktop and a phone size,
 * at its top, and on a phone scrolled to the fetch log, played to its end on the fake clock, every
 * layout-shift entry not caused by input summed. Two budgets:
 * - Until the grades land: 0.001, zero within rounding. The log keeps LOG_LINES slots from the
 *   start, the step rows, the counts and the note beside the domain keep their lines on a narrow
 *   screen, and the verdicts are under the stage on a phone from the start.
 * - The reveal itself: 0.01. It replaces the email ask with the grades and changes the words
 *   beside the domain; a tenth of the 0.1 the web's own guidance calls good, for one change the
 *   reader has been waiting for.
 */
const SHIFT = { beforeReveal: 0.001, reveal: 0.01 };

const SHIFT_CASES = [
  { path: '/v2-preview/screens/crawl', width: 1280, height: 900 },
  { path: '/v2-preview/screens/crawl', width: 390, height: 844 },
  { path: '/v2-preview/screens/crawl', width: 390, height: 844, log: true },
  { path: '/v2-preview/screens/crawl/challenged', width: 1280, height: 900 },
  { path: '/v2-preview/screens/crawl/challenged', width: 390, height: 844 },
  { path: '/v2-preview/screens/crawl/clean', width: 390, height: 844 },
];

test.describe('layout shift over a whole replay', () => {
  test.describe.configure({ timeout: 300_000 });

  for (const c of SHIFT_CASES) {
    test(`${c.path} at ${c.width}px${c.log ? ', scrolled to the log' : ''}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport: { width: c.width, height: c.height } });
      const page = await context.newPage();
      await page.addInitScript(() => {
        // Each shift, and whether the grades had been announced when it was recorded: the
        // reveal's own shift is recorded with the frame that announced it.
        const w = window as unknown as { __shift: { value: number; revealed: boolean }[] };
        w.__shift = [];
        new PerformanceObserver((list) =>
          list.getEntries().forEach((e) => {
            const s = e as unknown as { value: number; hadRecentInput: boolean };
            if (s.hadRecentInput) return;
            const said = document.querySelector('[data-v2-announce]')?.textContent ?? '';
            w.__shift.push({ value: s.value, revealed: said !== '' });
          }),
        ).observe({ type: 'layout-shift' });
      });
      await page.clock.install();
      await page.goto(`${c.path}?play`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const replay = page.locator('[data-v2-replay]');
      await expect(replay).toHaveAttribute('data-v2-replay', 'playing', { timeout: 60_000 });
      if (c.log) {
        await page
          .locator('[data-v2-overlay]', { hasText: 'Recent fetches' })
          .scrollIntoViewIfNeeded();
      }
      for (let i = 0; i < 1_200; i++) {
        await page.clock.runFor(250);
        await page.waitForTimeout(25);
        if ((await replay.getAttribute('data-v2-replay')) === 'still') break;
      }
      await page.waitForTimeout(1_000);
      const shifts = await page.evaluate(
        () => (window as unknown as { __shift: { value: number; revealed: boolean }[] }).__shift,
      );
      await context.close();
      const add = (xs: { value: number }[]) => xs.reduce((n, x) => n + x.value, 0);
      const run = add(shifts.filter((x) => !x.revealed));
      const reveal = add(shifts.filter((x) => x.revealed));
      const said = JSON.stringify({ run, reveal });
      console.log(`[shift] ${c.path} ${c.width}${c.log ? ' log' : ''}: ${said}`);
      expect(run, said).toBeLessThanOrEqual(SHIFT.beforeReveal);
      expect(reveal, said).toBeLessThanOrEqual(SHIFT.reveal);
    });
  }
});
