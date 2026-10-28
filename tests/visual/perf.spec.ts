import { readFileSync } from 'node:fs';
import { test, expect, type Browser } from './pw';

/**
 * A performance budget for the crawl screen, over its two busiest stretches, each played in real
 * time for 12 seconds: the crawl (pages landing about three a second, the map growing and settling
 * in the Worker's layouts) and the crawler tests (several requests a second in the log, verdicts
 * and findings landing).
 *
 * Two passes over each window, because tracing costs frames itself:
 * - Traced: long tasks and layout shifts are read from the Chromium trace (`devtools.timeline`):
 *   `RunTask` events on the page's main thread longer than 50 ms, and `LayoutShift` scores not
 *   caused by input. The trace is kept beside the test results.
 * - Untraced: frame intervals from requestAnimationFrame.
 *
 * Thresholds, and why:
 * - Long tasks over 50 ms: none. One drops three frames at 60 Hz; the per-event work is a reducer
 *   step and a small render, and the layout runs off the main thread.
 * - Layout shift: at most 0.001, which is zero within rounding. Only transform and opacity move,
 *   the fetch log's lines change text in fixed slots, and counters sit in fixed places.
 * - Frames: the 95th percentile interval at most 17.5 ms (60 Hz with 5% scheduling jitter), and
 *   none over 50 ms.
 * The previews run under `next dev`, so on React's development build, which is slower than the
 * production one. The runner is the CI machine, unthrottled.
 */
const WINDOWS = [
  { name: 'the crawl, the map growing', at: 30_000 },
  { name: 'the crawler tests, the log and verdicts landing', at: 72_000 },
];

const BUDGET = { longTasks: 0, layoutShift: 0.001, p95FrameMs: 17.5, maxFrameMs: 50 };
const WINDOW_MS = 12_000;

async function open(browser: Browser, at: number) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`/v2-preview/screens/crawl?at=${at}&play`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[data-v2-replay]')).toHaveAttribute('data-v2-replay', 'playing');
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
  return { long, shift, mainThreads: mains.size };
}

test.describe('crawl screen performance', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  for (const w of WINDOWS) {
    test(`${w.name}: within the budget`, async ({ browser }, testInfo) => {
      // Traced pass: long tasks and layout shift.
      const traced = await open(browser, w.at);
      const tracePath = testInfo.outputPath('trace.json');
      await browser.startTracing(traced.page, {
        path: tracePath,
        categories: ['devtools.timeline'],
      });
      await traced.page.waitForTimeout(WINDOW_MS);
      await browser.stopTracing();
      await traced.context.close();
      const trace = fromTrace(tracePath);

      // Untraced pass: frame intervals.
      const plain = await open(browser, w.at);
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
      await plain.context.close();
      const gaps = stamps
        .slice(1)
        .map((t, i) => t - stamps[i]!)
        .sort((a, b) => a - b);

      const measured = {
        longTasks: trace.long.length,
        longTasksMs: trace.long,
        layoutShift: Number(trace.shift.toFixed(4)),
        frames: gaps.length,
        p95FrameMs: Number((gaps[Math.floor(gaps.length * 0.95)] ?? 0).toFixed(2)),
        maxFrameMs: Number((gaps.at(-1) ?? 0).toFixed(2)),
      };
      await testInfo.attach('measured.json', {
        body: JSON.stringify(measured, null, 2),
        contentType: 'application/json',
      });
      const said = JSON.stringify(measured);
      expect(trace.mainThreads, 'the trace holds the page’s main thread').toBeGreaterThan(0);
      expect(measured.frames, said).toBeGreaterThan(WINDOW_MS / 20);
      expect(measured.longTasks, said).toBeLessThanOrEqual(BUDGET.longTasks);
      expect(measured.layoutShift, said).toBeLessThanOrEqual(BUDGET.layoutShift);
      expect(measured.p95FrameMs, said).toBeLessThanOrEqual(BUDGET.p95FrameMs);
      expect(measured.maxFrameMs, said).toBeLessThanOrEqual(BUDGET.maxFrameMs);
    });
  }
});
