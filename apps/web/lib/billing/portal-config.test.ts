import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const h = vi.hoisted(() => ({ stripe: null as unknown }));
vi.mock('./stripe-account', () => ({ stripeAccount: () => h.stripe }));

import { accountPortalConfiguration, portalConfiguration, portalDrift } from './portal-config';

type Configuration = Stripe.BillingPortal.Configuration;

/** D8's portal: card, invoices, cancel at the period end with no proration; nothing else. */
const D8_FEATURES = {
  customer_update: { enabled: false, allowed_updates: [] },
  invoice_history: { enabled: true },
  payment_method_update: { enabled: true, payment_method_configuration: null },
  subscription_cancel: {
    enabled: true,
    mode: 'at_period_end',
    proration_behavior: 'none',
    cancellation_reason: { enabled: false, options: [] },
  },
  subscription_update: {
    enabled: false,
    default_allowed_updates: [],
    proration_behavior: 'none',
    billing_cycle_anchor: null,
    schedule_at_period_end: { conditions: [] },
    trial_update_behavior: 'end_trial',
  },
};

/** What the route sends Stripe to create or repair it, written out independently of the module. */
const SENT_FEATURES = {
  payment_method_update: { enabled: true },
  invoice_history: { enabled: true },
  subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
  subscription_update: { enabled: false },
  customer_update: { enabled: false },
};

function configuration(
  id: string,
  metadata: Record<string, string> | null,
  features: Record<string, unknown> = D8_FEATURES,
): Configuration {
  return { id, object: 'billing_portal.configuration', active: true, metadata, features } as never;
}

const OURS = { crawlmouse_key: 'portal_v2_billing' };
const DEFAULT = configuration(
  'bpc_default',
  { crawlmouse_key: 'portal_default' },
  {
    ...D8_FEATURES,
    customer_update: { enabled: true, allowed_updates: ['email', 'address'] },
    subscription_update: { ...D8_FEATURES.subscription_update, enabled: true },
  },
);

function stripeWith(
  listed: Configuration[],
  answers: { create?: Configuration; update?: Configuration } = {},
) {
  const list = vi.fn((_params: Stripe.BillingPortal.ConfigurationListParams) =>
    (async function* () {
      yield* listed;
    })(),
  );
  const create = vi.fn(
    async (_p: Stripe.BillingPortal.ConfigurationCreateParams) => answers.create!,
  );
  const update = vi.fn(
    async (_id: string, _p: Stripe.BillingPortal.ConfigurationUpdateParams) => answers.update!,
  );
  return {
    list,
    create,
    update,
    stripe: { billingPortal: { configurations: { list, create, update } } },
  };
}

describe('portalConfiguration', () => {
  it('uses the active configuration tagged portal_v2_billing, and writes nothing', async () => {
    const s = stripeWith([DEFAULT, configuration('bpc_ours', OURS)]);
    expect(await portalConfiguration(s.stripe)).toBe('bpc_ours');
    expect(s.list.mock.calls).toEqual([[{ active: true, limit: 100 }]]);
    expect(s.create).not.toHaveBeenCalled();
    expect(s.update).not.toHaveBeenCalled();
  });

  it("creates it with D8's features when there is none, leaving the default alone", async () => {
    const s = stripeWith([DEFAULT, configuration('bpc_untagged', null)], {
      create: configuration('bpc_new', OURS),
    });
    expect(await portalConfiguration(s.stripe)).toBe('bpc_new');
    expect(s.create.mock.calls).toEqual([[{ features: SENT_FEATURES, metadata: OURS }]]);
    expect(s.update).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, unknown>]>([
    ['customer_update on', { customer_update: { enabled: true, allowed_updates: ['email'] } }],
    [
      'subscription_update on',
      { subscription_update: { ...D8_FEATURES.subscription_update, enabled: true } },
    ],
    ['invoice_history off', { invoice_history: { enabled: false } }],
    [
      'payment_method_update off',
      { payment_method_update: { enabled: false, payment_method_configuration: null } },
    ],
    [
      'cancellation at once',
      { subscription_cancel: { ...D8_FEATURES.subscription_cancel, mode: 'immediately' } },
    ],
    [
      'cancellation with prorations',
      {
        subscription_cancel: {
          ...D8_FEATURES.subscription_cancel,
          proration_behavior: 'create_prorations',
        },
      },
    ],
    [
      'cancellation off',
      { subscription_cancel: { ...D8_FEATURES.subscription_cancel, enabled: false } },
    ],
  ])('updates a tagged configuration with %s back to D8', async (_, change) => {
    const s = stripeWith([configuration('bpc_ours', OURS, { ...D8_FEATURES, ...change })], {
      update: configuration('bpc_ours', OURS),
    });
    expect(await portalConfiguration(s.stripe)).toBe('bpc_ours');
    expect(s.update.mock.calls).toEqual([['bpc_ours', { features: SENT_FEATURES }]]);
    expect(s.create).not.toHaveBeenCalled();
  });

  it('refuses a configuration a feature the update does not name still leaves on', async () => {
    const paused = configuration('bpc_ours', OURS, {
      ...D8_FEATURES,
      subscription_pause: { enabled: true },
    });
    const s = stripeWith([paused], { update: paused });
    await expect(portalConfiguration(s.stripe)).rejects.toThrow(
      'portal configuration bpc_ours: subscription_pause is on',
    );
    expect(s.update).toHaveBeenCalledTimes(1);
  });

  it('refuses a created configuration Stripe answers with other features', async () => {
    const s = stripeWith([], { create: configuration('bpc_new', OURS, DEFAULT.features as never) });
    await expect(portalConfiguration(s.stripe)).rejects.toThrow(
      'portal configuration bpc_new: customer_update is on; subscription_update is on',
    );
  });
});

describe('portalDrift', () => {
  it("is empty for D8's configuration", () => {
    expect(portalDrift(configuration('bpc_ours', OURS))).toEqual([]);
  });

  it('names a feature that is not disabled by saying so', () => {
    expect(
      portalDrift(configuration('bpc_ours', OURS, { ...D8_FEATURES, subscription_pause: {} })),
    ).toEqual(['subscription_pause is on']);
  });
});

describe('accountPortalConfiguration', () => {
  it('is found once per process, and a failure is not kept', async () => {
    const list = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Stripe is down');
      })
      .mockImplementation(() =>
        (async function* () {
          yield configuration('bpc_ours', OURS);
        })(),
      );
    h.stripe = { billingPortal: { configurations: { list } } };
    await expect(accountPortalConfiguration()).rejects.toThrow('Stripe is down');
    expect(await accountPortalConfiguration()).toBe('bpc_ours');
    expect(await accountPortalConfiguration()).toBe('bpc_ours');
    expect(list).toHaveBeenCalledTimes(2);
  });
});
