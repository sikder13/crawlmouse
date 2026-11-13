import { describe, expect, it, vi } from 'vitest';
import {
  FOUNDER_DIGEST_FN_ID,
  FOUNDER_ENTITLEMENT_FN_ID,
  FOUNDER_SWEEP_FN_ID,
} from '../../../../../inngest/founder';
import { SIGNIN_CANARY_FN_ID } from '../../../../../inngest/signin-canary';
import { opsFunctions, stripePayment, type StripeReads } from './functions';

// stripe-account.ts imports 'server-only', which throws outside Next.
vi.mock('server-only', () => ({}));

const ids = (fns: readonly unknown[]) =>
  fns.flatMap((fn) =>
    (fn as { getConfig(o: { baseUrl: URL; appPrefix: string }): { id: string }[] })
      .getConfig({ baseUrl: new URL('https://example.com/api/inngest'), appPrefix: 'crawlmouse' })
      .map((c) => c.id),
  );

const FOUNDER = [FOUNDER_ENTITLEMENT_FN_ID, FOUNDER_SWEEP_FN_ID, FOUNDER_DIGEST_FN_ID].map(
  (id) => `crawlmouse-${id}`,
);
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

  it("asks for the canary's link through requestSignInLink unless another is given", () => {
    expect(ids(opsFunctions({ V2_BILLING: '1', SIGNIN_CANARY_TO: TO }))).toContain(CANARY);
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
