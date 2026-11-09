import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  send: vi.fn(async (_events: unknown) => undefined),
  retrieve: vi.fn(async (_id: string) => ({ status: 'active' })),
  cancel: vi.fn(async (_id: string, _params: unknown, _opts: unknown) => ({})),
  capture: vi.fn(),
  flush: vi.fn(async (_ms: number) => true),
  client: { name: 'client' } as unknown,
}));

vi.mock('server-only', () => ({}));
vi.mock('@crawlmouse/inngest', () => ({ inngest: { send: h.send } }));
vi.mock('@sentry/nextjs', () => ({
  captureMessage: h.capture,
  flush: h.flush,
  getClient: () => h.client,
}));
vi.mock('./stripe-account', () => ({
  stripeAccount: () => ({ subscriptions: { retrieve: h.retrieve, cancel: h.cancel } }),
}));

import { billingDispatcher, productionSinks } from './effect-sinks';

beforeEach(() => {
  vi.clearAllMocks();
  h.client = { name: 'client' };
  h.flush.mockResolvedValue(true);
  h.retrieve.mockResolvedValue({ status: 'active' });
});

describe('productionSinks', () => {
  it('cancels a live subscription at once, without proration, under its idempotency key', async () => {
    await productionSinks().cancel({
      kind: 'cancel',
      subscriptionId: 'sub_9',
      reason: 'orphaned',
      source: 'evt_1',
    });
    expect(h.cancel).toHaveBeenCalledWith(
      'sub_9',
      { prorate: false },
      { idempotencyKey: 'cancel:sub_9:orphaned' },
    );
  });

  it.each(['canceled', 'incomplete_expired'])('leaves a %s subscription alone', async (status) => {
    h.retrieve.mockResolvedValue({ status });
    await productionSinks().cancel({
      kind: 'cancel',
      subscriptionId: 'sub_9',
      reason: 'disputed',
      source: 'evt_1',
    });
    expect(h.cancel).not.toHaveBeenCalled();
  });

  const alert = {
    kind: 'alert' as const,
    reason: 'orphaned_subscription' as const,
    accountId: null,
    subscriptionId: 'sub_9',
    source: 'evt_1',
  };

  it('raises the alert under its own signal and waits for Sentry to take it', async () => {
    await productionSinks().alert(alert);
    expect(h.capture).toHaveBeenCalledWith('billing.orphaned_subscription', {
      level: 'error',
      tags: { signal: 'billing-orphaned-subscription' },
      extra: { accountId: null, subscriptionId: 'sub_9', source: 'evt_1' },
    });
    expect(h.flush).toHaveBeenCalledWith(2000);
  });

  it('fails when Sentry has not taken the alert in time', async () => {
    h.flush.mockResolvedValue(false);
    await expect(productionSinks().alert(alert)).rejects.toThrow('not flushed in time');
  });

  it('does not fail where Sentry is off, and logs the alert instead', async () => {
    h.client = undefined;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await productionSinks().alert(alert);
    expect(h.flush).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      '[billing] orphaned_subscription alert with Sentry off',
      'evt_1',
    );
    log.mockRestore();
  });
});

describe('billingDispatcher', () => {
  const plan = [
    {
      kind: 'send' as const,
      id: 'trial.converted:a:s',
      name: 'trial.converted' as const,
      data: { accountId: 'a' },
    },
  ];

  it('sends nothing with V2_BILLING unset', async () => {
    await billingDispatcher({})(plan);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('sends the plan with V2_BILLING=1', async () => {
    await billingDispatcher({ V2_BILLING: '1' })(plan);
    expect(h.send).toHaveBeenCalledWith([
      { id: 'trial.converted:a:s', name: 'trial.converted', data: { accountId: 'a' } },
    ]);
  });
});
