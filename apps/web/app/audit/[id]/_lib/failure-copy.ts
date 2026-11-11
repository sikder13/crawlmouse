/**
 * Why a check stopped, in plain words (CC-22b D4): one phrase per reason the pipeline stores, which
 * completes "What happened: …". Typed by `FailureReason`, so a reason added to the pipeline does
 * not compile until it has a phrase here. The stored word itself is never shown.
 */
import type { FailureReason } from '../../../../../../inngest/check-events';

export const FAILURE_COPY: Record<FailureReason, string> = {
  paused: 'audits were paused on our side when this one was due to run',
  site_busy: 'another audit of this site was still running',
  canceled: 'the audit was cancelled, or ran past its time limit',
  stalled: 'the audit stopped responding part-way through and was ended',
  not_started: 'the audit was queued and never began',
  worker_redeployed:
    'our crawler was updated part-way through, so its results could not be combined',
  worker_unavailable: 'our crawler could not be reached',
  build_failed: 'the pages were crawled, and grading them failed on our side',
  persist_failed: 'the audit was graded, and saving the result failed on our side',
  internal: 'something failed on our side',
};
