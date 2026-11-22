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
  capacity_wait_exceeded:
    'our crawlers were all busy with other audits, and yours waited too long for one; nothing was wrong with your site',
  site_unreachable:
    'the site did not answer our request (a DNS, connection or TLS failure, or a timeout)',
  nothing_read: 'we could not read a single page of this site, so there is nothing to grade',
  build_failed: 'the pages were crawled, and grading them failed on our side',
  persist_failed: 'the audit was graded, and saving the result failed on our side',
  internal: 'something failed on our side',
};

/** The heading of a failed check, where the reason is about the site and not about the audit. */
export const FAILURE_TITLE: Partial<Record<FailureReason, string>> = {
  site_unreachable: 'We could not reach this site',
  nothing_read: 'We could not read this site',
};

/** What the reader can do about it, where that is more than running it again. */
export const FAILURE_NEXT: Partial<Record<FailureReason, string>> = {
  capacity_wait_exceeded:
    'Start it again in a few minutes, once a crawler is free. A new audit is free.',
  site_unreachable:
    'Check the address and that the site is up, then run it again. A new audit is free.',
  nothing_read:
    'No grade was given. Once the site serves its pages, run it again. A new audit is free.',
};
