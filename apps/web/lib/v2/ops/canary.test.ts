import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  getClient: vi.fn((): unknown => ({})),
  flush: vi.fn(async () => true),
}));
vi.mock('@sentry/nextjs', () => sentry);

import { SIGNIN_SENDER } from '../../auth/constants';
import { canaryWork, reportCanary } from './canary';

const TO = ['canary', 'example.test'].join('@');
const AT = '2026-11-13T12:00:00.000Z';

beforeEach(() => {
  vi.clearAllMocks();
  sentry.getClient.mockReturnValue({});
  sentry.flush.mockResolvedValue(true);
});

describe('canaryWork', () => {
  it('asks for a link to the canary address, and looks with signin_delivery_seen for the sign-in sender from the request time', async () => {
    const signIn = vi.fn(async () => 'sent' as const);
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const report = vi.fn(async () => undefined);
    const w = canaryWork({ to: TO, signIn, sb: { rpc } as never, now: () => new Date(AT), report });
    expect(await w.request()).toBe('sent');
    expect(signIn).toHaveBeenCalledWith(TO);
    expect(await w.delivered(AT)).toBe(true);
    expect(rpc).toHaveBeenCalledWith('signin_delivery_seen', {
      p_address: TO,
      p_sender: SIGNIN_SENDER,
      p_since: AT,
    });
    expect(w.now().toISOString()).toBe(AT);
    await w.report('delivery');
    expect(report).toHaveBeenCalledWith('delivery');
  });

  it('answers false for anything but true, and throws on a database error so the step retries', async () => {
    const w = (answer: unknown) =>
      canaryWork({
        to: TO,
        signIn: async () => 'sent',
        sb: { rpc: async () => answer } as never,
        now: () => new Date(AT),
        report: async () => undefined,
      });
    expect(await w({ data: false, error: null }).delivered(AT)).toBe(false);
    expect(await w({ data: null, error: null }).delivered(AT)).toBe(false);
    await expect(w({ data: null, error: { code: '42501' } }).delivered(AT)).rejects.toThrow(
      /signin_delivery_seen: 42501/,
    );
  });
});

describe('reportCanary', () => {
  it('raises signin-canary at level error, tagged with its signal and stage, with no address', async () => {
    await reportCanary('delivery');
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage).toHaveBeenCalledWith('signin-canary', {
      level: 'error',
      tags: { signal: 'signin-canary', stage: 'delivery' },
    });
    expect(JSON.stringify(sentry.captureMessage.mock.calls)).not.toContain('@');
    expect(sentry.flush).toHaveBeenCalled();
  });

  it.each(['request_error', 'look_error'] as const)(
    'raises the canary’s own failure under its stage, %s',
    async (stage) => {
      await reportCanary(stage);
      expect(sentry.captureMessage).toHaveBeenCalledWith('signin-canary', {
        level: 'error',
        tags: { signal: 'signin-canary', stage },
      });
    },
  );

  it('throws when the signal is not flushed, so the step runs again', async () => {
    sentry.flush.mockResolvedValue(false);
    await expect(reportCanary('request')).rejects.toThrow(/not flushed/);
  });

  it('logs, without an address, when Sentry has no client', async () => {
    sentry.getClient.mockReturnValue(undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await reportCanary('request');
    expect(sentry.flush).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({ event: 'ops.signin_canary', stage: 'request', sentry: 0 }),
    );
    error.mockRestore();
  });
});
