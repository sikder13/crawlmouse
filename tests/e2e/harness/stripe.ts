/**
 * The walk's Stripe (CC-38 D4). Stripe Checkout is a page on Stripe's domain and cannot be walked
 * here, so the walk goes up to the redirect and then does what Stripe does: completes the session
 * and posts the signed `checkout.session.completed` to the app's webhook. The account's state after
 * that is the real webhook's doing.
 *
 * Served at /stripe/v1/… of the stand-in (the production build's SDK is pointed here by
 * ./preload.mjs): the price listing the catalog reads (`price_<lookup key>`, as
 * lib/billing/catalog.fake.ts names them), customers, Checkout Sessions (create, list, expire),
 * subscriptions (retrieve, list, update), billing portal sessions. Subscriptions and signed events
 * come from the repo's StripeFake (lib/billing/stripe.fake.ts), whose webhook secret the walk's
 * build is given. NOT part of the product.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CATALOG } from '../../../apps/web/lib/billing/catalog';
import { fakePriceId } from '../../../apps/web/lib/billing/catalog.fake';
import {
  payloads,
  signedPayload,
  StripeFake,
  stripeSubscription,
} from '../../../apps/web/lib/billing/stripe.fake';

type Params = Record<string, unknown>;

/** Stripe's form encoding (`a[b][0][c]=v`) as nested objects and arrays. */
export function decodeForm(body: string): Params {
  const out: Params = {};
  for (const [rawKey, value] of new URLSearchParams(body)) {
    const keys = rawKey.split(/\[|\]\[|\]/).filter((k) => k !== '');
    let node: Record<string, unknown> = out;
    keys.forEach((k, i) => {
      const last = i === keys.length - 1;
      const nextIsIndex = !last && /^\d+$/.test(keys[i + 1]!);
      if (last) node[k] = value;
      else node = (node[k] ??= nextIsIndex ? [] : {}) as Record<string, unknown>;
    });
  }
  return out;
}

export interface Session {
  id: string;
  params: Params;
  status: 'open' | 'expired' | 'complete';
}

export class WalkStripe {
  readonly fake = new StripeFake();
  readonly sessions = new Map<string, Session>();
  readonly customers = new Map<string, Params>();
  private n = 0;

  constructor(private readonly webhookUrl: () => string) {}

  private id(prefix: string) {
    this.n += 1;
    return `${prefix}_walk${String(this.n).padStart(6, '0')}`;
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const form = decodeForm(Buffer.concat(chunks).toString());
    const path = url.pathname.replace('/stripe/v1/', '');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const list = (data: unknown[]) =>
      json(200, { object: 'list', data, has_more: false, url: `/v1/${path}` });
    const parts = path.split('/');

    if (path === 'prices' && req.method === 'GET') {
      return list(
        Object.entries(CATALOG).map(([key, e]) => ({
          id: fakePriceId(key),
          object: 'price',
          active: true,
          lookup_key: key,
          type: 'recurring',
          currency: 'usd',
          unit_amount: e.unitAmount,
          recurring: { interval: e.interval, interval_count: 1, usage_type: 'licensed' },
        })),
      );
    }
    if (path === 'customers' && req.method === 'POST') {
      const id = this.id('cus');
      this.customers.set(id, form);
      return json(200, { id, object: 'customer', ...form });
    }
    if (parts[0] === 'customers' && parts[1] && req.method === 'POST') {
      this.customers.set(parts[1], { ...(this.customers.get(parts[1]) ?? {}), ...form });
      return json(200, { id: parts[1], object: 'customer' });
    }
    if (path === 'checkout/sessions' && req.method === 'POST') {
      const id = this.id('cs_test');
      this.sessions.set(id, { id, params: form, status: 'open' });
      return json(200, {
        id,
        object: 'checkout.session',
        url: `https://checkout.stripe.com/c/pay/${id}`,
      });
    }
    if (path === 'checkout/sessions' && req.method === 'GET') {
      const customer = url.searchParams.get('customer');
      const status = url.searchParams.get('status');
      return list(
        [...this.sessions.values()]
          .filter((s) => s.params.customer === customer && (!status || s.status === status))
          .map((s) => ({ id: s.id, object: 'checkout.session', status: s.status })),
      );
    }
    if (parts[0] === 'checkout' && parts[3] === 'expire') {
      const s = this.sessions.get(parts[2]!);
      if (s) s.status = 'expired';
      return json(200, { id: parts[2], object: 'checkout.session', status: 'expired' });
    }
    if (parts[0] === 'subscriptions' && parts[1] && req.method === 'GET') {
      return json(200, await this.fake.retrieveSubscription(parts[1]));
    }
    if (parts[0] === 'subscriptions' && parts[1] && req.method === 'POST') {
      // Only the cancellation flag is modelled; any other change is refused rather than ignored.
      const fields = Object.keys(form).filter(
        (k) => k !== 'cancel_at_period_end' && k !== 'expand',
      );
      if (fields.length > 0 || form.cancel_at_period_end === undefined) {
        return json(404, {
          error: {
            message: `walk stripe: subscription update of ${fields.join(', ') || 'nothing'} is not modelled`,
          },
        });
      }
      this.fake.update(parts[1], { cancelAtPeriodEnd: form.cancel_at_period_end === 'true' });
      return json(200, stripeSubscription(this.fake.get(parts[1])));
    }
    if (path === 'subscriptions' && req.method === 'GET') {
      const customer = url.searchParams.get('customer');
      return list(
        this.fake
          .live()
          .map((id) => this.fake.get(id))
          .filter((f) => f.customer === customer)
          .map(stripeSubscription),
      );
    }
    if (path === 'billing_portal/sessions' && req.method === 'POST') {
      return json(200, {
        id: this.id('bps'),
        object: 'billing_portal.session',
        url: 'https://billing.stripe.com/p/session/walk',
      });
    }
    return json(404, {
      error: { message: `walk stripe: ${req.method} /v1/${path} is not modelled` },
    });
  }

  /** Stripe's side of a finished Checkout: the subscription, then the signed event to the webhook. */
  async complete(
    sessionId: string,
  ): Promise<{ status: number; body: string; subscription: string }> {
    const s = this.sessions.get(sessionId);
    if (!s || s.status !== 'open') throw new Error(`walk stripe: no open session ${sessionId}`);
    const line = (s.params.line_items as Params[])[0]!;
    const key = String(line.price).replace(/^price_/, '');
    const entry = CATALOG[key];
    if (!entry)
      throw new Error(`walk stripe: the session's price ${String(line.price)} is not ours`);
    const sub = (s.params.subscription_data ?? {}) as Params;
    const now = Math.floor(Date.now() / 1000);
    const trialDays = sub.trial_period_days === undefined ? null : Number(sub.trial_period_days);
    const subscription = this.id('sub');
    this.fake.put({
      id: subscription,
      customer: String(s.params.customer),
      status: trialDays === null ? 'active' : 'trialing',
      plan: entry.plan,
      interval: entry.interval,
      seats: 0,
      sites: 0,
      trialEnd: trialDays === null ? null : now + trialDays * 86_400,
      periodEnd: now + 30 * 86_400,
      cancelAtPeriodEnd: false,
    });
    s.status = 'complete';
    const metadata = (s.params.metadata ?? {}) as Params;
    return {
      ...(await this.deliver(
        'checkout.session.completed',
        payloads.checkout({
          session: s.id,
          accountId: String(s.params.client_reference_id),
          metadataAccountId: (metadata.account_id as string | undefined) ?? null,
          customer: String(s.params.customer),
          subscription,
          created: now,
        }),
      )),
      subscription,
    };
  }

  /** What the billing portal's "Renew" does: the cancellation withdrawn, and Stripe's update sent. */
  renew(subscription: string) {
    this.fake.update(subscription, { cancelAtPeriodEnd: false });
    return this.updated(subscription);
  }

  /** A `customer.subscription.updated` for the subscription as it now stands. */
  updated(subscription: string) {
    return this.deliver(
      'customer.subscription.updated',
      payloads.subscription(this.fake.get(subscription)),
    );
  }

  private async deliver(type: string, object: Record<string, unknown>) {
    const { payload, header } = signedPayload(type, object, {
      id: this.id('evt'),
      created: Math.floor(Date.now() / 1000),
    });
    const r = await fetch(this.webhookUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': header },
      body: payload,
    });
    return { status: r.status, body: await r.text() };
  }
}
