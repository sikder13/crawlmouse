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
  // CC-27b: a deletion was confirmed. deletionCancelFn ends the person's subscription through CC-03's
  // cancel, and trialLifecycleFn stops (cancelOn). Names the person only.
  'account.deletion_confirmed': { data: { userId: string } };
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
};

export const inngest = new Inngest({
  id: 'crawlmouse',
  schemas: new EventSchemas().fromRecord<Events>(),
});
