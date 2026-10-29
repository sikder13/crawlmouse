import { readFileSync } from 'node:fs';
import { test, expect, type Browser } from './pw';

/**
 * A performance budget for the crawl screen, over its busiest stretches, each played in real time
 * for 12 seconds: the crawl (pages landing about three a second, the map growing and settling in
 * the Worker's layouts) and the crawler tests (several requests a second in the log, verdicts and
 * findings landing), at 1280px; and on a phone, the crawler tests beginning, scrolled to the log.
 *
 * Two passes over each window, because tracing costs frames itself:
 * - Traced: long tasks and layout shifts are read from the Chromium trace: `RunTask` events on the
 *   page's main thread longer than 50 ms (category `toplevel`), and `LayoutShift` scores not caused
 *   by input (category `loading`). The trace is kept beside the test results. A window whose trace
 *   holds no `RunTask` fails, and a control below plants a long task and a shift and requires the
 *   reading to find both, so neither number can pass by measuring nothing.
 * - Untraced: frame intervals from requestAnimationFrame.
 *
 * Thresholds, and why:
 * - Tasks over 100 ms: none, a stall a reader sees (the line the frame budget draws below). Tasks
 *   over 50 ms, each listed in the window's `[perf]` line: at most 6 in the phone window, at most 2
 *   in the other two. On React's development build (below) the render that applies a new layout to
 *   a map of some 200 pages can take longer than 50 ms, and only the phone window opens as the
 *   crawl's last pages arrive and those layouts land, about once a second through its first
 *   seconds. The other windows read none at the commits named here; at 41b1041 the crawl window
 *   read one (58 ms), with nothing in its work changed, so a cap of 2 there leaves room for a
 *   runner's noise and a third fails. CI runs at 93f6771, af26e9b, 2fb4d3b, 1e8da99 and 6b6e827,
 *   before the two reductions below, read 2, 0, 2, 1 and 4 such tasks in the phone window (51-71
 *   ms); f16fc38, the first with both, read 2 (59 and 60 ms), and d538a56 none. The per-event work
 *   is a reducer step and a render of what changed (the map in memoised groups, the panels memoised
 *   on what they show); the layout runs in a Worker, warm from the last one, so pages move less far
 *   between layouts than they would laid out anew. The two reductions: a move under two screen
 *   pixels is drawn in place, not animated; and those renders do not lay the page out to read it (a
 *   scroll region checks its width at the next frame, and the map takes its scale from a
 *   ResizeObserver, reading it from the page only before the first report).
 * - Layout shift within a window: at most 0.001, zero within rounding. The whole replay, end
 *   included, is measured by motion.spec.ts ("layout shift over a whole replay").
 * - Frames: the 95th percentile interval at most 17.5 ms, that is, fewer than 5% of intervals miss
 *   a vsync at 60 Hz (intervals fall on the 16.7 ms grid, so the reading is about 16.8 or 33.3, and
 *   `missedShare` in the `[perf]` line is the margin behind it); at most 1% of intervals over 34 ms
 *   (two frames at 60 Hz); none over 100 ms, a stall a reader sees. At the seven commits named
 *   above the crawl window, where per-event renders land while the map grows, read 16.7-16.8 except
 *   at f16fc38, 33.3, and nothing in that window's work changed between f16fc38 and d538a56: its
 *   share of missed vsyncs can sit close enough to 5% on a runner to fail without a regression.
 * Each window opens at its moment (`?at=`), with the map laid out cold there, and plays from it.
 * A viewer who has watched from 0:00 has the map the warm layouts built, which move more pages at
 * each layout: these windows understate that work, a known gap of this spec, not measured here.
 * (Playing up to the moment on Playwright's fake clock would close it, but the fake clock also
 * drives requestAnimationFrame, whose intervals are the frame measurement.)
 * The previews run under `next dev`, so on React's development build, which is slower than the
 * production one: the traced pass's longest main-thread tasks are the per-event renders, and in
 * that build one can take longer than a frame. An occasional dropped frame is therefore allowed;
 * a page that drops frames steadily fails the 95th percentile and the 1%. The runner is the CI
 * machine, unthrottled, with this spec alone on it: `VISUAL_PERF=1` and one worker
 * (playwright.config.ts leaves it out otherwise).
 */
const WINDOWS = [
  { name: 'the crawl, the map growing', at: 30_000, width: 1280, height: 900, longTasks: 2 },
  {
    name: 'the crawler tests, the log and verdicts landing',
    at: 72_000,
    width: 1280,
    height: 900,
    longTasks: 2,
  },
  {
    name: 'on a phone, the crawler tests beginning',
    at: 67_000,
    width: 390,
    height: 844,
    longTasks: 6,
    scrollTo: 'Recent fetches',
    // The window must span the start of the crawler tests; the test checks it does.
    spans: 'Fetching a sample of pages as each AI crawler',
  },
];

/** What the trace records: `toplevel` holds `RunTask`, `loading` holds `LayoutShift`. */
const CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'toplevel',
  'loading',
];

const BUDGET = {
  /** A main-thread task longer than this is a stall. */
  stallMs: 100,
  layoutShift: 0.001,
  p95FrameMs: 17.5,
  slowFrameMs: 34,
  slowShare: 0.01,
  maxFrameMs: 100,
};
const WINDOW_MS = 12_000;

async function open(browser: Browser, w: (typeof WINDOWS)[number], play = true) {
  const context = await browser.newContext({ viewport: { width: w.width, height: w.height } });
  const page = await context.newPage();
  await page.goto(`/v2-preview/screens/crawl?at=${w.at}${play ? '&play' : ''}`, {
    waitUntil: 'load',
  });
  await page.evaluate(() => document.fonts.ready);
  // The panel holding that text, not the text itself: a heading's wording changes as it plays.
  if ('scrollTo' in w) {
    await page.locator('[data-v2-overlay]', { hasText: w.scrollTo }).scrollIntoViewIfNeeded();
  }
  if (play) {
    await expect(page.locator('[data-v2-replay]')).toHaveAttribute('data-v2-replay', 'playing');
  }
  await page.waitForTimeout(1_000);
  return { context, page };
}

interface TraceEvent {
  name: string;
  ph: string;
  pid: number;
  tid: number;
  dur?: number;
  args?: { name?: string; data?: { score?: number; had_recent_input?: boolean } };
}

/** Long tasks and layout shift on the page's main thread, read from a trace file. */
function fromTrace(path: string) {
  const events = (JSON.parse(readFileSync(path, 'utf8')) as { traceEvents: TraceEvent[] })
    .traceEvents;
  const mains = new Set(
    events
      .filter((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain')
      .map((e) => `${e.pid}:${e.tid}`),
  );
  const onMain = (e: TraceEvent) => mains.has(`${e.pid}:${e.tid}`);
  const long = events
    .filter((e) => e.name === 'RunTask' && e.ph === 'X' && onMain(e) && (e.dur ?? 0) > 50_000)
    .map((e) => Math.round((e.dur ?? 0) / 1000));
  const shift = events
    .filter((e) => e.name === 'LayoutShift' && !e.args?.data?.had_recent_input)
    .reduce((sum, e) => sum + (e.args?.data?.score ?? 0), 0);
  const tasks = events.filter((e) => e.name === 'RunTask' && onMain(e)).length;
  return { long, shift, tasks, mainThreads: mains.size };
}

test.describe('crawl screen performance', () => {
  // Each window reports on its own: one over budget does not hide the others' numbers.
  test.describe.configure({ timeout: 180_000 });

  test('the trace reading finds a long task and a layout shift planted in the page', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await open(browser, WINDOWS[0]!, false);
    const tracePath = testInfo.outputPath('trace.json');
    await browser.startTracing(page, { path: tracePath, categories: CATEGORIES });
    await page.evaluate(async () => {
      const start = performance.now();
      while (performance.now() - start < 150) {
        // A 150 ms task on the main thread, over the stall line with room to spare.
      }
      await new Promise((r) => setTimeout(r, 100));
      const pad = document.createElement('div');
      pad.style.height = '160px';
      document.querySelector('main')!.prepend(pad);
      await new Promise((r) => setTimeout(r, 500));
    });
    await browser.stopTracing();
    await context.close();
    const trace = fromTrace(tracePath);
    console.log(`[perf] control: ${JSON.stringify(trace)}`);
    expect(trace.long.length).toBeGreaterThanOrEqual(1);
    expect(trace.long.some((ms) => ms > BUDGET.stallMs)).toBe(true);
    expect(trace.shift).toBeGreaterThan(BUDGET.layoutShift);
  });

  for (const w of WINDOWS) {
    test(`${w.name}: within the budget`, async ({ browser }, testInfo) => {
      // Traced pass: long tasks and layout shift.
      const traced = await open(browser, w);
      const tracePath = testInfo.outputPath('trace.json');
      await browser.startTracing(traced.page, { path: tracePath, categories: CATEGORIES });
      await traced.page.waitForTimeout(WINDOW_MS);
      await browser.stopTracing();
      await traced.context.close();
      const trace = fromTrace(tracePath);

      // Untraced pass: frame intervals.
      const plain = await open(browser, w);
      const stepState = () =>
        plain.page
          .getByRole('listitem')
          .filter({ hasText: 'sample of pages as each AI crawler' })
          .locator('span')
          .first()
          .textContent();
      const before = 'spans' in w ? await stepState() : null;
      const stamps = await plain.page.evaluate(
        (ms) =>
          new Promise<number[]>((resolve) => {
            const out: number[] = [];
            const start = performance.now();
            const tick = (t: number) => {
              out.push(t);
              if (t - start < ms) requestAnimationFrame(tick);
              else resolve(out);
            };
            requestAnimationFrame(tick);
          }),
        WINDOW_MS,
      );
      const after = 'spans' in w ? await stepState() : null;
      await plain.context.close();
      if ('spans' in w) {
        expect(before?.trim(), `${w.spans} is still to come as the window opens`).toBe('next');
        expect(after?.trim(), `${w.spans} has started by the window's end`).not.toBe('next');
      }
      const gaps = stamps
        .slice(1)
        .map((t, i) => t - stamps[i]!)
        .sort((a, b) => a - b);

      const measured = {
        tasks: trace.tasks,
        longTasks: trace.long.length,
        longTasksMs: trace.long,
        layoutShift: Number(trace.shift.toFixed(4)),
        frames: gaps.length,
        p95FrameMs: Number((gaps[Math.floor(gaps.length * 0.95)] ?? 0).toFixed(2)),
        // Intervals fall on the display's 16.7 ms grid, so the 95th percentile reads about 16.8 or
        // 33.3; this share is the margin behind it.
        missedShare: Number(
          (gaps.filter((g) => g > BUDGET.p95FrameMs).length / gaps.length).toFixed(4),
        ),
        slowFrames: gaps.filter((g) => g > BUDGET.slowFrameMs).length,
        maxFrameMs: Number((gaps.at(-1) ?? 0).toFixed(2)),
      };
      await testInfo.attach('measured.json', {
        body: JSON.stringify(measured, null, 2),
        contentType: 'application/json',
      });
      const said = JSON.stringify(measured);
      // Printed as well as attached, so a passing run's numbers are in the CI log.
      console.log(`[perf] ${w.name}: ${said}`);
      expect(trace.mainThreads, 'the trace holds the page’s main thread').toBeGreaterThan(0);
      expect(trace.tasks, 'the trace holds the main thread’s tasks').toBeGreaterThan(0);
      expect(measured.frames, said).toBeGreaterThan(WINDOW_MS / 20);
      expect(
        measured.longTasksMs.filter((ms) => ms > BUDGET.stallMs),
        `${said}: tasks over ${BUDGET.stallMs} ms`,
      ).toEqual([]);
      expect(measured.longTasks, `${said}: tasks over 50 ms`).toBeLessThanOrEqual(w.longTasks);
      expect(measured.layoutShift, said).toBeLessThanOrEqual(BUDGET.layoutShift);
      expect(measured.p95FrameMs, said).toBeLessThanOrEqual(BUDGET.p95FrameMs);
      expect(measured.slowFrames, said).toBeLessThanOrEqual(gaps.length * BUDGET.slowShare);
      expect(measured.maxFrameMs, said).toBeLessThanOrEqual(BUDGET.maxFrameMs);
    });
  }
});
