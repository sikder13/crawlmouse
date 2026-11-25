/**
 * Row 17's full render, `crawlmouse.check.render-full`: every page a check read, rendered, not the
 * sample. The check function asks for it (`check.render-full.requested`) once the check has taken
 * one of its account's full renders, and waits for `check.render-full.done` before it builds.
 *
 * ITS OWN FUNCTION, because one cannot fit the check's run: a 2,000-page check's time plan uses the
 * check's whole finish timeout, and 80 chunk steps would not fit beside its worst-case steps under
 * Inngest's 1,000 a run.
 *
 * THE STEPS. `plan` writes the pages to render; each `chunk-k` renders FULL_RENDER_CHUNK_PAGES of
 * them under what the budget has left; `merge` writes the check's full render outcome; `done` tells
 * the check. Chunks start while:
 *   - the budget has room for one page's two renders (FULL_RENDER_PAGE_RESERVE_MS), else the rest are
 *     `check_cap`: FULL_RENDER_MAX_BROWSER_MS of browser time, whatever a request costs;
 *   - the function's wall time has a chunk step's time left, else the rest are `out_of_time`.
 * The browser time a chunk counted is its step's output, so a replay counts the same.
 */
import {
  FULL_RENDER_CHUNK_PAGES,
  FULL_RENDER_MAX_BROWSER_MS,
  FULL_RENDER_PAGE_RESERVE_MS,
} from '@crawlmouse/engine/v2/pipeline';
import { inngest } from './client';
import type { CheckRequested } from './check-events';
import { FULL_RENDER_STEP_S, FULL_RENDER_WALL_S, fullRenderDoneEventId } from './full-render-time';

export {
  FULL_RENDER_STEP_S,
  FULL_RENDER_WAIT_S,
  FULL_RENDER_WALL_S,
  fullRenderDoneEventId,
  fullRenderRequestedEventId,
} from './full-render-time';

export const FULL_RENDER_FN_ID = 'crawlmouse.check.render-full';

export type NotReached = 'check_cap' | 'out_of_time';

export interface FullRenderSteps {
  /** Plans the pages and stores the plan; `at` is the step's time, the wall clock's zero. */
  plan(event: CheckRequested): Promise<{ pages: number; at: number }>;
  /** Renders chunk `index` under `leftMs` of browser time, until `deadlineAt`. */
  chunk(
    event: CheckRequested,
    index: number,
    leftMs: number,
    deadlineAt: number,
  ): Promise<{ browser_ms: number; at: number }>;
  /** Writes the full render outcome, naming every page not reached with `notReached`. */
  merge(event: CheckRequested, notReached: NotReached): Promise<{ merged: boolean }>;
}

export interface FullRenderStepTools {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  sendEvent(
    id: string,
    payload: {
      id: string;
      name: 'check.render-full.done';
      data: { checkId: string; merged: boolean };
    },
  ): Promise<unknown>;
}

export async function runFullRender(
  ctx: { event: { data: CheckRequested }; step: FullRenderStepTools },
  steps: FullRenderSteps,
  maxBrowserMs: number = FULL_RENDER_MAX_BROWSER_MS,
): Promise<{ merged: boolean; chunks: number; spent_ms: number; stopped: NotReached | null }> {
  const event = ctx.event.data;
  const { step } = ctx;
  const plan = await step.run('plan', () => steps.plan(event));
  const wallEndsAt = plan.at + FULL_RENDER_WALL_S * 1000;
  let spent = 0;
  let at = plan.at;
  let stopped: NotReached | null = null;
  let k = 0;
  for (; k * FULL_RENDER_CHUNK_PAGES < plan.pages; k++) {
    if (maxBrowserMs - spent < FULL_RENDER_PAGE_RESERVE_MS) {
      stopped = 'check_cap';
      break;
    }
    if (wallEndsAt - at < FULL_RENDER_STEP_S * 1000) {
      stopped = 'out_of_time';
      break;
    }
    const left = maxBrowserMs - spent;
    const deadline = Math.min(at + FULL_RENDER_STEP_S * 1000, wallEndsAt);
    const c = await step.run(`chunk-${k}`, () => steps.chunk(event, k, left, deadline));
    spent += c.browser_ms;
    at = c.at;
  }
  const merged = await step.run('merge', () => steps.merge(event, stopped ?? 'check_cap'));
  await step.sendEvent('done', {
    id: fullRenderDoneEventId(event.checkId),
    name: 'check.render-full.done',
    data: { checkId: event.checkId, merged: merged.merged },
  });
  return { merged: merged.merged, chunks: k, spent_ms: spent, stopped };
}

/**
 * The function. One full render per account at a time, two at once overall, so Browser Run's 30
 * requests a second hold with each render's in-flight limit. A cancelled check cancels it. When it
 * fails, its failure handler gives the month's use back and tells the check at once, so the check
 * builds from its sample without waiting out FULL_RENDER_WAIT_S.
 */
export function createFullRenderFn(
  steps: () => FullRenderSteps,
  giveBack: (event: CheckRequested) => Promise<void>,
) {
  return inngest.createFunction(
    {
      id: FULL_RENDER_FN_ID,
      concurrency: [{ key: 'event.data.accountId', limit: 1 }, { limit: 2 }],
      timeouts: { finish: `${FULL_RENDER_WALL_S + 300}s` },
      retries: 2,
      cancelOn: [{ event: 'check.cancel.requested', match: 'data.checkId' }],
      onFailure: async ({ event, step }) => {
        const requested = event.data.event.data as CheckRequested;
        await step.run('give-back', () => giveBack(requested));
        await step.sendEvent('done', {
          id: fullRenderDoneEventId(requested.checkId),
          name: 'check.render-full.done',
          data: { checkId: requested.checkId, merged: false },
        });
      },
    },
    { event: 'check.render-full.requested' },
    ({ event, step }) =>
      runFullRender(
        {
          event,
          step: {
            run: <T>(id: string, fn: () => Promise<T>) => step.run(id, fn) as Promise<T>,
            sendEvent: (id, payload) => step.sendEvent(id, payload),
          },
        },
        steps(),
      ),
  );
}
