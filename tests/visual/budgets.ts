/**
 * The performance budgets perf.spec.ts holds the previews to, as data, so SPEC 24 renders them
 * from the numbers the test uses. perf.spec.ts's header says why each is what it is.
 */
export const BUDGET = {
  /** A main-thread task longer than this is a stall. */
  stallMs: 100,
  layoutShift: 0.001,
  p95FrameMs: 17.5,
  slowFrameMs: 34,
  slowShare: 0.01,
  maxFrameMs: 100,
};

/** How long each crawl-screen window plays. */
export const WINDOW_MS = 12_000;

/** How many runs a window may take to meet its budget; it is judged on the best. */
export const RUNS = 3;

/** The explorer window: the 2,000-node map, the selection stepping every 100 ms for 2 s. */
export const EXPLORER = {
  path: '/v2-preview/screens/map/large',
  ms: 2_000,
  stepMs: 100,
  frameMs: 50,
  /** Steps the selection must take in each pass: the window holds about 20. */
  minSteps: 15,
};
