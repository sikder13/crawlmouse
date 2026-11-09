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
  /** No crawl batch could be posted or read, or the worker kept refusing. */
  'worker_unavailable',
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

/**
 * The ids check.failed and check.finished are sent with: one of each per check, so a second send of
 * either (a retried step, or two handlers failing the same check) starts no second run of what they
 * trigger, by Inngest's deduplication of event ids, which lasts 24 hours (correctness 5).
 */
export const checkFailedEventId = (checkId: string): string => `check-failed:${checkId}`;
export const checkFinishedEventId = (checkId: string): string => `check-finished:${checkId}`;

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
