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
 * phone layouts with the verdicts under the email ask (a reader at the ask, or at the verdicts: at
 * 600 the reveal and the ask share a height; at 390 the challenged site's reveal is taller), 960
 * and 1024 the tablet layouts, and a reader at the ask from 480 to 1280 (1100 the widest footer in
 * view); 320 is the reflow width WCAG 1.4.10 uses (1280px at 400% zoom). The budgets:
 * - The page's load, until the replay plays: 0.002, the budget of "nothing moves when the fonts
 *   arrive late" below; when a web font lands after the first paint it moves glyphs a fraction of
 *   a pixel, and how late it lands depends on the machine's load.
 * - Until the grades land: 0.001, zero within rounding. The log keeps LOG_LINES slots from the
 *   start, the step rows, the counts and the note beside the domain keep their lines on a narrow
 *   screen, and the verdicts are under the stage below 1200px from the start.
 * - The reveal itself: 0.01. It replaces the email ask with the grades and changes the words
 *   beside the domain; a tenth of the 0.1 the web's own guidance calls good, for one change the
 *   reader has been waiting for.
 * - The footer on its own, from 1024px and from the moment grading begins: 0.1, the web's own
 *   "good" line (the largest reading over these cases is 0.075, the bad site at 1100px, at the
 *   ask). There, as grading begins, the step list and log are drawn under the ask and from 1200px
 *   the verdicts join them, which pushes the footer down; for a reader at the ask the footer is the
 *   only thing in view that moves, by as much as it shows of itself. Counted apart, so it cannot
 *   hide a shift anywhere else; before grading, or narrower, a footer that moves counts as a shift.
 *   From the top of the page the footer is out of view in any window: the crawl screen is at least
 *   a screen tall.
 * - The same footer, for a reader scrolled to the page's end, from 1024px: each case is held to its
 *   own reading rounded up to the next hundredth (`footer` on the case). There the footer fills
 *   much of the window, and the rows that arrive as grading begins push it down by their height
 *   (the page grows about 675px at 1024px, where they stack, and 568px at 1280px, where they sit
 *   side by side). Its shift is the share of the window it fills times that distance over the
 *   window's longer side: 0.505 x 0.659 = 0.333 at 1024x768; 0.265 at 1100x900, 0.191 at 1280x900
 *   and 0.104 at 1920x1080. A shorter window at the same width reads more, as the footer fills more
 *   of it: 0.426 at 1024x600, the largest here. Shorter rows would make it smaller; only holding
 *   their room empty for the whole crawl, which the design review rejected as an empty band, would
 *   remove it. The reveal and the run keep their own budgets there too. Below 1024px nothing is
 *   added there, and 390px reads 0.
 * The same replay checks that the map moves nothing once the grades are announced: its last
 * layout lands when grading begins.
 */
const SHIFT = { load: 0.002, beforeReveal: 0.001, reveal: 0.01, footer: 0.1 };

type Watching = 'top' | 'log' | 'verdicts' | 'found' | 'ask' | 'end';
const BAD = '/v2-preview/screens/crawl';
const SHIFT_CASES: {
  path: string;
  width: number;
  height: number;
  at: Watching;
  /** The footer's own allowance, where it is not SHIFT.footer: the page's end, above. */
  footer?: number;
}[] = [
  { path: BAD, width: 1280, height: 900, at: 'top' },
  { path: BAD, width: 1280, height: 700, at: 'ask' },
  { path: BAD, width: 1280, height: 1300, at: 'top' },
  { path: BAD, width: 438, height: 900, at: 'ask' },
  { path: BAD, width: 1024, height: 768, at: 'top' },
  { path: BAD, width: 1024, height: 768, at: 'ask' },
  { path: BAD, width: 1100, height: 900, at: 'ask' },
  { path: BAD, width: 1024, height: 768, at: 'end', footer: 0.34 },
  { path: BAD, width: 1024, height: 600, at: 'end', footer: 0.43 },
  { path: BAD, width: 1100, height: 900, at: 'end', footer: 0.27 },
  { path: BAD, width: 1280, height: 900, at: 'end', footer: 0.2 },
  { path: BAD, width: 1920, height: 1080, at: 'end', footer: 0.11 },
  { path: BAD, width: 390, height: 844, at: 'end' },
  { path: BAD, width: 900, height: 900, at: 'ask' },
  { path: BAD, width: 761, height: 900, at: 'ask' },
  { path: BAD, width: 480, height: 900, at: 'ask' },
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
  { path: BAD, width: 320, height: 700, at: 'log' },
  { path: BAD, width: 320, height: 700, at: 'found' },
  { path: '/v2-preview/screens/crawl/challenged', width: 1280, height: 900, at: 'top' },
  { path: '/v2-preview/screens/crawl/challenged', width: 390, height: 844, at: 'top' },
  { path: '/v2-preview/screens/crawl/challenged', width: 390, height: 844, at: 'ask' },
  { path: '/v2-preview/screens/crawl/challenged', width: 390, height: 844, at: 'verdicts' },
  { path: '/v2-preview/screens/crawl/challenged', width: 1100, height: 900, at: 'ask' },
  { path: '/v2-preview/screens/crawl/clean', width: 390, height: 844, at: 'top' },
];

test.describe('layout shift over a whole replay', () => {
  test.describe.configure({ timeout: 300_000 });

  for (const c of SHIFT_CASES) {
    const tall = c.height > 1000 || c.height < 700 ? `, ${c.height}px tall` : '';
    test(`${c.path} at ${c.width}px${tall}${c.at === 'top' ? '' : `, scrolled to the ${c.at}`}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport: { width: c.width, height: c.height } });
      const page = await context.newPage();
      await page.addInitScript(() => {
        const said = () => document.querySelector('[data-v2-announce]')?.textContent ?? '';
        // Each shift, and whether the grades had been announced when it was recorded: the
        // reveal's own shift is recorded with the frame that announced it.
        const w = window as unknown as {
          __shift: {
            value: number;
            revealed: boolean;
            footer: boolean;
            load: boolean;
            grading: boolean;
          }[];
          __late: string[];
          __playing?: boolean;
        };
        w.__shift = [];
        new PerformanceObserver((list) =>
          list.getEntries().forEach((e) => {
            const s = e as unknown as {
              value: number;
              hadRecentInput: boolean;
              sources?: { node: Node | null }[];
            };
            if (s.hadRecentInput) return;
            // Whether every element that moved is in the footer.
            const footer =
              !!s.sources?.length &&
              s.sources.every((src) => {
                const el = src.node instanceof Element ? src.node : src.node?.parentElement;
                return !!el?.closest('footer');
              });
            w.__shift.push({
              value: s.value,
              revealed: said() !== '',
              footer,
              load: !w.__playing,
              // Grading has begun: the verdicts over the map are removed then, at every width.
              grading: !document.querySelector('[data-v2-verdicts="over"]'),
            });
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
        end: null,
      }[c.at];
      if (watched) await watched.scrollIntoViewIfNeeded();
      if (c.at === 'end') {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      }
      // What moved before here moved as the page loaded (a web font landing late, above all).
      await page.evaluate(() => {
        (window as unknown as { __playing: boolean }).__playing = true;
      });
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
          __shift: {
            value: number;
            revealed: boolean;
            footer: boolean;
            load: boolean;
            grading: boolean;
          }[];
          __late: string[];
        };
        return { shifts: w.__shift, late: w.__late };
      });
      await context.close();
      const add = (xs: { value: number }[]) => xs.reduce((n, x) => n + x.value, 0);
      // Only from 1024px, and only as grading begins, are rows added under the ask; before then, or
      // narrower, a footer that moves means something above it changed height: a shift.
      const footerOnly = (x: { footer: boolean; grading: boolean }) =>
        x.footer && x.grading && c.width >= 1024;
      const load = add(shifts.filter((x) => x.load));
      const run = add(shifts.filter((x) => !x.load && !x.revealed && !footerOnly(x)));
      const reveal = add(shifts.filter((x) => x.revealed && !footerOnly(x)));
      const footer = add(shifts.filter(footerOnly));
      const said = JSON.stringify({ load, run, reveal, footer, late: late.length });
      console.log(`[shift] ${c.path} ${c.width} ${c.at}: ${said}`);
      expect(load, said).toBeLessThanOrEqual(SHIFT.load);
      expect(run, said).toBeLessThanOrEqual(SHIFT.beforeReveal);
      expect(reveal, said).toBeLessThanOrEqual(SHIFT.reveal);
      expect(footer, said).toBeLessThanOrEqual(c.footer ?? SHIFT.footer);
      expect(late.slice(0, 10), 'map motion after the grades were announced').toEqual([]);
    });
  }
});

/**
 * The page as its web fonts arrive late, held back 1.5s: until then it is drawn in the fallback
 * face, whose metrics differ, so a line that breaks differently in each would move what follows
 * when the font lands. The crawl screen's header did, at 390-412px (0.17), until its actions took
 * their own row below 460px whatever the face. Budget 0.002: a font swap still moves glyphs a
 * fraction of a pixel within their lines, which the API counts.
 */
const FONT_CASES = [
  { path: '/v2-preview/screens/crawl?at=47000', width: 320 },
  { path: '/v2-preview/screens/crawl?at=47000', width: 390 },
  { path: '/v2-preview/screens/crawl?at=47000', width: 412 },
  { path: '/v2-preview/screens/crawl?at=47000', width: 1280 },
];
for (const c of FONT_CASES) {
  test(`nothing moves when the fonts arrive late: ${c.path} at ${c.width}px`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: c.width, height: 844 } });
    await context.route(/\.woff2?(\?|$)/, async (route) => {
      await new Promise((done) => setTimeout(done, 1_500));
      await route.continue();
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const w = window as unknown as { __shift: number };
      w.__shift = 0;
      new PerformanceObserver((list) =>
        list.getEntries().forEach((e) => {
          const s = e as unknown as { value: number; hadRecentInput: boolean };
          if (!s.hadRecentInput) w.__shift += s.value;
        }),
      ).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(c.path, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    const shift = await page.evaluate(() => (window as unknown as { __shift: number }).__shift);
    await context.close();
    console.log(`[font] ${c.path} ${c.width}: ${shift}`);
    expect(shift).toBeLessThanOrEqual(0.002);
  });
}

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
