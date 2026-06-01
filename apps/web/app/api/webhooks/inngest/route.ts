import { serve } from 'inngest/next';
import { inngest as workerInngest } from '@crawlmouse/inngest';
import { auditFn } from '@crawlmouse/inngest/audit';
import { reconcileBillingFn, cleanupExpiredAuditsFn } from '@crawlmouse/inngest/billing';

export const { GET, POST, PUT } = serve({
  client: workerInngest,
  functions: [auditFn, reconcileBillingFn, cleanupExpiredAuditsFn],
});
