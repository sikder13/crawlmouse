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
 * Layout shift over a whole replay, as a reader sees it: the page at desktop, tablet and phone
 * sizes, at its top or scrolled to the part a reader would be watching, played to its end on the
 * fake clock, every layout-shift entry not caused by input summed. The widths vary what the rules
 * key on: 412 is where the header's buttons share the brand's row only if the button keeps its
 * width, 375 and 360 where the status heading and its clock no longer share a line, 600 and 390
 * phone layouts with the verdicts under the email ask (a reader at the ask, or at the verdicts:
 * at 600 the reveal and the ask share a height, at 390 the reveal is taller), 960 and 1024 the
 * tablet layouts. Two budgets:
 * - Until the grades land: 0.001, zero within rounding. The log keeps LOG_LINES slots from the
 *   start, the step rows, the counts and the note beside the domain keep their lines on a narrow
 *   screen, and the verdicts are under the stage below 1200px from the start.
 * - The reveal itself: 0.01. It replaces the email ask with the grades and changes the words
 *   beside the domain; a tenth of the 0.1 the web's own guidance calls good, for one change the
 *   reader has been waiting for.
 * The same replay checks that the map moves nothing once the grades are announced: its last
 * layout lands when grading begins.
 */
const SHIFT = { beforeReveal: 0.001, reveal: 0.01 };

type Watching = 'top' | 'log' | 'verdicts' | 'found' | 'ask';
const BAD = '/v2-preview/screens/crawl';
const SHIFT_CASES: { path: string; width: number; height: number; at: Watching }[] = [
  { path: BAD, width: 1280, height: 900, at: 'top' },
  { path: BAD, width: 1024, height: 768, at: 'top' },
  { path: BAD, width: 960, height: 900, at: 'verdicts' },
  { path: BAD, width: 600, height: 960, at: 'verdicts' },
  { path: BAD, width: 600, height: 960, at: 'ask' },
  { path: BAD, width: 390, height: 844, at: 'ask' },
  { path: BAD, width: 390, height: 844, at: 'verdicts' },
  { path: BAD, width: 412, height: 915, at: 'top' },
  { path: BAD, width: 390, height: 844, at: 'top' },
  { path: BAD, width: 390, height: 844, at: 'log' },
  { path: BAD, width: 375, height: 812, at: 'top' },
  { path: BAD, width: 360, height: 780, at: 'found' },
  { path: '/v2-preview/screens/crawl/challenged', width: 1280, height: 900, at: 'top' },
  { path: '/v2-preview/screens/crawl/challenged', width: 390, height: 844, at: 'top' },
  { path: '/v2-preview/screens/crawl/clean', width: 390, height: 844, at: 'top' },
];

test.describe('layout shift over a whole replay', () => {
  test.describe.configure({ timeout: 300_000 });

  for (const c of SHIFT_CASES) {
    test(`${c.path} at ${c.width}px${c.at === 'top' ? '' : `, scrolled to the ${c.at}`}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport: { width: c.width, height: c.height } });
      const page = await context.newPage();
      await page.addInitScript(() => {
        const said = () => document.querySelector('[data-v2-announce]')?.textContent ?? '';
        // Each shift, and whether the grades had been announced when it was recorded: the
        // reveal's own shift is recorded with the frame that announced it.
        const w = window as unknown as {
          __shift: { value: number; revealed: boolean }[];
          __late: string[];
        };
        w.__shift = [];
        new PerformanceObserver((list) =>
          list.getEntries().forEach((e) => {
            const s = e as unknown as { value: number; hadRecentInput: boolean };
            if (s.hadRecentInput) return;
            w.__shift.push({ value: s.value, revealed: said() !== '' });
          }),
        ).observe({ type: 'layout-shift' });
        // Every motion started on a page or a link of the map after the grades were announced.
        w.__late = [];
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (this: Element, ...args) {
          const id = this.getAttribute('data-v2-node') ?? this.getAttribute('data-v2-edge');
          if (id !== null && said() !== '') w.__late.push(id);
          return animate.apply(this, args);
        };
      });
      await page.clock.install();
      await page.goto(`${c.path}?play`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const replay = page.locator('[data-v2-replay]');
      await expect(replay).toHaveAttribute('data-v2-replay', 'playing', { timeout: 60_000 });
      const watched = {
        top: null,
        log: page.locator('[data-v2-overlay]', { hasText: 'Recent fetches' }),
        verdicts: page.locator('[data-v2-verdicts="after"]'),
        found: page.getByText('Found so far', { exact: true }),
        ask: page.getByRole('button', { name: 'Email me the result' }),
      }[c.at];
      if (watched) await watched.scrollIntoViewIfNeeded();
      for (let i = 0; i < 1_200; i++) {
        await page.clock.runFor(250);
        await page.waitForTimeout(25);
        if ((await replay.getAttribute('data-v2-replay')) === 'still') break;
      }
      expect(await replay.getAttribute('data-v2-replay'), 'the replay reached its end').toBe(
        'still',
      );
      // Time for any layout still due to land, and for the map to say it has.
      await expect
        .poll(
          async () => {
            await page.clock.runFor(1_000);
            await page.waitForTimeout(50);
            return page.locator('[data-v2-map]').getAttribute('data-v2-layout');
          },
          { message: 'the map applies its last layout', timeout: 60_000 },
        )
        .toBe('settled');
      const { shifts, late } = await page.evaluate(() => {
        const w = window as unknown as {
          __shift: { value: number; revealed: boolean }[];
          __late: string[];
        };
        return { shifts: w.__shift, late: w.__late };
      });
      await context.close();
      const add = (xs: { value: number }[]) => xs.reduce((n, x) => n + x.value, 0);
      const run = add(shifts.filter((x) => !x.revealed));
      const reveal = add(shifts.filter((x) => x.revealed));
      const said = JSON.stringify({ run, reveal, late: late.length });
      console.log(`[shift] ${c.path} ${c.width} ${c.at}: ${said}`);
      expect(run, said).toBeLessThanOrEqual(SHIFT.beforeReveal);
      expect(reveal, said).toBeLessThanOrEqual(SHIFT.reveal);
      expect(late.slice(0, 10), 'map motion after the grades were announced').toEqual([]);
    });
  }
});

/**
 * A page's element is built once. As the map grows, each page keeps its element (and so any motion
 * running on it) unless the page changes shape, which a classification does (a circle becomes a
 * square or a triangle). Counted over a whole replay: an element removed and one of the same shape
 * added back for the same page is a rebuild.
 */
test('the map builds each page once as it grows', async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as { __rebuilt: string[] };
    w.__rebuilt = [];
    const gone = new Map<string, string>();
    new MutationObserver((records) => {
      for (const r of records) {
        r.removedNodes.forEach((n) => {
          if (n instanceof Element && n.hasAttribute('data-v2-node')) {
            gone.set(n.getAttribute('data-v2-node')!, n.tagName);
          }
        });
        r.addedNodes.forEach((n) => {
          if (!(n instanceof Element) || !n.hasAttribute('data-v2-node')) return;
          const id = n.getAttribute('data-v2-node')!;
          if (gone.get(id) === n.tagName) w.__rebuilt.push(id);
          gone.delete(id);
        });
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.clock.install();
  await page.goto('/v2-preview/screens/crawl?play', { waitUntil: 'load' });
  const replay = page.locator('[data-v2-replay]');
  await expect(replay).toHaveAttribute('data-v2-replay', 'playing', { timeout: 60_000 });
  for (let i = 0; i < 1_200; i++) {
    await page.clock.runFor(250);
    await page.waitForTimeout(25);
    if ((await replay.getAttribute('data-v2-replay')) === 'still') break;
  }
  expect(await replay.getAttribute('data-v2-replay'), 'the replay reached its end').toBe('still');
  const rebuilt = await page.evaluate(
    () => (window as unknown as { __rebuilt: string[] }).__rebuilt,
  );
  await context.close();
  expect(rebuilt).toEqual([]);
});
