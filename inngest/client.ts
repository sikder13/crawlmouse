import { Inngest, EventSchemas } from 'inngest';
import type { AccountState } from '@crawlmouse/types/v2';
import type {
  CheckCancelRequested,
  CheckNotifyRequested,
  CheckFailed,
  CheckFinished,
  CheckRequested,
} from './check-events';

type Events = {
  'audit.requested': {
    data: {
      auditId: string;
      url: string;
      pageCap?: number;
      perHostConcurrency?: number;
      basicAuth?: { username: string; password: string };
      extraHeaders?: Record<string, string>;
      commitSha?: string;
      environment?: string;
      branch?: string;
      deploymentId?: string;
    };
  };
  // grade/score are NULL when the SPEC 5.1a refusal gate withheld a verdict. This event feeds the
  // completed EMAIL, which leaves our control entirely — it must never render a letter we refused.
  'audit.completed': { data: { auditId: string; grade: string | null; score: number | null } };
  'audit.failed': { data: { auditId: string; reason: string } };
  // User pressed "Cancel" on a running audit → the worker stops via auditFn.cancelOn and the cancel
  // route marks the row 'canceled'. `match: 'data.auditId'` scopes the cancellation to that one run.
  'audit.cancel.requested': { data: { auditId: string } };
  // Triggers an explicit, real reconcile (the scheduled cron is dry-run only). `mode` defaults
  // to 'full'; 'single-customer' additionally requires `customerId`.
  'billing.reconcile.requested': {
    data: { mode?: 'dry-run' | 'single-customer' | 'full'; customerId?: string };
  };
  // v2 billing (CC-03): the entitlement machine's `event` and `email` effects, sent by
  // apps/web/lib/billing/effects.ts. Data shapes as ARCH-2 §4.1 lists them.
  'trial.started': {
    data: { accountId: string; trialEndsAt: string; variant: 'no_card' | 'card_required' };
  };
  'trial.converted': { data: { accountId: string } };
  'entitlement.changed': { data: { accountId: string; from: AccountState; to: AccountState } };
  // CC-28's mailer handles it; nothing in CC-03 does.
  // CC-27b's three account emails name one link row (account_tokens), never an address or a token;
  // the mailer mints the link through issue_account_link (apps/web/lib/v2/account/emails.ts).
  'email.requested': {
    data:
      | { accountId: string; template: 'trial_reminder' }
      | {
          accountId: string;
          template: 'email_change_confirm' | 'email_change_notice' | 'account_delete';
          tokenId: string;
        };
  };
  // CC-27b: a deletion was confirmed, one event per account it marked. deletionCancelFn ends the
  // account's subscription through CC-03's cancel, and the account's trialLifecycleFn stops (cancelOn,
  // matched on the account). Names the person and the account only.
  'account.deletion_confirmed': { data: { userId: string; accountId: string } };
  // CC-27b: a deletion was undone in its window. deletionResumeFn continues the subscriptions the
  // deletion set to end (restore_account names them), and a deletionCancelFn still waiting stops.
  'account.restored': { data: { userId: string; subscriptionIds: string[] } };
  // The v2 check pipeline (CC-20b, check.ts). Registered only when V2_PIPELINE=1.
  'check.requested': { data: CheckRequested };
  'check.finished': { data: CheckFinished };
  'check.failed': { data: CheckFailed };
  'check.cancel.requested': { data: CheckCancelRequested };
  // A visitor asked to be told when a check ends (CC-22b). CC-28's mailer handles it; the address
  // stays in checks.notify_email and is not in the event.
  'check.notify_requested': { data: CheckNotifyRequested };
  // CC-26b: a member asked for a fix's packet to be emailed to a developer
  // (POST /api/fixes/[id]/email-developer). The request, address included, is a
  // fix_email_requests row; the event names only that row, so no address sits in Inngest's event
  // history. CC-28's mailer reads the row and sends; nothing in CC-26b does.
  'fix.email_developer_requested': { data: { requestId: string } };
  // CC-31: an invitation to a seat was written or re-sent (apps/web/lib/v2/agency/seats.ts). The
  // event names the seat and the invitation's number, never an address or a token: the handler
  // reads both through issue_seat_invite.
  'seat.invite.requested': { data: { seat_id: string; seq: number } };
  // CC-31: the two mails of a client report schedule (inngest/mail.ts). Each names a row and holds
  // no address and no token: the confirmation asked of a site's client contact, and a report to send.
  // request_id names one request for a confirmation. The mail's ledger key holds it, so an event
  // that repeats a value asks for no second mail; the handler refuses an empty one and one longer
  // than 100 characters.
  'report.confirmation.requested': { data: { site_id: string; request_id: string } };
  'report.send.requested': { data: { report_id: string } };
  // CC-28 D6: one account's weekly summary is due (inngest/summary.ts). Names the account and the
  // week only; the recipients are read when it is sent.
  'summary.requested': { data: { accountId: string; weekKey: string; weekStart: string } };
};

export const inngest = new Inngest({
  id: 'crawlmouse',
  schemas: new EventSchemas().fromRecord<Events>(),
});
