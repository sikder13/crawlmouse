import { serve } from 'inngest/next';
import { inngest as workerInngest } from '@crawlmouse/inngest';
import { auditFn, setAuditFailureReporter, setCrawlHealthReporter } from '@crawlmouse/inngest/audit';
import { reconcileBillingFn, reconcileBillingManualFn, cleanupExpiredAuditsFn } from '@crawlmouse/inngest/billing';
import { sentryAuditFailureReporter } from '@/lib/audit-failure-sentry';
import { sentryCrawlHealthReporter } from '@/lib/audit-crawl-health-telemetry';

// Wire the worker's failure-reporter seam to the app's Sentry client (which is initialized here in
// the Next runtime). This module loads before any Inngest invocation it serves, so the reporter is
// registered before auditFn's onFailure can fire — a permanently-failed audit then emits the
// `signal: audit-failed` event the prod alert rule watches. Kept out of @crawlmouse/inngest so that
// package carries no Sentry dependency.
setAuditFailureReporter(sentryAuditFailureReporter);

// Wire the worker's crawl-health seam (SPEC 01 §10) to the app's Sentry client too. Fires only for
// v2 audits (the worker gates on result.crawlHealth), so this is inert on the v1 prod path until the
// ENGINE_V2 flip. Separate `signal: crawl-degraded` tag — the `audit-failed` path above is unchanged.
setCrawlHealthReporter(sentryCrawlHealthReporter);

// This route runs the audit worker (crawlee), which requires the Node.js runtime — never Edge. Pin
// it explicitly (matching the Stripe webhook route) so a future default change can't move it.
export const runtime = 'nodejs';

// Each audit step runs as an HTTP invocation of this serve route, so the route's duration ceiling
// bounds a single crawl step. The Hobby default (~60s) kills large-site crawls mid-run; on Vercel
// Pro we raise it so deep crawls (near the 500-page free cap) can finish. Requires the Pro plan.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: workerInngest,
  functions: [auditFn, reconcileBillingFn, reconcileBillingManualFn, cleanupExpiredAuditsFn],
});
