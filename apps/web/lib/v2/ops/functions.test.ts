import { describe, expect, it, vi } from 'vitest';
import {
  FOUNDER_DIGEST_FN_ID,
  FOUNDER_ENTITLEMENT_FN_ID,
  FOUNDER_SWEEP_FN_ID,
} from '../../../../../inngest/founder';
import { SIGNIN_CANARY_FN_ID } from '../../../../../inngest/signin-canary';
import { stripeAccount } from '../../billing/stripe-account';
import { founderDeps, opsFunctions, stripePayment, type StripeReads } from './functions';
import { requestSignInLink } from './sign-in-link';

// stripe-account.ts imports 'server-only', which throws outside Next.
vi.mock('server-only', () => ({}));

/** The service-role client production builds: Auth's user read and the canary's delivery look. */
const sb = vi.hoisted(() => ({
  auth: { admin: { getUserById: vi.fn() } },
  rpc: vi.fn(async () => ({ data: true, error: null })),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => sb) }));
vi.mock('./sign-in-link', () => ({ requestSignInLink: vi.fn(async () => 'sent') }));
vi.mock('../../billing/stripe-account', () => ({ stripeAccount: vi.fn() }));
const sentry = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  getClient: vi.fn((): unknown => ({})),
  flush: vi.fn(async () => true),
}));
vi.mock('@sentry/nextjs', () => sentry);

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.example',
  SUPABASE_SERVICE_ROLE_KEY: ['service', 'role', 'x'].join('_'),
};

const ids = (fns: readonly unknown[]) =>
  fns.flatMap((fn) =>
    (fn as { getConfig(o: { baseUrl: URL; appPrefix: string }): { id: string }[] })
      .getConfig({ baseUrl: new URL('https://example.com/api/inngest'), appPrefix: 'crawlmouse' })
      .map((c) => c.id),
  );

const FOUNDER_FNS = [FOUNDER_ENTITLEMENT_FN_ID, FOUNDER_SWEEP_FN_ID, FOUNDER_DIGEST_FN_ID];
/** Each founder function, followed by its failure handler (review M3). */
const FOUNDER = FOUNDER_FNS.flatMap((id) => [`crawlmouse-${id}`, `crawlmouse-${id}-failure`]);
const CANARY = `crawlmouse-${SIGNIN_CANARY_FN_ID}`;
const TO = ['canary', 'example.test'].join('@');
const signIn = async () => 'sent' as const;

describe('opsFunctions', () => {
  it('registers nothing unless V2_BILLING or V2_CHECKS_PUBLIC is 1', () => {
    for (const env of [{}, { V2_BILLING: '0' }, { V2_CHECKS_PUBLIC: 'true' }, { V2_PIPELINE: '1' }])
      expect(opsFunctions({ ...env, SIGNIN_CANARY_TO: TO }, signIn)).toEqual([]);
  });

  it('registers the founder functions with either flag', () => {
    expect(ids(opsFunctions({ V2_BILLING: '1' }))).toEqual(FOUNDER);
    expect(ids(opsFunctions({ V2_CHECKS_PUBLIC: '1' }))).toEqual(FOUNDER);
  });

  it('adds the canary only with SIGNIN_CANARY_TO one plain address', () => {
    expect(ids(opsFunctions({ V2_BILLING: '1', SIGNIN_CANARY_TO: TO }, signIn))).toEqual([
      ...FOUNDER,
      CANARY,
    ]);
    expect(ids(opsFunctions({ V2_BILLING: '1', SIGNIN_CANARY_TO: ` ${TO} ` }, signIn))).toContain(
      CANARY,
    );
    for (const to of [undefined, '', '  ', 'not-an-address', `${TO}, other@example.test`])
      expect(ids(opsFunctions({ V2_BILLING: '1', SIGNIN_CANARY_TO: to }, signIn))).not.toContain(
        CANARY,
      );
  });

  it('reports a founder function’s failed run to Sentry as founder-notice-failed, with its id (review M3)', async () => {
    const fns = opsFunctions({ ...ENV, V2_BILLING: '1' });
    for (const id of FOUNDER_FNS) {
      sentry.captureMessage.mockClear();
      const fn = fns.find((f) => ids([f])[0] === `crawlmouse-${id}`) as unknown as {
        onFailureFn: (c: unknown) => Promise<unknown>;
      };
      await fn.onFailureFn({
        event: {
          name: 'inngest/function.failed',
          data: { function_id: `crawlmouse-${id}`, run_id: 'run-1', error: { message: 'x' } },
        },
        error: new Error('x'),
        step: { run: async (_id: string, f: () => unknown) => f() },
      });
      expect(sentry.captureMessage.mock.calls).toEqual([
        [
          'founder-notice-failed',
          {
            level: 'error',
            tags: { signal: 'founder-notice-failed', function: id },
            extra: { runId: 'run-1' },
          },
        ],
      ]);
    }
  });

  it("asks for the canary's link through requestSignInLink unless another is given (review T5)", async () => {
    const fns = opsFunctions({ ...ENV, V2_BILLING: '1', SIGNIN_CANARY_TO: TO });
    const canary = fns.find((fn) => ids([fn])[0] === CANARY) as unknown as {
      fn: (c: unknown) => Promise<unknown>;
    };
    const step = {
      run: async (_id: string, fn: () => unknown) => fn(),
      sleep: async () => undefined,
    };
    expect(await canary.fn({ step })).toEqual({ requested: 'sent', delivered: true });
    expect(vi.mocked(requestSignInLink).mock.calls).toEqual([[TO]]);
  });
});

describe('founderDeps, as production wires D3 (review T2)', () => {
  it('has no recipient with FOUNDER_NOTIFY_TO unset, and the one set otherwise', () => {
    expect(founderDeps(ENV).to).toBeNull();
    const to = ['founder', 'example.test'].join('@');
    expect(founderDeps({ ...ENV, FOUNDER_NOTIFY_TO: to }).to).toBe(to);
  });

  it('reads confirmation from Auth’s email_confirmed_at: a user without one is not confirmed', async () => {
    const d = founderDeps(ENV);
    const user = (email_confirmed_at: string | null) => ({
      data: { user: { id: 'u1', email_confirmed_at } },
      error: null,
    });
    sb.auth.admin.getUserById.mockResolvedValueOnce(user('2026-11-13T10:00:00Z'));
    expect(await d.confirmed('u1')).toBe(true);
    sb.auth.admin.getUserById.mockResolvedValueOnce(user(null));
    expect(await d.confirmed('u1')).toBe(false);
    sb.auth.admin.getUserById.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect(await d.confirmed('u1')).toBe(false);
    sb.auth.admin.getUserById.mockResolvedValueOnce({
      data: { user: null },
      error: { status: 500 },
    });
    await expect(d.confirmed('u1')).rejects.toThrow('getUserById: 500');
    expect(sb.auth.admin.getUserById).toHaveBeenLastCalledWith('u1');
  });

  it('reads the payment from the deploy’s Stripe account', async () => {
    const latest = {
      id: 'in_1',
      status: 'open',
      amount_paid: 0,
      amount_due: 1900,
      currency: 'usd',
    };
    vi.mocked(stripeAccount).mockReturnValue({
      subscriptions: {
        retrieve: vi.fn(async () => ({ customer: 'cus_1', latest_invoice: latest })),
      },
      invoices: { list: vi.fn(async () => ({ data: [], has_more: false })) },
    } as unknown as ReturnType<typeof stripeAccount>);
    expect(await founderDeps(ENV).payment('sub_1')).toEqual({
      invoice: { status: 'open', amountPaid: 0, amountDue: 1900, currency: 'usd' },
      earlier: 'none',
    });
    expect(vi.mocked(stripeAccount)).toHaveBeenCalledWith(ENV);
  });
});

describe('stripePayment (review C2, C3)', () => {
  const SUB = 'sub_1';
  const CUSTOMER = 'cus_1';
  const invoice = (id: string, status: string, amountPaid: number, amountDue = amountPaid) => ({
    id,
    status,
    amount_paid: amountPaid,
    amount_due: amountDue,
    currency: 'usd',
  });

  function stripe(
    latest: ReturnType<typeof invoice> | null,
    paid: ReturnType<typeof invoice>[],
    hasMore = false,
  ) {
    const retrieve = vi.fn(async () => ({ customer: CUSTOMER, latest_invoice: latest }));
    const list = vi.fn(async () => ({ data: paid, has_more: hasMore }));
    return {
      reads: { subscriptions: { retrieve }, invoices: { list } } as unknown as StripeReads,
      retrieve,
      list,
    };
  }

  it('reads the latest invoice’s status and both amounts, and lists the customer’s paid invoices', async () => {
    const latest = invoice('in_latest', 'paid', 1900, 2500);
    const s = stripe(latest, [latest]);
    expect(await stripePayment(s.reads, SUB)).toEqual({
      invoice: { status: 'paid', amountPaid: 1900, amountDue: 2500, currency: 'usd' },
      earlier: 'none',
    });
    expect(s.retrieve).toHaveBeenCalledWith(SUB, { expand: ['latest_invoice'] });
    expect(s.list).toHaveBeenCalledWith({ customer: CUSTOMER, status: 'paid', limit: 10 });
  });

  it('does not count the latest invoice or a zero-amount one (a trial’s start) as an earlier payment', async () => {
    const latest = invoice('in_latest', 'paid', 1900);
    expect(
      (await stripePayment(stripe(latest, [latest, invoice('in_trial', 'paid', 0)]).reads, SUB))
        .earlier,
    ).toBe('none');
  });

  it('counts an earlier paid invoice with an amount, whether or not the latest is paid yet', async () => {
    const earlier = invoice('in_old', 'paid', 1900);
    for (const latest of [
      invoice('in_latest', 'paid', 1900),
      invoice('in_latest', 'open', 0, 1900),
    ])
      expect((await stripePayment(stripe(latest, [latest, earlier]).reads, SUB)).earlier).toBe(
        'some',
      );
  });

  it('says it cannot tell when the listing was cut before an earlier payment was found', async () => {
    const latest = invoice('in_latest', 'paid', 1900);
    expect(
      (await stripePayment(stripe(latest, [latest, invoice('in_0', 'paid', 0)], true).reads, SUB))
        .earlier,
    ).toBe('unknown');
  });

  it('answers no invoice when the subscription has none', async () => {
    expect(await stripePayment(stripe(null, []).reads, SUB)).toEqual({
      invoice: null,
      earlier: 'none',
    });
  });
});
