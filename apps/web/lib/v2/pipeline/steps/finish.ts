/**
 * The steps after the batches: render, build, persist, finalize.
 *
 * render runs CC-14's renderCheck over renderCandidates with the check's daily budget, and stops
 * RENDER_STEP_MS after the earlier of the step's start and the end of the fetching phases
 * (`renderEndsAt`), so a retry cannot render past its share of the reserve. With the two render caps
 * unset, nothing renders.
 *
 * build calls buildCheck on what the check stored and what the database holds (finding 14: the
 * engine SHA is VERCEL_GIT_COMMIT_SHA, 40 hex, or the step fails; the worker release is the batches'
 * one release; `previous` is the site's other finished or partial check that finished last, with its
 * diff inputs, or null when there is none or it stored none; `previous_check_id` is its id, or null
 * with it, so the check row and its changes name the same check; the page cap is the event's). It
 * stores the built check with the pages' vantage (pageVantage), and the map drawing (D10). persist
 * hands that to persistBuiltCheck, the one writer (D5). build also stores the check's research-ledger
 * draft (CC-41 D4, lib/v2/ledger/draft-step.ts), which never fails or changes the step.
 * finalize deletes the built check, which is scratch; the map drawing stays.
 */
import {
  buildCheck,
  checkMap,
  GRADE_VERSION,
  nothingReadReason,
  renderCandidates,
  renderCheck,
  sample,
  serialiseBuilt,
  type BuiltCheck,
  type RenderOutcome,
} from '@crawlmouse/engine/v2/pipeline';
import type { CheckSteps } from '../../../../../../inngest/check';
import { CheckFailure } from '../../../../../../inngest/check-events';
import { storeLedgerDraft } from '../../ledger/draft-step';
import { getJson, putJson } from '../evidence';
import { pageVantage, persistBuiltCheck, readOfFixes } from '../persist';
import type { FixRead, PageVantage } from '../types';
import type { StepDeps } from './deps';
import { renderEndsAt } from './time';
import {
  assembledSoFar,
  isCrawl,
  iso,
  loadResultsForBuild,
  loadSeeds,
  pathOf,
  releaseOfAll,
} from './stored';

/** What `build` stores and `persist` reads: the built check as serialiseBuilt writes it. */
interface StoredBuilt {
  /** `grades` holds Maps, which serialiseBuilt writes as objects; persistence does not read grades. */
  built: BuiltCheck;
  vantage: [string, PageVantage][];
  /** What the build read of the site's fixes, for persist's watermark (CC-26b D5). */
  read: FixRead[];
}

const SHA = /^[0-9a-f]{40}$/;

export function finishSteps(
  deps: StepDeps,
): Pick<CheckSteps, 'render' | 'build' | 'persist' | 'finalize'> {
  return {
    async render(event, so) {
      // The build's view of the edges (F2): the same pages and PageRank, so the same candidates, at
      // the build's bound; a check past it fails build_failed by name here, not out of memory.
      const startedAt = deps.now();
      const [seeds, results] = await Promise.all([
        loadSeeds(deps, event),
        loadResultsForBuild(deps, event),
      ]);
      const { assembled } = await assembledSoFar(deps, event, seeds, results);
      const sampled = sample(assembled);
      const [fixes, previous] = await Promise.all([
        deps.store.fixes(event.siteId),
        deps.store.previousGraded(event.siteId, event.checkId),
      ]);
      const states = previous ? await deps.store.pageStates(previous.check.id) : new Map();
      const { dailyFor, ...render } = deps.render;
      const outcome = await renderCheck({
        ...renderCandidates(assembled, [...sampled.stage1, ...sampled.stage2], fixes, states),
        ...render,
        daily: dailyFor?.(event.checkId) ?? render.daily,
        deadlineAt: renderEndsAt(startedAt, so),
        now: deps.now,
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
        loadResultsForBuild(deps, event),
      ]);
      const release = releaseOfAll(results);
      if (!results.some(isCrawl) || release === null) throw new CheckFailure('worker_unavailable');
      // A crawl that read no page has nothing to grade: it fails here, before the check is built or
      // persisted, so it cannot become a baseline or move the site's fixes.
      const unread = nothingReadReason(results.filter(isCrawl), event.homepageUrl);
      if (unread !== null) throw new CheckFailure(unread);
      const [previous, fixes, render] = await Promise.all([
        deps.store.previousGraded(event.siteId, event.checkId),
        deps.store.fixes(event.siteId),
        getJson(deps.evidence, pathOf(event, 'render')) as Promise<RenderOutcome>,
      ]);
      const events = await deps.store.fixEvents(fixes.map((f) => f.id));
      const now = iso(deps.now());

      const built = buildCheck({
        check: {
          id: check.id,
          site_id: check.site_id,
          // The diff's baseline: the changes name it too (diffCheck's `previous_check_id`).
          previous_check_id: previous?.check.id ?? null,
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
        read: readOfFixes(fixes, events),
      };
      await putJson(deps.evidence, pathOf(event, 'built'), stored);
      await storeLedgerDraft(deps.ledger, deps.env, {
        checkId: check.id,
        built,
        crawl: results.filter(isCrawl),
        homepage: event.homepageUrl,
      });
      return { status, pages: built.page_results.length, fixes: built.fixes.length };
    },

    async persist(event) {
      const stored = (await getJson(deps.evidence, pathOf(event, 'built'))) as StoredBuilt;
      const outcome = await persistBuiltCheck(deps.persistDb, {
        built: stored.built,
        vantage: new Map(stored.vantage),
        map_path: pathOf(event, 'map'),
        read: stored.read,
      });
      return { written: outcome.written };
    },

    async finalize(event) {
      await deps.evidence.remove([pathOf(event, 'built')]);
      return {};
    },
  };
}
