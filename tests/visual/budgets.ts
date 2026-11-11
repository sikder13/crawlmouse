/**
 * The performance budgets perf.spec.ts holds the previews to, as data, so SPEC 24 renders them
 * from the numbers the test uses. perf.spec.ts's header says why each is what it is.
 */
export const BUDGET = {
  /** A main-thread task longer than this is a stall. */
  stallMs: 100,
  layoutShift: 0.001,
  /** The 95th percentile of the main thread's busy time per 16.7 ms slice: the bursts. */
  p95WorkMs: 10,
  /** A frame interval longer than this is a stall, at any refresh rate. */
  maxFrameMs: 100,
};

/**
 * Frame-interval readings printed and recorded for the nightly trend, not judged: they move with
 * the refresh rate the runner manages (docs/specs/v2/ci-cost.md, D3).
 */
export const ADVISORY = {
  p95FrameMs: 17.5,
  slowFrameMs: 34,
  slowShare: 0.01,
};

/**
 * The main thread's mean busy time per 16.7 ms slice, per crawl-screen window: each window does its
 * own amount of work, as its long-task cap already says. Set from the readings in
 * docs/specs/v2/ci-cost.md, D3.
 */
export const MEAN_WORK_MS: Record<string, number> = {
  'the crawl, the map growing': 2.5,
  'the crawler tests, the log and verdicts landing': 0.9,
  'on a phone, the crawler tests beginning': 3.2,
};

/** How long each crawl-screen window plays. */
export const WINDOW_MS = 12_000;

/** How many times each window is measured; each budget is judged on the median of the runs. */
export const RUNS = 5;

/** The explorer window: the 2,000-node map, the selection stepping every 100 ms for 2 s. */
export const EXPLORER = {
  path: '/v2-preview/screens/map/large',
  ms: 2_000,
  stepMs: 100,
  frameMs: 50,
  /** Steps the selection must take in each pass: the window holds about 20. */
  minSteps: 15,
};
