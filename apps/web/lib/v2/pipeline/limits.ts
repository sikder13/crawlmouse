/**
 * The numbers the check pipeline runs by, each with its reason. The orchestration's own waits and
 * bounds (PACE) and the failure reasons live with the Inngest functions, which do not import the
 * app, and are re-exported here beside the rest.
 */
export { PACE, STEP_OUTPUT_BYTES } from '../../../../../inngest/check';
export { FAILURE_REASONS, type FailureReason } from '../../../../../inngest/check-events';

/**
 * Of the run's 20 minutes, what render, build, persist and finalize keep after the last batch. Render
 * runs with a daily budget that refuses (Q7), so today it returns at once; a deadline inside
 * renderCheck has to come before rendering is enabled. Persist is one step whatever
 * persistBuiltCheck sends inside it (Q11: staged chunks, then the finishing RPC); its duration at the
 * page cap is not measured against this reserve yet.
 */
export const RESERVE_S = 180;
/** The crawl phase's ceiling: ENGINE-GAP §8's Free-tier HTTP-phase ceiling. */
export const CRAWL_CEILING_S = 480;
/** What the access stages keep for themselves out of the fetching time: stage 1 is ~25 pages. */
export const ACCESS_SLICE_S = 300;
/** A batch that could be given less than this is not posted; its phase ends instead. */
export const MIN_BATCH_S = 60;
/** Discovery's bound on reading robots.txt and the sitemaps. */
export const DISCOVER_S = 60;
/** One discovery request's socket idle time and its whole time. */
export const DISCOVER_REQUEST_MS = 10_000;
/** Sitemap URLs read as seeds at most (ARCH-2 §4.2 step 1). */
export const SITEMAP_URL_CAP = 5000;
/** The crawl's page cap when a request sets none: v1's free cap. */
export const DEFAULT_PAGE_CAP = 500;
/** The reaper fails a queued or running check whose heartbeat is older than this (D13). */
export const REAP_AFTER_S = 30 * 60;
/** An audit nobody keeps stays readable this long after it was requested (ARCH-2 §4.3). */
export const ANONYMOUS_EXPIRY_DAYS = 30;
/** Manual and fix re-check requests in one 2-minute bucket are one check (ARCH-2 §4.1). */
export const MANUAL_BUCKET_S = 120;
/** Deploy hooks in one 10-minute bucket are one check (ARCH-2 §4.1, J9). */
export const DEPLOY_BUCKET_S = 600;

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
