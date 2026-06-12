import * as Sentry from '@sentry/nextjs';

/**
 * Emits the `audit-failed` observability signal when an audit permanently fails (after Inngest
 * retries are exhausted). Wired into the worker via `setAuditFailureReporter` in the Inngest serve
 * route, so the worker package stays Sentry-agnostic. Mirrors the `stripe-webhook-sig-fail` pattern:
 * a low-noise warning carrying a `signal` tag that the prod Sentry alert rule fires on.
 */
export function sentryAuditFailureReporter({ auditId, reason }: { auditId: string; reason: string }): void {
  Sentry.captureMessage('audit.failed', {
    level: 'warning',
    tags: { signal: 'audit-failed' },
    // `reason` is a raw crawl error message (the audited URL is user-controlled input), so bound it
    // before it reaches the error-tracking subprocessor — operator telemetry, never a user surface.
    extra: { auditId, reason: reason.slice(0, 500) },
  });
}
