// L13/L8 Pro seed via the REAL app path: create a real Stripe test subscription, then deliver a
// SIGNED checkout.session.completed to /api/webhooks/stripe so applyStripeEvent links the customer,
// retrieves the real subscription, and writes users.pro_until (the genuine entitlement-write path).
// Usage: node stripe-pro.mjs <au1_uid> <au1_email> <RUN>
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const ROOT = '/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0';
const require = createRequire(ROOT + '/apps/web/');
const Stripe = require('stripe');
const env = Object.fromEntries(
  readFileSync(ROOT + '/apps/web/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const [AU1_UID, AU1_EMAIL, RUN] = process.argv.slice(2);
const stripe = new Stripe(env.STRIPE_SECRET_KEY);
const secret = env.STRIPE_WEBHOOK_SECRET;
const price = env.STRIPE_PRICE_ID_PRO_MONTHLY;
const log = (o) => console.log(JSON.stringify(o));

// 1) real customer + default test PM
const cus = await stripe.customers.create({ email: AU1_EMAIL, name: `P5 Pro ${RUN}`, metadata: { p5_run: RUN } });
const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer: cus.id });
await stripe.customers.update(cus.id, { invoice_settings: { default_payment_method: pm.id } });
// 2) real active subscription on the Pro price
const sub = await stripe.subscriptions.create({
  customer: cus.id,
  items: [{ price }],
  metadata: { p5_run: RUN },
});
const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;

// 3) signed checkout.session.completed tying the real cus+sub to AU1
const event = {
  id: `evt_p5pro_${RUN}`, object: 'event', api_version: '2024-06-20', type: 'checkout.session.completed',
  created: Math.floor(Date.now() / 1000),
  data: { object: {
    id: `cs_p5_${RUN}`, object: 'checkout.session', mode: 'subscription', status: 'complete',
    client_reference_id: AU1_UID, customer: cus.id, subscription: sub.id,
  } },
};
const payload = JSON.stringify(event);
const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
const res = await fetch('http://localhost:3000/api/webhooks/stripe', {
  method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload,
});
const body = await res.text();
log({ customer: cus.id, subscription: sub.id, subStatus: sub.status, periodEnd,
      proUntilExpected: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      eventId: event.id, webhookStatus: res.status, webhookBody: body });
