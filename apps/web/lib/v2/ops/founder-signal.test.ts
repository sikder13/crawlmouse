import { beforeEach, describe, expect, it, vi } from 'vitest';

// A client as Sentry.init builds it: getDsn() is the parsed DSN, or undefined when none was given.
const { DSN_CLIENT, NO_DSN_CLIENT } = vi.hoisted(() => ({
  DSN_CLIENT: { getDsn: () => ({ host: 'o0.ingest.example.test', projectId: '1' }) },
  NO_DSN_CLIENT: { getDsn: () => undefined },
}));
const sentry = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  getClient: vi.fn((): unknown => DSN_CLIENT),
  flush: vi.fn(async () => true),
}));
vi.mock('@sentry/nextjs', () => sentry);

import { FOUNDER_ENTITLEMENT_FN_ID } from '../../../../../inngest/founder';
import { reportFounderFailure } from './founder-signal';

const RUN = '01J0000000000000000000RUN1';

beforeEach(() => {
  vi.clearAllMocks();
  sentry.getClient.mockReturnValue(DSN_CLIENT);
  sentry.flush.mockResolvedValue(true);
});

describe('reportFounderFailure (review M3)', () => {
  it('raises founder-notice-failed at level error, tagged with its signal and the function, with the run id', async () => {
    await reportFounderFailure({ fnId: FOUNDER_ENTITLEMENT_FN_ID, runId: RUN });
    expect(sentry.captureMessage.mock.calls).toEqual([
      [
        'founder-notice-failed',
        {
          level: 'error',
          tags: { signal: 'founder-notice-failed', function: 'crawlmouse.founder.entitlement' },
          extra: { runId: RUN },
        },
      ],
    ]);
    expect(JSON.stringify(sentry.captureMessage.mock.calls)).not.toContain('@');
    expect(sentry.flush).toHaveBeenCalled();
  });

  it('throws when the signal is not flushed, so Inngest runs the failure handler again', async () => {
    sentry.flush.mockResolvedValue(false);
    await expect(
      reportFounderFailure({ fnId: FOUNDER_ENTITLEMENT_FN_ID, runId: RUN }),
    ).rejects.toThrow(/not flushed/);
  });

  it('logs the function, and no address, when Sentry has no client', async () => {
    sentry.getClient.mockReturnValue(undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await reportFounderFailure({ fnId: FOUNDER_ENTITLEMENT_FN_ID, runId: RUN });
    expect(sentry.flush).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'ops.founder_failed',
        function: 'crawlmouse.founder.entitlement',
        run: RUN,
        sentry: 0,
      }),
    );
    error.mockRestore();
  });

  it('logs the function, and no address, when Sentry has a client with no DSN (review r4 S1)', async () => {
    sentry.getClient.mockReturnValue(NO_DSN_CLIENT);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await reportFounderFailure({ fnId: FOUNDER_ENTITLEMENT_FN_ID, runId: RUN });
    expect(sentry.flush).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'ops.founder_failed',
        function: 'crawlmouse.founder.entitlement',
        run: RUN,
        sentry: 0,
      }),
    );
    error.mockRestore();
  });
});
