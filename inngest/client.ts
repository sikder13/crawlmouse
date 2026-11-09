import { Inngest, EventSchemas } from 'inngest';
import type { AccountState } from '@crawlmouse/types/v2';

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
  'email.requested': { data: { accountId: string; template: 'trial_reminder' } };
};

export const inngest = new Inngest({
  id: 'crawlmouse',
  schemas: new EventSchemas().fromRecord<Events>(),
});
