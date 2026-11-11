import { readFileSync } from 'node:fs';
import { busyPerSlice, quantile } from '../../packages/timing/src/busy';
import { recordSample } from '../../packages/timing/src/samples';
import { fmt, median } from '../../packages/timing/src/stats';
import { ADVISORY, BUDGET, EXPLORER, RUNS, WINDOW_MS } from './budgets';
import { test, expect, type Browser, type Page, type TestInfo } from './pw';

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
 *   in the other two. The caps were set on React's development build, where the spec ran until
 *   CC-24 and where the render that applies a new layout to a map of some 200 pages could take
 *   longer than 50 ms. On the production build the caps stand as a ceiling; each window's `[perf]`
 *   line lists the tasks it read. The phone window opens as the
 *   crawl's last pages arrive and those layouts land, about once a second through its first
 *   seconds: four or five land inside its traced 12 seconds, by the reviews' probes of the map's
 *   layouts, so a cap of 6 allows about one long task a layout. The other windows read none at the
 *   commits named here; at 41b1041 the crawl window read one (58 ms), with nothing in its work
 *   changed, so a cap of 2 there leaves room for a runner's noise and a third fails. CI runs at
 *   93f6771, af26e9b, 2fb4d3b, 1e8da99 and 6b6e827, before the two reductions below, read 2, 0, 2,
 *   1 and 4 such tasks in the phone window (51-71 ms); f16fc38, the first with both, read 2 (59 and
 *   60 ms), d538a56 none and 41b1041 2 (57 and 56 ms). The per-event work is a reducer step and a
 *   render of what changed (the map in memoised groups, the panels memoised on what they show); the
 *   layout runs in a Worker, warm from the last one, so pages move less far between layouts than
 *   they would laid out anew. The two reductions: a move under two screen pixels is drawn in place,
 *   not animated; and those renders do not lay the page out to read it (a scroll region checks its
 *   width at the next frame, and the map takes its scale from a ResizeObserver, reading it from the
 *   page only before the first report).
 * - Layout shift within a window: at most 0.001, zero within rounding. The whole replay, end
 *   included, is measured by motion.spec.ts ("layout shift over a whole replay").
 * - Work per frame: the main thread's busy time in each 16.7 ms slice of the traced window (one
 *   60 Hz frame; packages/timing/src/busy.ts). Its mean is at most BUDGET.meanWorkMs, and its 95th
 *   percentile, the bursts, at most BUDGET.p95WorkMs. The slices are fixed in time, so the reading
 *   is what the page did, whatever refresh rate the runner manages. The mean is the one judged
 *   closely: a map rendered and animated twice moved it by about a third, 2.195 to 2.93 ms (the
 *   map is part of the page's work), and the 95th percentile less, 5.61 to 7.5 ms (ci-cost.md, D3).
 *   Work off the main
 *   thread (the map's layouts in their Worker, raster) is not in it. Until CC-COST the budget was
 *   the 95th percentile interval between frames, at most 17.5 ms: a runner that dropped to 30 fps
 *   read 33.3 ms in all five runs with nothing in the page changed, and failed (the run of
 *   b23d4ca6), so the budget measured the machine. docs/specs/v2/ci-cost.md, D3, has the
 *   measurements behind the limit.
 * - Frames: none over 100 ms, a stall a reader sees, at any refresh rate. The 95th percentile
 *   interval and the share over 34 ms are printed and recorded for the nightly trend, not judged:
 *   both move with the refresh rate.
 * - Median of five: a window is measured five times and each budget is judged on the median of its
 *   five readings, the rule docs/ops/ci-timing.md sets for every timing check. Each run's numbers
 *   and the medians are printed, and with PERF_SAMPLES_DIR set the samples are written there for
 *   the nightly trend. What says a run measured anything at all (a main thread and its tasks in the
 *   trace, enough frames, the window spanning its moment) must hold on every run. The visual job
 *   retries a run of this spec once when every failure in it was a budget miss
 *   (packages/timing/scripts/perf-retry.sh).
 * Each window opens at its moment (`?at=`), with the map laid out cold there, and plays from it.
 * A viewer who has watched from 0:00 has the map the warm layouts built, which move more pages at
 * each layout: these windows understate that work, a known gap of this spec, not measured here.
 * (Playing up to the moment on Playwright's fake clock would close it, but the fake clock also
 * drives requestAnimationFrame, whose intervals are the frame measurement.)
 * The previews run on the production build: `next build`, then `next start` with the previews
 * opened by V2_PREVIEW_ON_NEXT_START=1 (VISUAL_SERVER=start; playwright.config.ts). The runner is
 * the CI machine, unthrottled, with this spec alone on it: `VISUAL_PERF=1` and one worker
 * (playwright.config.ts leaves it out otherwise).
 *
 * The explorer has its own window: the 2,000-node map on its canvas at 1280px, for 2 seconds in
 * which the selection walks down the page list a step every 100 ms, so each step redraws the
 * canvas and the list. No frame may take over 50 ms: no main-thread task over 50 ms in the trace,
 * and no interval over 50 ms in the untraced pass.
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

/**
 * The prefix of the assertions that say a run measured nothing, as opposed to a budget missed. On a
 * slow runner packages/timing/scripts/perf-retry.sh excuses only the budget assertion's own error
 * (`medians of ${RUNS} runs`), so it does not excuse these.
 */
const INVALID = 'MEASUREMENT INVALID';

/**
 * The fewest frames a second an untraced pass must draw to count as having measured anything: a
 * runner at 30 fps measures as well as one at 60. (It was 50 until CC-COST, which a runner that
 * dropped to 30 fps failed as invalid with the page unchanged.)
 */
const MIN_FPS = 20;

/** What the trace records: `toplevel` holds `RunTask`, `loading` holds `LayoutShift`. */
const CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'toplevel',
  'loading',
];

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
  ts?: number;
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
  const run = events.filter((e) => e.name === 'RunTask' && e.ph === 'X' && onMain(e));
  const tasks = events.filter((e) => e.name === 'RunTask' && onMain(e)).length;
  // The window is the span the main thread's tasks cover.
  // (A reduce, not Math.min(...): a trace holds tens of thousands of tasks.)
  const from = run.reduce((m, e) => Math.min(m, e.ts ?? Infinity), Infinity);
  const to = run.reduce((m, e) => Math.max(m, (e.ts ?? 0) + (e.dur ?? 0)), -Infinity);
  const busy = run.length
    ? busyPerSlice(
        run.map((e) => ({ ts: e.ts ?? 0, dur: e.dur ?? 0 })),
        from,
        to,
      )
    : [];
  return { long, shift, tasks, mainThreads: mains.size, busy };
}

test.describe('crawl screen performance', () => {
  // Each window reports on its own: one over budget does not hide the others' numbers. The timeout
  // grows with RUNS: a crawl window's run took about 31 s on CI (five took 154.8 s in run
  // 41754514564), so 60 s a run leaves the same room at any run count.
  test.describe.configure({ timeout: RUNS * 60_000 });

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
    console.log(`[perf] control: ${JSON.stringify({ ...trace, busy: undefined })}`);
    expect(trace.long.length).toBeGreaterThanOrEqual(1);
    expect(trace.long.some((ms) => ms > BUDGET.stallMs)).toBe(true);
    expect(trace.shift).toBeGreaterThan(BUDGET.layoutShift);
  });

  for (const w of WINDOWS) {
    test(`${w.name}: within the budget`, async ({ browser }, testInfo) => {
      const runs = [];
      for (let i = 0; i < RUNS; i++) {
        const run = await measure(browser, w, testInfo, i);
        console.log(`[perf] ${w.name}, run ${i + 1}: ${JSON.stringify(run.measured)}`);
        runs.push(run);
      }
      await testInfo.attach('measured.json', {
        body: JSON.stringify(
          runs.map((r) => r.measured),
          null,
          2,
        ),
        contentType: 'application/json',
      });
      const missed = judge(
        w.name,
        runs.map((r) => r.measured),
        [
          { metric: 'longestTaskMs', unit: 'ms', limit: BUDGET.stallMs },
          { metric: 'longTasks', unit: 'tasks', limit: w.longTasks },
          { metric: 'layoutShift', unit: 'score', limit: BUDGET.layoutShift },
          { metric: 'meanWorkMs', unit: 'ms', limit: BUDGET.meanWorkMs },
          { metric: 'p95WorkMs', unit: 'ms', limit: BUDGET.p95WorkMs },
          { metric: 'maxFrameMs', unit: 'ms', limit: BUDGET.maxFrameMs },
          { metric: 'p95FrameMs', unit: 'ms', limit: ADVISORY.p95FrameMs, advisory: true },
          { metric: 'slowShare', unit: 'share', limit: ADVISORY.slowShare, advisory: true },
        ],
      );
      expect(
        runs.flatMap((r) => r.broken),
        INVALID,
      ).toEqual([]);
      if ('spans' in w) {
        for (const r of runs) {
          expect(
            r.before?.trim(),
            `${INVALID}: ${w.spans} is still to come as the window opens`,
          ).toBe('next');
          expect(
            r.after?.trim(),
            `${INVALID}: ${w.spans} has started by the window's end`,
          ).not.toBe('next');
        }
      }
      expect(missed, `medians of ${RUNS} runs`).toEqual([]);
    });
  }

  test('the explorer, 2,000 pages on the canvas: within the budget, no frame over 50 ms as the selection moves', async ({
    browser,
  }, testInfo) => {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const run = await measureExplorer(browser, testInfo, i);
      console.log(`[perf] the explorer, run ${i + 1}: ${JSON.stringify(run.measured)}`);
      runs.push(run);
    }
    const missed = judge(
      'the explorer',
      runs.map((r) => r.measured),
      [
        { metric: 'longestTaskMs', unit: 'ms', limit: EXPLORER.frameMs },
        { metric: 'maxFrameMs', unit: 'ms', limit: EXPLORER.frameMs },
      ],
    );
    expect(
      runs.flatMap((r) => r.broken),
      INVALID,
    ).toEqual([]);
    expect(missed, `medians of ${RUNS} runs`).toEqual([]);
  });
});

/**
 * A budget judged on the median of a metric across the runs: at most `limit`. An advisory one is
 * printed and recorded with its limit, and never fails the test.
 */
interface Budgeted {
  metric: string;
  unit: string;
  limit: number;
  advisory?: boolean;
}

/**
 * The budgets the medians miss. Prints the medians, and records each metric's samples to
 * PERF_SAMPLES_DIR when it is set.
 */
function judge(name: string, rows: Record<string, unknown>[], budgets: Budgeted[]): string[] {
  const medians: Record<string, number> = {};
  const missed: string[] = [];
  for (const b of budgets) {
    const samples = rows.map((row) => Number(row[b.metric]));
    const mid = median(samples);
    medians[b.metric] = Number(mid.toFixed(4));
    const pass = mid <= b.limit;
    recordSample(process.env.PERF_SAMPLES_DIR, {
      metric: `${name}: ${b.metric}`,
      unit: b.unit,
      median: mid,
      limit: b.limit,
      pass,
      ...(b.advisory ? { advisory: true } : {}),
      samples,
    });
    if (!pass && !b.advisory) {
      missed.push(
        `${b.metric}: median ${fmt(mid)} > ${fmt(b.limit)} (runs ${samples.map(fmt).join(', ')})`,
      );
    }
  }
  console.log(`[perf] ${name}, median of ${rows.length}: ${JSON.stringify(medians)}`);
  return missed;
}

async function openExplorer(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(EXPLORER.path, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('canvas[data-v2-renderer]')).toHaveCount(1);
  await page.getByRole('listbox').focus();
  await page.waitForTimeout(1_000);
  return { context, page };
}

/** Where the selection is in the page list, by the index its option's id carries. */
async function step(page: Page): Promise<number> {
  const id = await page.getByRole('listbox').getAttribute('aria-activedescendant');
  return Number(id?.replace('v2-map-option-', '') ?? NaN);
}

/**
 * Step the selection down the list for the window, one ArrowDown every stepMs, on a fixed grid
 * from the window's start: each press waits only for what is left of its step, so the time a
 * press itself takes does not stretch the steps apart.
 */
async function walk(page: Page) {
  const start = Date.now();
  for (let k = 1; Date.now() - start < EXPLORER.ms; k++) {
    await page.keyboard.press('ArrowDown');
    const left = start + k * EXPLORER.stepMs - Date.now();
    if (left > 0) await page.waitForTimeout(left);
  }
}

async function measureExplorer(browser: Browser, testInfo: TestInfo, run: number) {
  const traced = await openExplorer(browser);
  const tracePath = testInfo.outputPath(`explorer-trace-${run + 1}.json`);
  await browser.startTracing(traced.page, { path: tracePath, categories: CATEGORIES });
  const first = await step(traced.page);
  await walk(traced.page);
  const last = await step(traced.page);
  await browser.stopTracing();
  await traced.context.close();
  const trace = fromTrace(tracePath);

  const plain = await openExplorer(browser);
  const stamps = plain.page.evaluate(
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
    EXPLORER.ms,
  );
  const plainFirst = await step(plain.page);
  await walk(plain.page);
  const times = await stamps;
  const plainLast = await step(plain.page);
  await plain.context.close();
  const gaps = times.slice(1).map((t, i) => t - times[i]!);
  const measured = {
    // How far the selection walked in each pass: the window measures nothing if it did not.
    moved: [last - first, plainLast - plainFirst],
    tasks: trace.tasks,
    longTasksMs: trace.long,
    longestTaskMs: Math.max(0, ...trace.long),
    frames: gaps.length,
    maxFrameMs: Number(Math.max(0, ...gaps).toFixed(2)),
  };
  // What says this run measured anything; it must hold on every run.
  const broken = [
    measured.moved.every((n) => n >= EXPLORER.minSteps)
      ? null
      : `run ${run + 1}: the selection moved ${measured.moved.join(' and ')} steps, not ${EXPLORER.minSteps}`,
    trace.tasks > 0 ? null : `run ${run + 1}: the trace holds no main-thread task`,
    measured.frames > (EXPLORER.ms / 1000) * MIN_FPS
      ? null
      : `run ${run + 1}: only ${measured.frames} frames`,
  ].filter((x): x is string => x !== null);
  return { measured, broken };
}

/** One traced and one untraced pass over a window, and what says the run measured nothing. */
async function measure(
  browser: Browser,
  w: (typeof WINDOWS)[number],
  testInfo: TestInfo,
  run: number,
) {
  // Traced pass: long tasks and layout shift.
  const traced = await open(browser, w);
  const tracePath = testInfo.outputPath(`trace-${run + 1}.json`);
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
  const gaps = stamps
    .slice(1)
    .map((t, i) => t - stamps[i]!)
    .sort((a, b) => a - b);

  const measured = {
    tasks: trace.tasks,
    workMs: Math.round(trace.busy.reduce((a, b) => a + b, 0)),
    meanWorkMs: trace.busy.length
      ? Number((trace.busy.reduce((a, b) => a + b, 0) / trace.busy.length).toFixed(3))
      : 0,
    p95WorkMs: trace.busy.length ? Number(quantile(trace.busy, 0.95).toFixed(2)) : 0,
    longTasks: trace.long.length,
    longTasksMs: trace.long,
    longestTaskMs: Math.max(0, ...trace.long),
    layoutShift: Number(trace.shift.toFixed(4)),
    frames: gaps.length,
    p95FrameMs: Number((gaps[Math.floor(gaps.length * 0.95)] ?? 0).toFixed(2)),
    // Intervals fall on the display's 16.7 ms grid, so the 95th percentile reads about 16.8 or
    // 33.3; this share is the margin behind it.
    missedShare: Number(
      (gaps.filter((g) => g > ADVISORY.p95FrameMs).length / gaps.length).toFixed(4),
    ),
    slowFrames: gaps.filter((g) => g > ADVISORY.slowFrameMs).length,
    slowShare: gaps.filter((g) => g > ADVISORY.slowFrameMs).length / gaps.length,
    maxFrameMs: Number((gaps.at(-1) ?? 0).toFixed(2)),
  };
  // What says this run measured anything; it must hold on every run.
  const broken = [
    // The busy time sums every renderer main thread into one set of slices: two would count twice.
    trace.mainThreads === 1
      ? null
      : `run ${run + 1}: the trace holds ${trace.mainThreads} renderer main threads, not 1`,
    trace.tasks > 0 ? null : `run ${run + 1}: the trace holds no main-thread task`,
    measured.frames > (WINDOW_MS / 1000) * MIN_FPS
      ? null
      : `run ${run + 1}: only ${measured.frames} frames`,
  ].filter((x): x is string => x !== null);
  return { measured, broken, before, after };
}

/**
 * The account screens (CC-26): static pages, so the budget is what follows the load: the fonts and
 * one scroll to the foot. Long tasks are judged from the load event on, and layout shift over the
 * whole trace, each on the median of RUNS runs against BUDGET (blocking). Frame intervals over the
 * scroll, and the longest task while the page loads, are printed and attached, not judged.
 * Why the load is not judged: on the production build every preview has one task of about 90 to
 * 190 ms while it parses and hydrates the bundle they share. A control on 6 Nov 2026 (`fcfc8175`,
 * five loads each, 1280px) read medians of 126 ms on the Button primitive's page, 121 ms on Result
 * and 161 ms on Crawler access, beside 173 ms on the dashboard and 97 ms on the site page; after the
 * load event no page read a task over 10 ms. The load task is the shared bundle's, not a screen's.
 */
const ACCOUNT_SCREENS = [
  '/v2-preview/screens/dashboard/day0',
  '/v2-preview/screens/dashboard',
  '/v2-preview/screens/dashboard/clean',
  '/v2-preview/screens/dashboard/withheld',
  '/v2-preview/screens/site',
  '/v2-preview/screens/site/clean',
  '/v2-preview/screens/site/withheld',
] as const;

async function loadAndScroll(browser: Browser, path: string, width: number, tracePath: string) {
  const context = await browser.newContext({
    viewport: { width, height: width < 600 ? 844 : 900 },
  });
  const page = await context.newPage();
  await browser.startTracing(page, { path: tracePath, categories: CATEGORIES });
  await page.goto(path, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const frames = await page.evaluate(async () => {
    const gaps: number[] = [];
    let last = performance.now();
    const end = last + 1500;
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    await new Promise<void>((done) => {
      const tick = (t: number) => {
        gaps.push(t - last);
        last = t;
        if (t < end) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    return gaps;
  });
  await browser.stopTracing();
  await context.close();
  return { trace: fromTrace(tracePath), afterLoad: afterLoad(tracePath), frames };
}

/** The longest main-thread task that starts after the load event, and whether the trace holds one. */
function afterLoad(path: string) {
  const events = (
    JSON.parse(readFileSync(path, 'utf8')) as { traceEvents: (TraceEvent & { ts?: number })[] }
  ).traceEvents;
  const mains = new Set(
    events
      .filter((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain')
      .map((e) => `${e.pid}:${e.tid}`),
  );
  const load = events.find((e) => e.name === 'MarkLoad')?.ts;
  const after = events.filter(
    (e) =>
      e.name === 'RunTask' &&
      e.ph === 'X' &&
      mains.has(`${e.pid}:${e.tid}`) &&
      load !== undefined &&
      (e.ts ?? 0) >= load,
  );
  return {
    loaded: load !== undefined,
    tasks: after.length,
    longestMs: Math.round(Math.max(0, ...after.map((e) => e.dur ?? 0)) / 1000),
  };
}

test.describe('account screens performance', () => {
  test.describe.configure({ timeout: RUNS * 30_000 });

  for (const path of ACCOUNT_SCREENS) {
    for (const width of [1280, 390]) {
      test(`${path} at ${width}px: no stall and no layout shift`, async ({ browser }, testInfo) => {
        const runs = [];
        for (let i = 0; i < RUNS; i++) {
          runs.push(
            await loadAndScroll(browser, path, width, testInfo.outputPath(`trace-${i}.json`)),
          );
        }
        for (const r of runs) {
          expect(r.trace.mainThreads, `${INVALID}: no main thread in the trace`).toBeGreaterThan(0);
          expect(r.afterLoad.loaded, `${INVALID}: no load event in the trace`).toBe(true);
          expect(r.afterLoad.tasks, `${INVALID}: no task after the load`).toBeGreaterThan(0);
          expect(r.frames.length, `${INVALID}: too few frames`).toBeGreaterThan(20);
        }
        const longest = median(runs.map((r) => r.afterLoad.longestMs));
        const loading = median(runs.map((r) => Math.max(0, ...r.trace.long)));
        const shift = median(runs.map((r) => r.trace.shift));
        const sorted = runs.map((r) => [...r.frames].sort((a, b) => a - b));
        const p95 = median(sorted.map((g) => g[Math.floor(g.length * 0.95)] ?? 0));
        console.log(
          `[perf] ${path} ${width}px: longest task after load ${fmt(longest)} ms, shift ${fmt(shift)}; advisory: longest while loading ${fmt(loading)} ms, p95 frame ${fmt(p95)} ms`,
        );
        testInfo.annotations.push({ type: 'advisory', description: `p95 frame ${fmt(p95)} ms` });
        expect(longest, `median longest task after the load, of ${RUNS} runs`).toBeLessThanOrEqual(
          BUDGET.stallMs,
        );
        expect(shift, `median layout shift of ${RUNS} runs`).toBeLessThanOrEqual(
          BUDGET.layoutShift,
        );
      });
    }
  }
});
