import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  send: vi.fn(async (_events: unknown) => undefined),
  retrieve: vi.fn(async (_id: string) => ({ status: 'active' })),
  cancel: vi.fn(async (_id: string, _params: unknown, _opts: unknown) => ({})),
  capture: vi.fn(),
  flush: vi.fn(async (_ms: number) => true),
  client: { name: 'client' } as unknown,
  posthog: vi.fn(async (_body: unknown) => undefined),
  internal: vi.fn(async (_distinctId: string, _accountId: unknown) => false),
}));

vi.mock('server-only', () => ({}));
vi.mock('../../../../inngest/client', () => ({ inngest: { send: h.send } }));
vi.mock('@sentry/nextjs', () => ({
  captureMessage: h.capture,
  flush: h.flush,
  getClient: () => h.client,
}));
// The real captureServerEvent runs; PostHog's endpoint and the internal-account lookup are fakes.
vi.mock('../analytics-server', async (original) => ({
  ...(await original<typeof import('../analytics-server')>()),
  posthogSend: h.posthog,
}));
vi.mock('../v2/ops/internal-marker', () => ({ isInternalEvent: h.internal }));
vi.mock('./stripe-account', () => ({
  stripeAccount: () => ({ subscriptions: { retrieve: h.retrieve, cancel: h.cancel } }),
}));

import { billingDispatcher, productionSinks } from './effect-sinks';

beforeEach(() => {
  vi.clearAllMocks();
  h.client = { name: 'client' };
  h.flush.mockResolvedValue(true);
  h.retrieve.mockResolvedValue({ status: 'active' });
  h.internal.mockResolvedValue(false);
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

describe('productionSinks capture', () => {
  const capture = {
    kind: 'capture' as const,
    uuid: 'f81a0237-f9f2-55b2-8a80-e46dd9bad046',
    event: 'payment_failed' as const,
    distinctId: 'user-1',
    accountId: 'acct-1',
    timestamp: '2099-01-01T00:00:00.000Z',
    properties: { plan: 'pro' as const, attempt: 2 },
  };

  it('posts the planned body: the owner, the planned uuid and time, account_id, no person profile', async () => {
    await productionSinks().capture!(capture);
    expect(h.posthog.mock.calls).toEqual([
      [
        {
          event: 'payment_failed',
          distinct_id: 'user-1',
          uuid: 'f81a0237-f9f2-55b2-8a80-e46dd9bad046',
          timestamp: '2099-01-01T00:00:00.000Z',
          properties: {
            plan: 'pro',
            attempt: 2,
            account_id: 'acct-1',
            $process_person_profile: false,
            $geoip_disable: true,
          },
        },
      ],
    ]);
    expect(h.internal.mock.calls.map((c) => c.slice(0, 2))).toEqual([['user-1', 'acct-1']]);
  });

  it('posts the same body for the same planned capture', async () => {
    await productionSinks().capture!(capture);
    await productionSinks().capture!(capture);
    expect(JSON.stringify(h.posthog.mock.calls[1])).toBe(JSON.stringify(h.posthog.mock.calls[0]));
  });

  it("marks an internal account's event", async () => {
    h.internal.mockResolvedValue(true);
    await productionSinks().capture!(capture);
    expect((h.posthog.mock.calls[0]![0] as { properties: object }).properties).toMatchObject({
      internal: true,
    });
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
