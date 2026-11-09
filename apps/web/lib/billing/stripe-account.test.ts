import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/** A fresh module each time: the client is built once per process. */
async function load() {
  vi.resetModules();
  return import('./stripe-account');
}

beforeEach(() => vi.resetModules());

describe('stripeAccount', () => {
  it('builds the client for a test key in test mode outside production', async () => {
    const { stripeAccount } = await load();
    expect(stripeAccount({ STRIPE_ACCOUNT_SECRET_KEY: 'sk_test_x' })).toBeDefined();
  });

  it('builds the client for a live key in live mode in production', async () => {
    const { stripeAccount } = await load();
    const env = {
      STRIPE_ACCOUNT_SECRET_KEY: 'rk_live_x',
      STRIPE_ACCOUNT_LIVEMODE: 'true',
      VERCEL_ENV: 'production',
    };
    expect(stripeAccount(env)).toBeDefined();
  });

  it.each([
    [{}, 'STRIPE_ACCOUNT_SECRET_KEY is not set'],
    [{ STRIPE_ACCOUNT_SECRET_KEY: 'pk_test_x' }, 'is neither a live nor a test secret key'],
    [{ STRIPE_ACCOUNT_SECRET_KEY: 'sk_live_x' }, 'is not the mode STRIPE_ACCOUNT_LIVEMODE names'],
    [
      { STRIPE_ACCOUNT_SECRET_KEY: 'sk_test_x', STRIPE_ACCOUNT_LIVEMODE: 'true' },
      'is not the mode STRIPE_ACCOUNT_LIVEMODE names',
    ],
    // The sandbox's key and mode, set on the production deployment: test cards would buy plans.
    [{ STRIPE_ACCOUNT_SECRET_KEY: 'sk_test_x', VERCEL_ENV: 'production' }, 'live mode only'],
    // A preview holds the production database's service-role key (docs/ops/incident-plan.md): a test
    // card there would grant a plan in the production database.
    [
      {
        STRIPE_ACCOUNT_SECRET_KEY: 'sk_test_x',
        VERCEL_ENV: 'preview',
        NEXT_PUBLIC_SUPABASE_URL: 'https://ezspnfeyzwsisymytssm.supabase.co',
      },
      'live mode only',
    ],
  ])('refuses %j, naming no key', async (env, message) => {
    const { stripeAccount } = await load();
    expect(() => stripeAccount(env)).toThrow(message);
    try {
      stripeAccount(env);
    } catch (e) {
      expect((e as Error).message).not.toMatch(/_x\b/);
    }
  });

  it('allows test mode on a preview deployment over another database', async () => {
    const { stripeAccount } = await load();
    expect(
      stripeAccount({
        STRIPE_ACCOUNT_SECRET_KEY: 'sk_test_x',
        VERCEL_ENV: 'preview',
        NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      }),
    ).toBeDefined();
  });
});
