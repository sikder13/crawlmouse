/**
 * The numbers the check pipeline runs by, each with its reason. The orchestration's own waits and
 * bounds (PACE) and the failure reasons live with the Inngest functions, which do not import the
 * app, and are re-exported here beside the rest.
 */
import { PACE } from '../../../../../inngest/check';

import { FIRST_ACCEPT_BY_S, LARGE_CHECK_ABOVE } from '../../../../../inngest/check';

export {
  cadenceFor,
  FIRST_ACCEPT_BY_S,
  LARGE_CHECK_ABOVE,
  PACE,
  QUEUE_WAIT_MAX_S,
  STEP_OUTPUT_BYTES,
} from '../../../../../inngest/check';
export { FAILURE_REASONS, type FailureReason } from '../../../../../inngest/check-events';

/**
 * Of the run's finish timeout, what render, build, persist and finalize keep after the last batch. Render
 * takes at most RENDER_SHARE_S of it (`steps/time.ts` `renderEndsAt`), and renders nothing while its
 * two caps are unset. Persist is one step whatever
 * persistBuiltCheck sends inside it (Q11: staged chunks, then the finishing RPC); its duration at the
 * page cap is not measured against this reserve yet.
 */
export const RESERVE_S = 180;
/**
 * Of RESERVE_S, what the render step may spend rendering (`RENDER_STEP_MS`), counted from its start.
 * The rest is for build, persist and finalize, which need at least AFTER_RENDER_MIN_S. Chosen, not
 * measured against a real render: rendering is off until the Browser Run caps are set, and this is
 * to be checked on staging first.
 */
export const RENDER_SHARE_S = 90;
/**
 * What the steps after render keep at least. Loading, building, serialising, compressing and
 * staging a check at the most edges the F-248 bound keeps (500 pages × 200 links) took about 22 s
 * in-process (PR #165's harness). Persist's round trips to the database and Inngest's step latency
 * come on top, and are not measured here.
 */
export const AFTER_RENDER_MIN_S = 90;
/** The crawl phase's ceiling: ENGINE-GAP §8's Free-tier HTTP-phase ceiling. */
export const CRAWL_CEILING_S = 480;
/**
 * What the access stages keep for themselves out of the fetching time: stage 1 is ~25 pages. In a run
 * whose crawl ends here rather than at its ceiling, the last crawl batch's grace and poll fall in this
 * slice (steps/time.ts, F-247), so the stages keep at least this less two graces and polls, before
 * step latency and any busy answer to the access post.
 */
export const ACCESS_SLICE_S = 300;
/**
 * The largest page cap a check is given, Pro's and Agency's (inbox 079): PACE.maxCrawlBatches
 * batches of the engine's CRAWL_BATCH_URLS (50).
 */
export const MAX_PAGE_CAP = 2000;
/**
 * A large check's crawl, 1.7 s a page (inbox 079). Requirement: a site that answers a paced request
 * in 1.0 s or less is read to the cap. At 1.0 s a page a 50-page batch takes 50 s, and a run that
 * hears no done signal polls at 10, 30 and 70 s, so it finds the batch done 20 s late; with the step
 * latency on top, the orchestration's simulation reads all 40 batches only from 1.7 s a page at 3 s a
 * step (1.5 does at 1 s a step; steps/time.test.ts). With the worker's done signal (PR 5a) a batch
 * is read when it ends, so a fast site finishes well inside this: it is a ceiling, not a duration.
 * The worker's limiter (packages/worker/src/politeness/limiter.ts) starts requests at least 500 ms
 * apart and lets two run at once on a slow site.
 */
export const LARGE_CRAWL_S_PER_PAGE = 1.7;
/**
 * A large check's reserve after the last batch: building a 2,000-page check measured 45 to 62 s
 * in-process (#165's harness, 24 Nov); persisting it is one database transaction, not measured.
 */
export const LARGE_RESERVE_S = 300;

/**
 * The crawl's ceiling for a check of `pageCap` pages: CRAWL_CEILING_S up to 500, then by the page, up to
 * MAX_PAGE_CAP's. A cap above it is read as MAX_PAGE_CAP: PACE.maxCrawlBatches reads no more, and the
 * run's finish timeout is sized for it, so a longer plan would be cancelled before its build.
 */
export const crawlCeilingS = (pageCap: number): number =>
  pageCap > LARGE_CHECK_ABOVE
    ? Math.ceil(Math.min(pageCap, MAX_PAGE_CAP) * LARGE_CRAWL_S_PER_PAGE)
    : CRAWL_CEILING_S;
/** The reserve after the last batch for a check of `pageCap` pages. */
export const reserveS = (pageCap: number): number =>
  pageCap > LARGE_CHECK_ABOVE ? LARGE_RESERVE_S : RESERVE_S;
/**
 * A check's own finish, from its first claim attempt: the latest first batch, then its crawl, the
 * access slice and its reserve. The run's finish timeout, PACE.finishS, is the largest cap's.
 */
export const finishSFor = (pageCap: number): number =>
  FIRST_ACCEPT_BY_S + crawlCeilingS(pageCap) + ACCESS_SLICE_S + reserveS(pageCap);

/** A batch that could be given less than this is not posted; its phase ends instead. */
export const MIN_BATCH_S = 60;
/** Discovery's bound on reading robots.txt and the sitemaps (PACE.discoverS, one value). */
export const DISCOVER_S = PACE.discoverS;
/** One discovery request's socket idle time and its whole time. */
export const DISCOVER_REQUEST_MS = 10_000;
export { SITEMAP_URL_CAP } from '../sitemap-cap';
/** The crawl's page cap when a request sets none: v1's free cap. */
export const DEFAULT_PAGE_CAP = 500;
/**
 * The reaper fails a queued or running check whose heartbeat is older than this (D13): above the
 * finish timeout plus the longest wait between two heartbeats (steps/lifecycle.test.ts), so no check
 * whose run may still be alive is reaped. 95 minutes since the finish timeout became 88 for 2,000
 * pages (inbox 079); 45 before that.
 */
export const REAP_AFTER_S = 95 * 60;
/** An audit nobody keeps stays readable this long after it was requested (CC-22b D8). */
export const ANONYMOUS_EXPIRY_HOURS = 24;
/** Manual and fix re-check requests in one 2-minute bucket are one check (ARCH-2 §4.1). */
export const MANUAL_BUCKET_S = 120;
/** Deploy hooks in one 10-minute bucket are one check: its own module, so client copy can read it. */
export { DEPLOY_BUCKET_S } from './deploy-bucket';

/**
 * A crawl batch's budget; `max_seconds` is its most, cut to the time left. Requests: 50 URLs with up
 * to five redirect hops each, robots.txt on up to four origins, and seven declaration files.
 */
export const CRAWL_BATCH_BUDGET = {
  max_requests: 400,
  max_bytes: 128 * 1024 * 1024,
  max_seconds: 240,
} as const;

/**
 * An access batch's budget; `max_seconds` as above. Requests: up to 50 pages, each with the control,
 * six crawlers and the canary, and robots.txt.
 */
export const ACCESS_BATCH_BUDGET = {
  max_requests: 500,
  max_bytes: 128 * 1024 * 1024,
  max_seconds: 240,
} as const;
