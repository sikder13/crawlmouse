import { serve } from 'inngest/next';
import { inngest as workerInngest } from '@crawlmouse/inngest';
import { auditFn } from '@crawlmouse/inngest/audit';
import { reconcileBillingFn, reconcileBillingManualFn, cleanupExpiredAuditsFn } from '@crawlmouse/inngest/billing';

// Each audit step runs as an HTTP invocation of this serve route, so the route's duration ceiling
// bounds a single crawl step. The Hobby default (~60s) kills large-site crawls mid-run; on Vercel
// Pro we raise it so deep crawls (near the 500-page free cap) can finish. Requires the Pro plan.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: workerInngest,
  functions: [auditFn, reconcileBillingFn, reconcileBillingManualFn, cleanupExpiredAuditsFn],
});
