/**
 * Row 17's full render, the step bodies (inngest/full-render.ts orchestrates them).
 *
 * `takeFullRender` (called by the render step, after the sample is stored) grants one only when every
 * condition holds:
 *   - the check belongs to an account;
 *   - `rendering` is not hidden (V2_HIDE_FEATURES, Goal 1 rule 2), so no grade differs by plan while
 *     the row is unproven;
 *   - rendering is configured: Browser Run's client, and both caps above zero;
 *   - the account's plan has full renders (`GATES[tier].fullRendersPerMonth`), and one of this
 *     month's was taken for the check (`take_full_render`).
 *
 * `plan` stores, in `render-full-progress`, the pages a full render renders (render/full.ts), each one's
 * candidate, and the previous check's page states. Each `chunk` reads it, renders its pages under the
 * browser time the full render has left, adds them to it, and writes the check's heartbeat with the
 * check's own progress, so the reaper sees the run alive. `merge` writes `render-full`, every planned
 * page in it, and gives the month's use back when the full render rendered no page.
 */
import {
  FULL_RENDER_CHUNK_PAGES,
  fullRenderCandidates,
  fullRenderPlan,
  mergeFullRender,
  renderCheck,
  type JsTextState,
  type RenderOutcome,
} from '@crawlmouse/engine/v2/pipeline';
import type { CheckRequested } from '../../../../../../inngest/check-events';
import type { FullRenderSteps, NotReached } from '../../../../../../inngest/full-render';
import { GATES } from '../../../entitlement-v2';
import { getJson, putJson } from '../evidence';
import type { StepDeps } from './deps';
import { assembledSoFar, iso, loadResultsForBuild, loadSeeds, pathOf } from './stored';

type Candidate = ReturnType<typeof fullRenderCandidates>[number];

interface Progress {
  plan: ReturnType<typeof fullRenderPlan>;
  candidates: Candidate[];
  states: [string, JsTextState][];
  /** The pages rendered so far, every chunk's, as one outcome without the sample. */
  done: Pick<RenderOutcome, 'pages' | 'browser_ms' | 'settle_failed'>;
}

const NOTHING: Progress['done'] = { pages: [], browser_ms: 0, settle_failed: false };

/** Whether the check gets a full render: see the conditions above. Takes the month's use when it does. */
export async function takeFullRender(deps: StepDeps, event: CheckRequested): Promise<boolean> {
  if (event.accountId === null) return false;
  const { client, caps } = deps.render;
  if (client === null || caps.perCheckMs <= 0 || caps.perDayMs <= 0) return false;
  const tier = await deps.store.planOf(event.accountId, deps.now());
  const limit = GATES[tier].fullRendersPerMonth;
  if (limit <= 0) return false;
  // Imported here, not at the top: the switch is server-only, and the step bodies load in tests.
  const { hiddenFeatures } = await import('../../../feature-switch');
  if (hiddenFeatures(deps.env).hidden.has('rendering')) return false;
  return deps.store.takeFullRender(event.accountId, event.checkId, limit);
}

const readProgress = async (deps: StepDeps, event: CheckRequested): Promise<Progress> =>
  (await getJson(deps.evidence, pathOf(event, 'render-full-progress'))) as Progress;

export function fullRenderSteps(deps: StepDeps): FullRenderSteps {
  return {
    async plan(event) {
      const [seeds, results] = await Promise.all([
        loadSeeds(deps, event),
        loadResultsForBuild(deps, event),
      ]);
      const { assembled } = await assembledSoFar(deps, event, seeds, results);
      const sampled = (await getJson(deps.evidence, pathOf(event, 'render'))) as RenderOutcome;
      const candidates = [...fullRenderCandidates(assembled)];
      const plan = fullRenderPlan(candidates, sampled);
      const previous = await deps.store.previousGraded(event.siteId, event.checkId);
      const states = previous ? await deps.store.pageStates(previous.check.id) : new Map();
      const progress: Progress = { plan, candidates, states: [...states], done: NOTHING };
      await putJson(deps.evidence, pathOf(event, 'render-full-progress'), progress);
      return { pages: plan.length, at: deps.now() };
    },

    async chunk(event, index, leftMs, deadlineAt) {
      const progress = await readProgress(deps, event);
      const byUrl = new Map(progress.candidates.map((c) => [c.url, c]));
      const pages = progress.plan
        .slice(index * FULL_RENDER_CHUNK_PAGES, (index + 1) * FULL_RENDER_CHUNK_PAGES)
        .map((p) => byUrl.get(p.url)!);
      // Each page is read on the worker's reader thread, as the sample render reads its pages
      // (finish.ts `render`, questions/042 design C), never here, where nothing bounds the read.
      let worker: ReturnType<typeof deps.worker> = null;
      try {
        worker = deps.worker();
      } catch {
        // A worker client that cannot be built reads no page: each records measure_failed.
      }
      const { dailyFor, ...render } = deps.render;
      const outcome = await renderCheck({
        candidates: pages,
        openFixTemplates: [],
        maxRenders: pages.length,
        previousStates: new Map(progress.states),
        maxEmptyRootRenders: 0,
        ...render,
        caps: { perCheckMs: leftMs, perDayMs: render.caps.perDayMs },
        daily: dailyFor?.(event.checkId) ?? render.daily,
        deadlineAt,
        now: deps.now,
        read: async (staticHtml, renderedHtml, pageUrl) =>
          (await worker?.measureRendered?.(staticHtml, renderedHtml, pageUrl)) ?? null,
      });
      const held = new Set(progress.done.pages.map((p) => p.url));
      const done = {
        pages: [...progress.done.pages, ...outcome.pages.filter((p) => !held.has(p.url))],
        browser_ms: progress.done.browser_ms + outcome.browser_ms,
        settle_failed: progress.done.settle_failed || outcome.settle_failed,
      };
      await putJson(deps.evidence, pathOf(event, 'render-full-progress'), { ...progress, done });
      // The check's heartbeat, with its own progress: the reaper sees the run alive.
      const check = await deps.store.check(event.checkId);
      const at = deps.now();
      if (check.progress) await deps.store.progress(event.checkId, check.progress, iso(at));
      return { browser_ms: outcome.browser_ms, at };
    },

    async merge(event, notReached: NotReached) {
      const [progress, sampled] = await Promise.all([
        readProgress(deps, event),
        getJson(deps.evidence, pathOf(event, 'render')) as Promise<RenderOutcome>,
      ]);
      const chunkOutcome = { ...progress.done, estimate: sampled.estimate };
      const merged = mergeFullRender(
        sampled,
        [chunkOutcome],
        progress.plan,
        progress.candidates,
        notReached,
      );
      const rendered = progress.done.pages.filter((p) => p.rendered).length;
      if (rendered === 0) {
        // A full render that rendered no page does not count against the month.
        if (event.accountId !== null)
          await deps.store.giveBackFullRender(event.accountId, event.checkId);
        return { merged: false };
      }
      await putJson(deps.evidence, pathOf(event, 'render-full'), merged);
      return { merged: true };
    },
  };
}
