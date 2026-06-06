// TC-L9(a) — POST a VALID-signature Stripe webhook carrying customer.subscription.updated whose
// customer id no users row carries -> applyStripeEvent throws 'no user for stripe_customer_id' ->
// route returns 500 'handler error'. Signs with the dev env's STRIPE_WEBHOOK_SECRET.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/apps/web/');
const Stripe = require('stripe');

const env = Object.fromEntries(
  readFileSync('/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/apps/web/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const secret = env.STRIPE_WEBHOOK_SECRET;
const stripe = new Stripe(env.STRIPE_SECRET_KEY);
const RUN = process.argv[2] || 'norun';
const evtId = `evt_p5fake_${RUN}`;
const custId = `cus_p5fake_${RUN}`;

const event = {
  id: evtId, object: 'event', api_version: '2024-06-20', type: 'customer.subscription.updated',
  created: Math.floor(9999999999 / 2),
  data: { object: {
    id: `sub_p5fake_${RUN}`, object: 'subscription', customer: custId, status: 'active',
    current_period_end: 9999999999,
    items: { object: 'list', data: [{ id: 'si_x', object: 'subscription_item', current_period_end: 9999999999 }] },
  } },
};
const payload = JSON.stringify(event);
const header = stripe.webhooks.generateTestHeaderString({ payload, secret });

const res = await fetch('http://localhost:3000/api/webhooks/stripe', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'stripe-signature': header },
  body: payload,
});
const body = await res.text();
console.log(JSON.stringify({ evtId, custId, status: res.status, body }));
