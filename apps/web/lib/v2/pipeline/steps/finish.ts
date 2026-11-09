/**
 * The steps after the batches: render, build, persist, finalize.
 *
 * render runs CC-14's renderCheck over renderCandidates with the daily budget it is given; today that
 * budget throws (Q7, NO_DAILY_BUDGET), so nothing renders. renderCheck has no deadline of its own
 * yet, which rendering needs before it is enabled (RESERVE_S).
 *
 * build calls buildCheck on what the check stored and what the database holds (finding 14: the
 * engine SHA is VERCEL_GIT_COMMIT_SHA, 40 hex, or the step fails; the worker release is the batches'
 * one release; `previous_check_id` is the site's latest other check, `previous` its latest graded one
 * with its diff inputs; the page cap is the event's). It stores the built check with the pages'
 * vantage (pageVantage), and the map drawing (D10). persist hands that to persistBuiltCheck, the one writer (D5).
 * finalize deletes the built check, which is scratch; the map drawing stays.
 */
import {
  buildCheck,
  checkMap,
  GRADE_VERSION,
  renderCandidates,
  renderCheck,
  sample,
  serialiseBuilt,
  type BuiltCheck,
  type RenderOutcome,
} from '@crawlmouse/engine/v2/pipeline';
import type { CheckSteps } from '../../../../../../inngest/check';
import { CheckFailure } from '../../../../../../inngest/check-events';
import { getJson, putJson } from '../evidence';
import { pageVantage, persistBuiltCheck } from '../persist';
import type { PageVantage } from '../types';
import type { StepDeps } from './deps';
import {
  assembledSoFar,
  isCrawl,
  iso,
  loadResults,
  loadSeeds,
  pathOf,
  releaseOfAll,
} from './stored';

/** What `build` stores and `persist` reads: the built check as serialiseBuilt writes it. */
interface StoredBuilt {
  /** `grades` holds Maps, which serialiseBuilt writes as objects; persistence does not read grades. */
  built: BuiltCheck;
  vantage: [string, PageVantage][];
}

const SHA = /^[0-9a-f]{40}$/;

export function finishSteps(
  deps: StepDeps,
): Pick<CheckSteps, 'render' | 'build' | 'persist' | 'finalize'> {
  return {
    async render(event) {
      const [seeds, results] = await Promise.all([
        loadSeeds(deps, event),
        loadResults(deps, event),
      ]);
      const { check, assembled } = await assembledSoFar(deps, event, seeds, results);
      const sampled = sample(assembled);
      const [fixes, previous] = await Promise.all([
        deps.store.fixes(event.siteId),
        deps.store.previousGraded(event.siteId, event.checkId, check.queued_at),
      ]);
      const states = previous ? await deps.store.pageStates(previous.check.id) : new Map();
      const outcome = await renderCheck({
        ...renderCandidates(assembled, [...sampled.stage1, ...sampled.stage2], fixes, states),
        ...deps.render,
      });
      await putJson(deps.evidence, pathOf(event, 'render'), outcome);
      const rendered = outcome.pages.filter((p) => p.rendered).length;
      return { rendered, not_rendered: outcome.pages.length - rendered };
    },

    async build(event) {
      const sha = deps.env.VERCEL_GIT_COMMIT_SHA?.trim() ?? '';
      if (!SHA.test(sha)) throw new CheckFailure('build_failed');
      const check = await deps.store.check(event.checkId);
      if (check.grade_version !== GRADE_VERSION || check.started_at === null) {
        throw new CheckFailure('build_failed');
      }
      const [site, seeds, results] = await Promise.all([
        deps.store.site(event.siteId),
        loadSeeds(deps, event),
        loadResults(deps, event),
      ]);
      const release = releaseOfAll(results);
      if (!results.some(isCrawl) || release === null) throw new CheckFailure('worker_unavailable');
      const [previousCheckId, previous, fixes, render] = await Promise.all([
        deps.store.previousCheckId(event.siteId, event.checkId, check.queued_at),
        deps.store.previousGraded(event.siteId, event.checkId, check.queued_at),
        deps.store.fixes(event.siteId),
        getJson(deps.evidence, pathOf(event, 'render')) as Promise<RenderOutcome>,
      ]);
      const events = await deps.store.fixEvents(fixes.map((f) => f.id));
      const now = iso(deps.now());

      const built = buildCheck({
        check: {
          id: check.id,
          site_id: check.site_id,
          previous_check_id: previousCheckId,
          trigger: check.trigger,
          queued_at: check.queued_at,
          started_at: check.started_at,
          finished_at: now,
          expires_at: check.expires_at,
          page_cap: event.pageCap,
          grade_version: check.grade_version,
        },
        site,
        homepage_url: event.homepageUrl,
        seeds,
        batches: results,
        render,
        previous,
        fixes,
        events,
        lineage: { engine_sha: sha, worker_release: release },
        now,
      });
      const status = built.check.status;
      if (status !== 'finished' && status !== 'partial') throw new CheckFailure('build_failed');

      const vantage = pageVantage(results.filter(isCrawl).flatMap((b) => b.pages));
      await putJson(
        deps.evidence,
        pathOf(event, 'map'),
        checkMap(built.page_results, built.link_edges),
      );
      const stored: StoredBuilt = {
        built: JSON.parse(serialiseBuilt(built)),
        vantage: [...vantage],
      };
      await putJson(deps.evidence, pathOf(event, 'built'), stored);
      return { status, pages: built.page_results.length, fixes: built.fixes.length };
    },

    async persist(event) {
      const stored = (await getJson(deps.evidence, pathOf(event, 'built'))) as StoredBuilt;
      const outcome = await persistBuiltCheck(deps.persistDb, {
        built: stored.built,
        vantage: new Map(stored.vantage),
        map_path: pathOf(event, 'map'),
      });
      return { written: outcome.written };
    },

    async finalize(event) {
      await deps.evidence.remove([pathOf(event, 'built')]);
      return {};
    },
  };
}
