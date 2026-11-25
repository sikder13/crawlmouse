/**
 * The check pipeline's events (CC-20b; ARCH-2 §4.1 less renderAll, deploy meta and fix ids) and the
 * reasons a check fails with. They live here, in the Inngest package, because the functions that send
 * and receive them do; `apps/web/lib/v2/pipeline/types.ts` re-exports them.
 */
import { NonRetriableError } from 'inngest';
import type { Check } from '@crawlmouse/types/v2';

export type CheckRequested = {
  checkId: string;
  siteId: string;
  /** Null for a site no account keeps. */
  accountId: string | null;
  /** The site's host, lower case, no port. */
  host: string;
  /** Where the crawl starts, in the engine's canonical spelling. */
  homepageUrl: string;
  trigger: Check['trigger'];
  /** The most pages the crawl may fetch. */
  pageCap: number;
  requestedByUserId?: string;
  /**
   * F-260: this run is the check's one retry, after a worker deploy failed its first run. Its batches
   * are numbered from `firstBatch`, past every batch the first run posted: the worker keeps a result
   * for an hour under (check, batch number), and would hand an earlier number's back as posted.
   */
  retry?: { firstBatch: number };
};

/** The worker's note that a batch ended (PR 5a): a hint to read it now. The result is still read. */
export type CheckBatchEnded = {
  checkId: string;
  batch: number;
  status: 'done' | 'failed';
};

export type CheckFinished = {
  checkId: string;
  siteId: string;
  accountId: string | null;
  status: 'finished' | 'partial';
};

/**
 * The reasons a check fails with. `checks.failure_reason` is readable by the site's members, so the
 * pipeline's stores write one of these words (they refuse any other), not an error message.
 */
export const FAILURE_REASONS = [
  /** CRAWL_PAUSED was set, or the worker answered that it is paused. */
  'paused',
  /** Another check of the site was still running after the claim's waits. */
  'site_busy',
  /** The run was cancelled, or passed its finish timeout (Inngest reports both the same way). */
  'canceled',
  /** The reaper found a claimed check with no heartbeat for its bound. */
  'stalled',
  /** The reaper found a check no run ever claimed. */
  'not_started',
  /** A batch came from another worker release than the check's first. */
  'worker_redeployed',
  /**
   * No crawl batch could be read: the worker did not answer, refused our credentials, lost a batch
   * twice, kept a batch running past its deadline, or its result could not be read. Not a worker
   * that answered busy (capacity_wait_exceeded).
   */
  'worker_unavailable',
  /**
   * The worker answered, busy with other checks, until the check's next wait for its first crawl
   * batch would have passed the wait budget (QUEUE_WAIT_MAX_S) or FIRST_ACCEPT_BY_S: the check
   * never won a slot.
   */
  'capacity_wait_exceeded',
  /** No page was read, robots.txt on the homepage's origin got no answer, and no robots.txt read did. */
  'site_unreachable',
  /** No page was read for any other reason (nothingReadReason in the engine). */
  'nothing_read',
  'build_failed',
  'persist_failed',
  /** Anything else. */
  'internal',
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

export const isFailureReason = (value: unknown): value is FailureReason =>
  typeof value === 'string' && (FAILURE_REASONS as readonly string[]).includes(value);

export type CheckFailed = { checkId: string; siteId: string; reason: FailureReason };

export type CheckCancelRequested = { checkId: string };

export type CheckNotifyRequested = { checkId: string; siteId: string };

/**
 * The ids check.failed and check.finished are sent with: one of each per check, so a second send of
 * either (a retried step, or two handlers failing the same check) starts no second run of what they
 * trigger, by Inngest's deduplication of event ids, which lasts 24 hours (correctness 5).
 */
export const checkFailedEventId = (checkId: string): string => `check-failed:${checkId}`;
export const checkFinishedEventId = (checkId: string): string => `check-finished:${checkId}`;
/** F-260: the one retry of a check. Inngest keeps an event id 24 hours, so a second send starts nothing. */
export const checkRetryEventId = (checkId: string): string => `check-retry:${checkId}`;

const FAILURE_PREFIX = 'check failed: ';
const FAILURE_MESSAGE = /^check failed: ([a-z_]+)$/;

/**
 * A failure whose reason is known where it is thrown. Non-retriable: the same input fails the same
 * way. Its message is the prefix and the reason only, which survives Inngest's serialisation of a
 * step error, so `failureReasonOf` reads it back in onFailure.
 */
export class CheckFailure extends NonRetriableError {
  constructor(
    readonly reason: FailureReason,
    options?: { cause?: unknown },
  ) {
    super(`${FAILURE_PREFIX}${reason}`, options);
  }
}

/**
 * The reason an error carries: a CheckFailure's (read from the message, as Inngest serialises
 * errors); `worker_unavailable` for a worker request that failed (the worker client's error class is
 * named `WorkerError`); otherwise `internal`.
 */
export function failureReasonOf(error: unknown): FailureReason {
  if (!(error instanceof Error)) return 'internal';
  const reason = FAILURE_MESSAGE.exec(error.message)?.[1];
  if (isFailureReason(reason)) return reason;
  return error.name === 'WorkerError' ? 'worker_unavailable' : 'internal';
}
