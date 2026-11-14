import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { fakeCatalog } from '../../apps/web/lib/billing/catalog.fake';
import { agencyTrial } from '../../apps/web/lib/billing/agency-trial';
import { checkoutV2, type CheckoutDeps } from '../../apps/web/lib/billing/checkout-v2';
import { FREE_START } from '../../apps/web/lib/billing/state-machine';
import { StripeFake, payloads, stripeEvent } from '../../apps/web/lib/billing/stripe.fake';
import { applyStripeEvent } from '../../apps/web/lib/billing/stripe-webhook';
import { pgliteWebhookDb } from '../../apps/web/lib/billing/webhook-db.pglite';
import { QA_ACCOUNTS, type QaKey } from './accounts';
import {
  COUPON_ID,
  livePhrase,
  seedBilling,
  sessionParams,
  type BillingDeps,
  type BillingStripe,
} from './billing';
import { exitCode, seed } from './seed';
import { qaBillingAccounts } from './store';
import { withMarker, world } from './test-support';

/**
 * CC-38 D1(b), `qa:seed --billing`: its refusals, a second run, parity with the app's own Checkout
 * Session (`startCheckout` through `checkoutV2` and `agencyTrial`), and the plan carried by the real
 * webhook handler on PGlite.
 *   pnpm --filter @crawlmouse/scripts exec vitest run qa/billing.test.ts
 */

const NOW = new Date('2026-11-14T12:00:00.000Z');
const ORIGIN = 'https://crawlmouse.test';
const BILLED = QA_ACCOUNTS.filter((a) => a.billing !== null).map((a) => a.key);
const catalog = fakeCatalog();

interface FakeSession {
  id: string;
  customer: string;
  status: 'open' | 'expired';
  params: Stripe.Checkout.SessionCreateParams;
}

/** The Stripe calls `--billing` makes, in memory, each recorded by name. */
class BillingStripeFake implements BillingStripe {
  livemode = false;
  readonly calls: string[] = [];
  readonly couponsHeld = new Map<string, Stripe.CouponCreateParams & { valid: boolean }>();
  readonly customersHeld = new Map<string, { id: string; metadata: Stripe.Metadata }>();
  readonly customerCreates: { params: Stripe.CustomerCreateParams; key: string }[] = [];
  readonly byKey = new Map<string, string>();
  readonly sessions: FakeSession[] = [];

  balance = {
    retrieve: async () => {
      this.calls.push('balance.retrieve');
      return { livemode: this.livemode };
    },
  };

  coupons = {
    retrieve: async (id: string) => {
      this.calls.push('coupons.retrieve');
      const c = this.couponsHeld.get(id);
      if (!c) {
        throw Object.assign(new Error(`No such coupon: '${id}'`), {
          type: 'StripeInvalidRequestError',
          code: 'resource_missing',
        });
      }
      return {
        id,
        percent_off: c.percent_off ?? null,
        duration: c.duration ?? 'once',
        valid: c.valid,
      } as Pick<Stripe.Coupon, 'id' | 'percent_off' | 'duration' | 'valid'>;
    },
    create: async (params: Stripe.CouponCreateParams) => {
      this.calls.push('coupons.create');
      this.couponsHeld.set(params.id!, { ...params, valid: true });
      return { id: params.id! };
    },
  };

  customers = {
    retrieve: async (id: string) => {
      this.calls.push('customers.retrieve');
      const c = this.customersHeld.get(id);
      if (!c) throw new Error(`no customer ${id}`);
      return c;
    },
    create: async (params: Stripe.CustomerCreateParams, options: { idempotencyKey: string }) => {
      this.calls.push('customers.create');
      this.customerCreates.push({ params, key: options.idempotencyKey });
      const held = this.byKey.get(options.idempotencyKey);
      if (held) return { id: held };
      const id = `cus_qa${this.customersHeld.size + 1}`;
      this.customersHeld.set(id, { id, metadata: { ...(params.metadata as Stripe.Metadata) } });
      this.byKey.set(options.idempotencyKey, id);
      return { id };
    },
  };

  checkout = {
    sessions: {
      list: (params: Stripe.Checkout.SessionListParams) => {
        this.calls.push('sessions.list');
        const hits = this.sessions.filter(
          (s) => s.customer === params.customer && s.status === params.status,
        );
        return (async function* () {
          for (const s of hits) yield { id: s.id };
        })();
      },
      expire: async (id: string) => {
        this.calls.push('sessions.expire');
        const s = this.sessions.find((x) => x.id === id)!;
        s.status = 'expired';
        return s;
      },
      create: async (params: Stripe.Checkout.SessionCreateParams) => {
        this.calls.push('sessions.create');
        const id = `cs_qa${this.sessions.length + 1}`;
        this.sessions.push({ id, customer: params.customer!, status: 'open', params });
        return { url: `https://checkout.stripe.test/c/pay/${id}` };
      },
    },
  };

  open(): FakeSession[] {
    return this.sessions.filter((s) => s.status === 'open');
  }
}

const accountIdOf = (key: QaKey) =>
  `00000000-0000-4000-8000-${String(QA_ACCOUNTS.findIndex((a) => a.key === key)).padStart(12, '0')}`;

interface Unit {
  deps: BillingDeps;
  stripe: BillingStripeFake;
  lines: string[];
  asked: string[];
  marked: Map<string, QaKey | null>;
  internal: Map<string, boolean>;
  customerOf: Map<string, string | null>;
}

/** `--billing` over fakes: every account present, marked and internal unless a test says otherwise. */
function unit(): Unit {
  const stripe = new BillingStripeFake();
  const lines: string[] = [];
  const asked: string[] = [];
  const marked = new Map<string, QaKey | null>(BILLED.map((k) => [accountIdOf(k), k]));
  const internal = new Map<string, boolean>(BILLED.map((k) => [accountIdOf(k), true]));
  const customerOf = new Map<string, string | null>();
  const keyOfUser = (userId: string) => userId.replace(/^user-/, '') as QaKey;
  const deps: BillingDeps = {
    auth: {
      async find(email) {
        const key = /\+([a-z-]+)@/.exec(email)![1] as QaKey;
        return { id: `user-${key}`, qaKey: key };
      },
    },
    store: {
      async personal(userId) {
        return { accountId: accountIdOf(keyOfUser(userId)), ownerSeatId: 'seat' };
      },
      async agency(userId) {
        return { accountId: accountIdOf(keyOfUser(userId)), ownerSeatId: 'seat' };
      },
      async marker(accountId) {
        return marked.get(accountId) ?? null;
      },
      async isInternal(accountId) {
        return internal.get(accountId) ?? false;
      },
    },
    accounts: {
      async read(accountId) {
        return { snapshot: FREE_START, stripeCustomerId: customerOf.get(accountId) ?? null };
      },
    },
    stripe,
    keyLive: false,
    priceFor: (plan, interval) => catalog.priceFor(plan, interval, 'base'),
    origin: ORIGIN,
    inbox: { local: 'qa', domain: 'example.test' },
    now: () => NOW,
    confirm: async (prompt) => {
      asked.push(prompt);
      lines.push('<asked>');
      return '';
    },
    print: (l) => lines.push(l),
  };
  return { deps, stripe, lines, asked, marked, internal, customerOf };
}

/** Nothing opened or created at Stripe: only reads. */
const writes = (s: BillingStripeFake) => s.calls.filter((c) => /create|expire/.test(c));

describe('qa:seed --billing: refusals', () => {
  it('refuses a live key without --live, before any account is read or anything opened', async () => {
    const u = unit();
    u.deps.keyLive = true;
    u.stripe.livemode = true;
    const steps = await seedBilling(u.deps, { live: false });
    expect(steps).toEqual([
      expect.objectContaining({ key: 'run', step: 'stopped', outcome: 'refused' }),
    ]);
    expect(steps[0]!.detail).toMatch(/--live/);
    expect(u.stripe.calls).toEqual(['balance.retrieve']);
    expect(exitCode(steps)).toBe(1);
  });

  it('refuses --live with a test key', async () => {
    const u = unit();
    const steps = await seedBilling(u.deps, { live: true });
    expect(steps.map((s) => [s.step, s.outcome])).toEqual([['stopped', 'refused']]);
    expect(steps[0]!.detail).toMatch(/test key/);
    expect(writes(u.stripe)).toEqual([]);
  });

  it('refuses a key whose prefix and the API disagree, both ways', async () => {
    for (const [keyLive, apiLive] of [
      [true, false],
      [false, true],
    ] as const) {
      const u = unit();
      u.deps.keyLive = keyLive;
      u.stripe.livemode = apiLive;
      for (const live of [false, true]) {
        const steps = await seedBilling(u.deps, { live });
        expect(steps.map((s) => s.outcome)).toEqual(['refused']);
        expect(steps[0]!.detail).toMatch(/disagree/);
      }
      expect(writes(u.stripe)).toEqual([]);
    }
  });

  it('in live mode prints the accounts, then asks, and refuses anything but the exact phrase', async () => {
    for (const typed of [
      '',
      'yes',
      `${livePhrase(BILLED.length)} `,
      livePhrase(BILLED.length - 1),
    ]) {
      const u = unit();
      u.deps.keyLive = true;
      u.stripe.livemode = true;
      u.deps.confirm = async (p) => {
        u.asked.push(p);
        u.lines.push('<asked>');
        return typed;
      };
      const steps = await seedBilling(u.deps, { live: true });
      expect(steps.map((s) => s.outcome)).toEqual(['refused']);
      expect(writes(u.stripe)).toEqual([]);
      // Every billed account's address is printed before the question is asked.
      const askedAt = u.lines.indexOf('<asked>');
      for (const k of BILLED) {
        const at = u.lines.findIndex((l) => l.includes(`qa+${k}@example.test`));
        expect(at).toBeGreaterThanOrEqual(0);
        expect(at).toBeLessThan(askedAt);
      }
      expect(u.asked).toEqual([`Type "${livePhrase(BILLED.length)}" to go on: `]);
    }
  });

  it('in live mode with the phrase typed, opens a session for each billed account', async () => {
    const u = unit();
    u.deps.keyLive = true;
    u.stripe.livemode = true;
    u.deps.confirm = async () => livePhrase(BILLED.length);
    const steps = await seedBilling(u.deps, { live: true });
    expect(exitCode(steps)).toBe(0);
    expect(u.stripe.open().map((s) => s.params.client_reference_id)).toEqual(
      BILLED.map(accountIdOf),
    );
  });

  it('refuses an INTERNAL-QA coupon that is not 100% off forever, and opens nothing', async () => {
    for (const wrong of [
      { percent_off: 50, duration: 'forever' as const, valid: true },
      { percent_off: 100, duration: 'once' as const, valid: true },
      { percent_off: 100, duration: 'forever' as const, valid: false },
    ]) {
      const u = unit();
      u.stripe.couponsHeld.set(COUPON_ID, { id: COUPON_ID, ...wrong });
      const steps = await seedBilling(u.deps, { live: false });
      expect(steps.at(-1)).toEqual(
        expect.objectContaining({ key: 'run', step: 'stopped', outcome: 'refused' }),
      );
      expect(writes(u.stripe)).toEqual([]);
    }
  });

  it('refuses an account without its qa_accounts row, and one that is not internal', async () => {
    const u = unit();
    u.marked.set(accountIdOf('pro'), null);
    u.internal.set(accountIdOf('demo'), false);
    const steps = await seedBilling(u.deps, { live: false });
    const refused = steps.filter((s) => s.outcome === 'refused');
    expect(refused.map((s) => s.key)).toEqual(['pro', 'demo']);
    expect(refused[0]!.detail).toMatch(/qa_accounts/);
    expect(refused[1]!.detail).toMatch(/not internal/);
    const opened = u.stripe.sessions.map((s) => s.params.client_reference_id);
    expect(opened).toEqual([accountIdOf('agency'), accountIdOf('agencytrial')]);
    expect(exitCode(steps)).toBe(1);
  });

  it('refuses a stored customer that does not carry internal=true', async () => {
    const u = unit();
    u.stripe.customersHeld.set('cus_theirs', { id: 'cus_theirs', metadata: {} });
    u.customerOf.set(accountIdOf('pro'), 'cus_theirs');
    const steps = await seedBilling(u.deps, { live: false });
    expect(steps.filter((s) => s.outcome === 'refused').map((s) => s.key)).toEqual(['pro']);
    expect(u.stripe.sessions.some((s) => s.customer === 'cus_theirs')).toBe(false);
  });
});

describe('qa:seed --billing: the coupon and a second run', () => {
  it('creates INTERNAL-QA when it is missing, 100% off forever with no promotion code', async () => {
    const u = unit();
    await seedBilling(u.deps, { live: false });
    expect([...u.stripe.couponsHeld.values()]).toEqual([
      {
        id: COUPON_ID,
        percent_off: 100,
        duration: 'forever',
        metadata: { internal: 'true' },
        valid: true,
      },
    ]);
    // The port has no promotion-code call at all; this pins that none was made under another name.
    expect(new Set(u.stripe.calls)).toEqual(
      new Set([
        'balance.retrieve',
        'coupons.retrieve',
        'coupons.create',
        'customers.create',
        'sessions.list',
        'sessions.create',
      ]),
    );
    for (const s of u.stripe.sessions) expect(s.params.discounts).toEqual([{ coupon: COUPON_ID }]);
  });

  it('a second run before any checkout is completed: same customers, one open session each', async () => {
    const u = unit();
    await seedBilling(u.deps, { live: false });
    const first = u.stripe.sessions.map((s) => s.id);
    await seedBilling(u.deps, { live: false });
    expect(u.stripe.couponsHeld.size).toBe(1);
    expect(u.stripe.calls.filter((c) => c === 'coupons.create')).toHaveLength(1);
    expect(u.stripe.customersHeld.size).toBe(BILLED.length);
    expect(new Set(u.stripe.customerCreates.map((c) => c.key))).toEqual(
      new Set(BILLED.map((k) => `customer:${accountIdOf(k)}`)),
    );
    // The first run's sessions were expired, so each customer holds exactly one open session.
    expect(u.stripe.sessions.filter((s) => first.includes(s.id)).map((s) => s.status)).toEqual(
      first.map(() => 'expired'),
    );
    const open = u.stripe.open();
    expect(open).toHaveLength(BILLED.length);
    expect(new Set(open.map((s) => s.customer)).size).toBe(BILLED.length);
  });
});

describe('qa:seed --billing: parity with the app’s checkout', () => {
  const ACCOUNT = '0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11';

  /** The app's own session (and customer, when none is stored) for the plan, through its entry points. */
  async function appSession(
    plan: 'pro' | 'agency',
    trial: boolean,
    stored: string | null,
  ): Promise<{
    session: Stripe.Checkout.SessionCreateParams;
    customer: { params: Stripe.CustomerCreateParams; key: string } | null;
  }> {
    let session: Stripe.Checkout.SessionCreateParams | null = null;
    let customer: { params: Stripe.CustomerCreateParams; key: string } | null = null;
    const deps: CheckoutDeps = {
      accounts: {
        read: async () => ({ snapshot: FREE_START, stripeCustomerId: stored }),
        bindCustomer: async () => true,
      },
      stripe: {
        customers: {
          create: async (params, options) => {
            customer = { params, key: options.idempotencyKey };
            return { id: 'cus_parity' };
          },
        },
        checkout: {
          sessions: {
            list: () => (async function* () {})(),
            expire: async () => ({}),
            create: async (params) => {
              session = params;
              return { url: 'https://checkout.stripe.test/c/pay/cs_app' };
            },
          },
        },
      },
      catalog,
      origin: ORIGIN,
      now: () => NOW,
      report: () => {},
    };
    const buyer = { accountId: ACCOUNT, email: 'qa+parity@example.test' };
    const r = trial
      ? await agencyTrial(deps, { ...buyer, interval: 'month' })
      : await checkoutV2(deps, { ...buyer, plan, interval: 'month' });
    expect(r.ok).toBe(true);
    return { session: session!, customer };
  }

  /** The session's parameters but for the two the script is allowed to set differently. */
  const without = (p: Stripe.Checkout.SessionCreateParams) =>
    Object.fromEntries(
      Object.entries(p).filter(([k]) => k !== 'discounts' && k !== 'payment_method_collection'),
    );

  for (const a of QA_ACCOUNTS.filter((x) => x.billing !== null)) {
    const b = a.billing!;
    it(`${a.key}: the session is startCheckout's but for discounts and payment_method_collection`, async () => {
      const app = await appSession(b.plan, b.trial, 'cus_parity');
      const ours = sessionParams({
        accountId: ACCOUNT,
        customer: 'cus_parity',
        price: await catalog.priceFor(b.plan, b.interval, 'base'),
        billing: b,
        origin: ORIGIN,
        now: NOW,
      });
      expect(without(ours)).toEqual(without(app.session));
      expect(app.session.discounts).toBeUndefined();
      expect(ours.discounts).toEqual([{ coupon: COUPON_ID }]);
      if (b.trial) {
        // The card is taken now: the trial is cancelled at its end without one.
        expect(app.session.payment_method_collection).toBe('always');
        expect(ours.payment_method_collection).toBe('always');
      } else {
        expect(app.session.payment_method_collection).toBeUndefined();
        expect(ours.payment_method_collection).toBe('if_required');
      }
    });
  }

  it('creates the customer as startCheckout does, under its key, with internal added', async () => {
    const app = await appSession('pro', false, null);
    const u = unit();
    const pro = accountIdOf('pro');
    await seedBilling(u.deps, { live: false });
    const ours = u.stripe.customerCreates.find((c) => c.key === `customer:${pro}`)!;
    const appMeta = app.customer!.params.metadata as Record<string, string>;
    expect(app.customer!.key).toBe(`customer:${ACCOUNT}`);
    expect(Object.keys(app.customer!.params).sort()).toEqual(Object.keys(ours.params).sort());
    expect(ours.params.email).toBe('qa+pro@example.test');
    expect(ours.params.metadata).toEqual({ ...appMeta, account_id: pro, internal: 'true' });
  });
});

describe('qa:seed --billing on PGlite: the real webhook carries the plan', () => {
  /** What `checkout.session.completed` delivers once the owner completes the session. */
  async function complete(
    w: Awaited<ReturnType<typeof world>>,
    stripe: StripeFake,
    s: FakeSession,
    n: number,
  ): Promise<void> {
    const price = (s.params.line_items![0] as { price: string }).price;
    const sold = (await catalog.planOfPrice(price))!;
    const created = Math.floor(Date.now() / 1000);
    const trial = s.params.subscription_data?.trial_period_days !== undefined;
    const sub = stripe.put({
      id: `sub_qa${n}`,
      customer: s.customer,
      status: trial ? 'trialing' : 'active',
      plan: sold.plan,
      interval: sold.interval,
      seats: 0,
      sites: 0,
      trialEnd: trial ? created + 14 * 86_400 : null,
      periodEnd: created + 30 * 86_400,
      cancelAtPeriodEnd: false,
    });
    const event = stripeEvent(
      'checkout.session.completed',
      payloads.checkout({
        session: s.id,
        accountId: s.params.client_reference_id!,
        customer: s.customer,
        subscription: sub.id,
        created,
      }),
      { id: `evt_qa${n}`, created },
    );
    const outcome = await applyStripeEvent(
      event,
      {
        db: pgliteWebhookDb(w.db),
        stripe,
        catalog,
        sinks: stripe.sinks(),
        livemode: false,
      },
      { now: () => new Date((created + 60) * 1000), report: () => {} },
    );
    expect(outcome).toEqual(expect.objectContaining({ outcome: 'applied' }));
  }

  function billingOver(
    w: Awaited<ReturnType<typeof world>>,
    stripe: BillingStripeFake,
  ): BillingDeps {
    return {
      auth: w.deps.auth,
      store: w.deps.store,
      accounts: qaBillingAccounts(w.sb),
      stripe,
      keyLive: false,
      priceFor: (plan, interval) => catalog.priceFor(plan, interval, 'base'),
      origin: ORIGIN,
      inbox: w.deps.inbox,
      now: () => new Date(),
      confirm: async () => '',
      print: () => {},
    };
  }

  withMarker(
    'each completed session leaves its account on its plan, and a second run opens nothing',
    async () => {
      const w = await world();
      await seed(w.deps);
      const stripe = new BillingStripeFake();
      const deps = billingOver(w, stripe);
      expect(exitCode(await seedBilling(deps, { live: false }))).toBe(0);
      expect(stripe.open()).toHaveLength(BILLED.length);

      const webhookStripe = new StripeFake();
      let n = 0;
      for (const s of stripe.open()) await complete(w, webhookStripe, s, ++n);

      const r = await w.db.query<{ qa_key: string; state: string; bound: boolean }>(
        `select q.qa_key, a.state, a.stripe_customer_id is not null bound
           from public.qa_accounts q join public.accounts a on a.id = q.account_id
          where q.qa_key in ('pro', 'agency', 'agencytrial', 'demo')
            and a.kind = case when q.qa_key = 'pro' then 'personal' else 'agency' end
          order by q.qa_key`,
      );
      expect(r.rows).toEqual([
        { qa_key: 'agency', state: 'agency', bound: true },
        { qa_key: 'agencytrial', state: 'agency_trial', bound: true },
        { qa_key: 'demo', state: 'agency', bound: true },
        { qa_key: 'pro', state: 'pro', bound: true },
      ]);

      const created = stripe.calls.filter((c) => /create|expire/.test(c)).length;
      const again = await seedBilling(deps, { live: false });
      expect(stripe.calls.filter((c) => /create|expire/.test(c)).length).toBe(created);
      expect(again.filter((s) => s.key !== 'run').map((s) => [s.key, s.step, s.outcome])).toEqual(
        BILLED.map((k) => [k, 'checkout', 'unchanged']),
      );
    },
  );

  withMarker('refuses through the real store: a missing row, and internal false', async () => {
    const w = await world();
    await seed(w.deps);
    await w.db.query(
      `delete from public.qa_accounts q using public.accounts a
        where a.id = q.account_id and q.qa_key = 'pro' and a.kind = 'personal'`,
    );
    await w.db.query(
      `update public.accounts a set internal = false from public.qa_accounts q
        where a.id = q.account_id and q.qa_key = 'demo' and a.kind = 'agency'`,
    );
    const stripe = new BillingStripeFake();
    const steps = await seedBilling(billingOver(w, stripe), { live: false });
    expect(steps.filter((s) => s.outcome === 'refused').map((s) => s.key)).toEqual(['pro', 'demo']);
    expect(stripe.open()).toHaveLength(2);
  });
});
