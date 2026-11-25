/**
 * Row 17's full render: its time bounds and event ids, apart from inngest/full-render.ts so the check
 * function can read them without loading the engine.
 */

/** The longest a full render runs, wall time: a chunk starts only while a chunk step's time is left. */
export const FULL_RENDER_WALL_S = 1800;

/** The most one chunk step renders for: its deadline, inside the route's 300 s maxDuration. */
export const FULL_RENDER_STEP_S = 240;

/**
 * How long the check's run waits for the full render's end: its wall time, its last step and its merge.
 * The check's finish timeout (PACE.finishS) holds this beside its own plan.
 */
export const FULL_RENDER_WAIT_S = FULL_RENDER_WALL_S + 360;

/** One request per check: Inngest keeps an event id 24 hours. */
export const fullRenderRequestedEventId = (checkId: string): string =>
  `check-render-full:${checkId}`;
export const fullRenderDoneEventId = (checkId: string): string =>
  `check-render-full-done:${checkId}`;
