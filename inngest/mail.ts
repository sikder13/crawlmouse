/**
 * The mailer's event handlers (CC-28 D2, D11), registered only with V2_CHECKS_PUBLIC=1
 * (apps/web/lib/v2/pipeline/functions.ts). What each one does is injected (`MailHandlers`), so this
 * package imports nothing from the app; the production handlers are apps/web/lib/v2/mail/handlers.ts.
 *
 * - accountMailFn, on `email.requested`: the trial reminder, CC-27b's three account-link emails, and
 *   CC-29's Agency Plus request (`agency_plus_contact`), which goes to our own sales inbox.
 * - checkNotifyFn, on `check.notify_requested`, `check.finished` and `check.failed`: the visitor's
 *   "tell me when it ends". The request can arrive before or after the check ends, so the function
 *   runs on all three and sends once the check has ended and an address is stored; the send ledger's
 *   key (`check_notify:<checkId>`) makes the second arrival send nothing.
 * - fixToDeveloperFn, on `fix.email_developer_requested`.
 * - checkFinishedEventFn, on `check.finished`: the product event `check_finished`, once per check
 *   (Inngest's idempotency on the check id, and one step).
 * - seatInviteFn, on `seat.invite.requested` (CC-31): a seat's invitation. The event names the seat and
 *   the invitation's number; the ledger's key is both (`seat_invite:<seat>:<seq>`), so a resend, which
 *   is the next number, is another mail.
 * - contactPurgeFn, daily: deletes the Agency Plus requests sent more than 30 days ago, and the unsent
 *   ones made more than 30 days ago (`purge_contact_requests`, migration 20261114000001).
 *
 * The two mails of a client report schedule (CC-31) have their functions here as well, over
 * `ReportMailHandlers`: reportConfirmFn, on `report.confirmation.requested`, and clientReportFn, on
 * `report.send.requested`. Which of this file's functions a deployment registers is the list
 * `mailFunctions` returns (apps/web/lib/v2/mail/functions.ts).
 *
 * Each runs its handler in one step. A `MailRetry` (a send worth retrying, or a claim another worker
 * holds) is thrown on, so Inngest retries the step; any other error is logged by name and the step
 * ends, so a mail failure never turns into a stream of retries of something that will not change.
 */
import { inngest } from './client';

export const ACCOUNT_MAIL_FN_ID = 'crawlmouse.mail.account';
export const CHECK_NOTIFY_FN_ID = 'crawlmouse.mail.check-notify';
export const FIX_TO_DEVELOPER_FN_ID = 'crawlmouse.mail.fix-to-developer';
export const CHECK_FINISHED_EVENT_FN_ID = 'crawlmouse.events.check-finished';
export const SEAT_INVITE_FN_ID = 'crawlmouse.mail.seat-invite';
export const REPORT_CONFIRM_FN_ID = 'crawlmouse.mail.report-confirm';
export const CLIENT_REPORT_FN_ID = 'crawlmouse.mail.client-report';
export const CONTACT_PURGE_FN_ID = 'crawlmouse.mail.contact-purge';

/**
 * Retries of a mail step. A claim held by a worker that died is taken back after two minutes
 * (`claim_email_send`), and Inngest's backoff grows between retries, so a few more than the default
 * let the last ones fall after the lease.
 */
export const MAIL_RETRIES = 8 as const;
/**
 * A mail function's concurrency, where it sets no other (the confirmation's is
 * `REPORT_CONFIRM_CONCURRENCY`): small, well under the plan cap the serve route's test holds.
 */
export const MAIL_CONCURRENCY = 2;

export type EmailRequestedData =
  | { accountId: string; template: 'trial_reminder' }
  | {
      accountId: string;
      template: 'email_change_confirm' | 'email_change_notice' | 'account_delete';
      tokenId: string;
    }
  // CC-29: names the contact_requests row, never the address (inngest/client.ts).
  | { template: 'agency_plus_contact'; contactId: string };

/** What each function does; every one answers a short outcome word for the run's output. */
export interface MailHandlers {
  accountEmail(data: EmailRequestedData): Promise<string>;
  checkNotify(checkId: string): Promise<string>;
  fixToDeveloper(requestId: string): Promise<string>;
  checkFinished(checkId: string): Promise<string>;
  /** Invitation `seq` of the seat `seatId` (`seats.invite_seq`). */
  seatInvite(seatId: string, seq: number): Promise<string>;
}

/** What the two functions of a client report schedule's mail do; each answers an outcome word. */
export interface ReportMailHandlers {
  /**
   * The confirmation asked of a site's client contact. `requestId` is the event's `request_id`: it
   * names the request, so a retry or a replay of one request is one mail and the next request is
   * another.
   */
  reportConfirm(siteId: string, requestId: string): Promise<string>;
  clientReport(reportId: string): Promise<string>;
}

/** The mailer's retry signal, read by name: the app's `MailRetry` class (lib/v2/mail/send.ts). */
export const isMailRetry = (e: unknown): boolean => e instanceof Error && e.name === 'MailRetry';

/** Runs a handler: a MailRetry is thrown on; any other error is logged by name only and ends it. */
export async function guarded(fn: string, run: () => Promise<string>): Promise<string> {
  try {
    return await run();
  } catch (e) {
    if (isMailRetry(e)) throw e;
    console.error(
      JSON.stringify({
        event: 'mail.handler_error',
        fn,
        error: e instanceof Error ? e.name : 'unknown',
      }),
    );
    return 'error';
  }
}

const mailConfig = (id: string) => ({
  id,
  retries: MAIL_RETRIES,
  concurrency: { limit: MAIL_CONCURRENCY },
});

export function createAccountMailFn(handlers: () => MailHandlers) {
  return inngest.createFunction(
    mailConfig(ACCOUNT_MAIL_FN_ID),
    { event: 'email.requested' },
    async ({ event, step }) =>
      step.run('send', () =>
        guarded(ACCOUNT_MAIL_FN_ID, () => handlers().accountEmail(event.data)),
      ),
  );
}

export function createCheckNotifyFn(handlers: () => MailHandlers) {
  return inngest.createFunction(
    mailConfig(CHECK_NOTIFY_FN_ID),
    [{ event: 'check.notify_requested' }, { event: 'check.finished' }, { event: 'check.failed' }],
    async ({ event, step }) =>
      step.run('send', () =>
        guarded(CHECK_NOTIFY_FN_ID, () => handlers().checkNotify(event.data.checkId)),
      ),
  );
}

export function createFixToDeveloperFn(handlers: () => MailHandlers) {
  return inngest.createFunction(
    mailConfig(FIX_TO_DEVELOPER_FN_ID),
    { event: 'fix.email_developer_requested' },
    async ({ event, step }) =>
      step.run('send', () =>
        guarded(FIX_TO_DEVELOPER_FN_ID, () => handlers().fixToDeveloper(event.data.requestId)),
      ),
  );
}

export function createCheckFinishedEventFn(handlers: () => MailHandlers) {
  return inngest.createFunction(
    {
      id: CHECK_FINISHED_EVENT_FN_ID,
      // One run per check for 24 hours, whatever sends the event again (Inngest's idempotency key).
      idempotency: 'event.data.checkId',
      concurrency: { limit: MAIL_CONCURRENCY },
    },
    { event: 'check.finished' },
    async ({ event, step }) =>
      step.run('capture', () =>
        guarded(CHECK_FINISHED_EVENT_FN_ID, () => handlers().checkFinished(event.data.checkId)),
      ),
  );
}

export function createSeatInviteFn(handlers: () => MailHandlers) {
  return inngest.createFunction(
    mailConfig(SEAT_INVITE_FN_ID),
    { event: 'seat.invite.requested' },
    async ({ event, step }) =>
      step.run('send', () =>
        guarded(SEAT_INVITE_FN_ID, () => handlers().seatInvite(event.data.seat_id, event.data.seq)),
      ),
  );
}

/**
 * One confirmation at a time: the handler counts the day's confirmations in the ledger and then
 * claims its own, two calls, so two runs together could each read the count before either claimed
 * and pass the day's bound by one. Run one after another, a count sees every earlier claim.
 */
export const REPORT_CONFIRM_CONCURRENCY = 1;

export function createReportConfirmFn(handlers: () => ReportMailHandlers) {
  return inngest.createFunction(
    { ...mailConfig(REPORT_CONFIRM_FN_ID), concurrency: { limit: REPORT_CONFIRM_CONCURRENCY } },
    { event: 'report.confirmation.requested' },
    async ({ event, step }) =>
      step.run('send', () =>
        guarded(REPORT_CONFIRM_FN_ID, () =>
          handlers().reportConfirm(event.data.site_id, event.data.request_id),
        ),
      ),
  );
}

export function createClientReportFn(handlers: () => ReportMailHandlers) {
  return inngest.createFunction(
    mailConfig(CLIENT_REPORT_FN_ID),
    { event: 'report.send.requested' },
    async ({ event, step }) =>
      step.run('send', () =>
        guarded(CLIENT_REPORT_FN_ID, () => handlers().clientReport(event.data.report_id)),
      ),
  );
}

/**
 * The daily deletion of Agency Plus requests: one step, whose answer is the count deleted. Safe to
 * run again: a retried step deletes what is still past the line.
 */
export function createContactPurgeFn(purge: () => Promise<number>) {
  return inngest.createFunction(
    { id: CONTACT_PURGE_FN_ID, concurrency: { limit: 1 } },
    // Off the hour, and away from v1's cleanup (04:00), the reconcile (03:00) and the expiry (05:17).
    { cron: '43 5 * * *' },
    async ({ step }) => ({ deleted: await step.run('purge', () => purge()) }),
  );
}
