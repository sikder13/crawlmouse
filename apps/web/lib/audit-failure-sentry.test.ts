import { describe, it, expect, vi, beforeEach } from 'vitest';

const captureMessage = vi.fn();
vi.mock('@sentry/nextjs', () => ({ captureMessage: (...args: unknown[]) => captureMessage(...args) }));

import { sentryAuditFailureReporter } from './audit-failure-sentry';

describe('sentryAuditFailureReporter', () => {
  beforeEach(() => captureMessage.mockClear());

  it('emits a warning tagged signal=audit-failed carrying the auditId + reason', () => {
    sentryAuditFailureReporter({ auditId: 'aud-7', reason: 'spawn ps ENOENT' });
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [msg, opts] = captureMessage.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toBe('audit.failed');
    expect(opts.level).toBe('warning');
    // The alert rule fires on this exact tag; it must match the Sentry alert filter value.
    expect(opts.tags).toEqual({ signal: 'audit-failed' });
    expect(opts.extra).toEqual({ auditId: 'aud-7', reason: 'spawn ps ENOENT' });
  });

  it('bounds an overlong reason before sending it to Sentry (the audited URL is user input)', () => {
    sentryAuditFailureReporter({ auditId: 'a', reason: 'x'.repeat(5000) });
    const [, opts] = captureMessage.mock.calls[0] as [string, Record<string, unknown>];
    expect((opts.extra as { reason: string }).reason.length).toBe(500);
  });
});
