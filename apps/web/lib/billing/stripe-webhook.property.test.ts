import fc from 'fast-check';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { payloads, stripeEvent, type FakeSubscription } from './stripe.fake';
import { webhookWorld, type WebhookWorld } from './webhook-db.pglite';

vi.mock('server-only', () => ({}));

/**
 * Convergence (plan review, finding 2.4): Stripe is modelled as a timeline of one Pro
 * subscription's statuses, and a subscription read returns the status at the moment of the read.
 * Each event is delivered at or after the step that created it, some more than once, and some
 * while another delivery is between its read and its write (two deliveries at once: one reads,
 * the timeline moves on and a newer event is processed, then the first writes). Whatever the
 * schedule, once every event has been processed the account is what the final status implies.
 *
 * The timeline ends settled (active, unpaid or canceled): past_due is dunning, which Stripe always
 * ends one way or the other. The implied state is written out below, not computed by the code
 * under test.
 */

type Status = 'active' | 'past_due' | 'unpaid' | 'canceled';
type Kind = 'checkout' | 'updated' | 'failed' | 'deleted';

/** Where a subscription can go from each status, as Stripe moves it. */
const NEXT: Record<Status, readonly Status[]> = {
  active: ['past_due', 'canceled'],
  past_due: ['active', 'past_due', 'unpaid', 'canceled'],
  unpaid: ['active', 'canceled'],
  canceled: [],
};

/** The events Stripe sends for one move: a further failed retry while past due sends only the failure. */
function eventsOf(from: Status, to: Status): Kind[] {
  if (to === 'canceled') return ['deleted'];
  if (to === 'past_due') return from === 'past_due' ? ['failed'] : ['updated', 'failed'];
  if (to === 'unpaid') return ['failed', 'updated'];
  return ['updated'];
}

/** What the account must be once Stripe has settled at `status`. */
const IMPLIED: Record<
  Exclude<Status, 'past_due'>,
  { state: string; tier: string; follows: boolean }
> = {
  active: { state: 'pro', tier: 'pro', follows: true },
  unpaid: { state: 'free', tier: 'free', follows: true },
  canceled: { state: 'free', tier: 'free', follows: false },
};

function timeline(choices: number[], settleActive: boolean): Status[] {
  const statuses: Status[] = [];
  let at: Status = 'active';
  for (const c of choices) {
    const options = NEXT[at];
    if (options.length === 0) break;
    at = options[c % options.length]!;
    statuses.push(at);
  }
  if (at === 'past_due') statuses.push(settleActive ? 'active' : 'unpaid');
  return statuses;
}

interface Planned {
  step: number;
  kind: Kind;
}

function plannedEvents(statuses: Status[]): Planned[] {
  const out: Planned[] = [{ step: 0, kind: 'checkout' }];
  statuses.forEach((to, i) => {
    const from = i === 0 ? 'active' : statuses[i - 1]!;
    for (const kind of eventsOf(from, to)) out.push({ step: i + 1, kind });
  });
  return out;
}

const scenario = fc
  .record({ choices: fc.array(fc.nat(), { maxLength: 6 }), settleActive: fc.boolean() })
  .chain(({ choices, settleActive }) => {
    const statuses = timeline(choices, settleActive);
    const events = plannedEvents(statuses);
    const last = statuses.length;
    return fc.record({
      statuses: fc.constant(statuses),
      events: fc.constant(events),
      schedule: fc.tuple(
        ...events.map((e) =>
          fc.record({
            // The checkout is processed before the first move; anything else at or after its step.
            delay: e.kind === 'checkout' ? fc.constant(0) : fc.nat({ max: last - e.step }),
            repeats: fc.array(fc.nat({ max: last - e.step }), { maxLength: 2 }),
            interleave: fc.constantFrom('none', 'none', 'read', 'load'),
            order: fc.nat({ max: 1000 }),
          }),
        ),
      ),
    });
  });

let w: WebhookWorld;
beforeAll(async () => {
  w = await webhookWorld();
}, 120_000);
afterAll(async () => {
  await w?.db.close();
});

const BASE = 4_070_908_800;
let run = 0;

describe('convergence to the final status of a modelled Stripe timeline', () => {
  it('any schedule, with repeats and concurrent pairs, ends in the state the final status implies', async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async ({ statuses, events, schedule }) => {
        const r = ++run;
        const customer = `cus_prop${r}`;
        const accountId = await w.account(customer);
        const sub: FakeSubscription = w.stripe.put({
          id: `sub_prop${r}`,
          customer,
          status: 'active',
          plan: 'pro',
          interval: 'month',
          seats: 0,
          sites: 0,
          trialEnd: null,
          periodEnd: BASE + 365 * 86_400,
          cancelAtPeriodEnd: false,
        });
        const built: Stripe.Event[] = events.map((e, j) => {
          const created = BASE + 100 * e.step;
          const options = { id: `evt_prop${r}_${j}`, created };
          const status = e.step === 0 ? 'active' : statuses[e.step - 1]!;
          switch (e.kind) {
            case 'checkout':
              return stripeEvent(
                'checkout.session.completed',
                payloads.checkout({
                  session: `cs_prop${r}`,
                  accountId,
                  customer,
                  subscription: sub.id,
                  created: created - 30,
                }),
                options,
              );
            case 'updated':
              return stripeEvent(
                'customer.subscription.updated',
                payloads.subscription({ ...sub, status }),
                options,
              );
            case 'deleted':
              return stripeEvent(
                'customer.subscription.deleted',
                payloads.subscription({ ...sub, status }),
                options,
              );
            case 'failed':
              return stripeEvent(
                'invoice.payment_failed',
                payloads.invoice({ id: `in_prop${r}_${j}`, customer, subscription: sub.id }),
                options,
              );
          }
        });

        let step = 0;
        const advanceTo = (m: number) => {
          while (step < m) {
            step++;
            w.stripe.update(sub.id, { status: statuses[step - 1]! });
          }
        };
        const deliveries = events
          .flatMap((e, j) => [
            { j, at: e.step + schedule[j]!.delay, interleave: schedule[j]!.interleave },
            ...schedule[j]!.repeats.map((d) => ({ j, at: e.step + d, interleave: 'none' })),
          ])
          .map((d, i) => ({ ...d, order: schedule[d.j]!.order * 100 + i }))
          .sort((a, b) => a.at - b.at || a.order - b.order);

        for (const d of deliveries) {
          advanceTo(d.at);
          // While `d` is between its read and its write, Stripe moves on and the move's first event
          // is processed.
          let fired = false;
          const meanwhile = async () => {
            if (fired || step >= statuses.length) return;
            fired = true;
            advanceTo(step + 1);
            await w.deliver(built[events.findIndex((e) => e.step === step)]!);
          };
          if (d.interleave === 'read') w.stripe.onNextRead = meanwhile;
          if (d.interleave === 'load') w.hooks.afterLoad = meanwhile;
          await w.deliver(built[d.j]!);
          w.stripe.onNextRead = null;
          w.hooks.afterLoad = undefined;
        }
        advanceTo(statuses.length);

        const final = (statuses.at(-1) ?? 'active') as Exclude<Status, 'past_due'>;
        const implied = IMPLIED[final];
        const { rows } = await w.db.query<{
          state: string;
          tier: string;
          current_subscription_id: string | null;
        }>(`select state, tier, current_subscription_id from public.accounts where id = $1`, [
          accountId,
        ]);
        expect(rows[0]).toEqual({
          state: implied.state,
          tier: implied.tier,
          current_subscription_id: implied.follows ? sub.id : null,
        });
        const undone = await w.db.query(
          `select id from public.stripe_events where id = any($1) and processed_at is null`,
          [built.map((e) => e.id)],
        );
        expect(undone.rows).toEqual([]);
      }),
      { numRuns: 150 },
    );
    // Anti-vacuity: the schedules reached the rules this property is about. Measured at 60 runs:
    // 41 older, 16 ended, 4 superseded; at 150 a zero count is improbable rather than impossible.
    const { rows } = await w.db.query<{ reason: string }>(
      `select distinct handled_reason as reason from public.stripe_events
        where id like 'evt_prop%' and handled_reason is not null`,
    );
    expect(rows.map((x) => x.reason)).toEqual(
      expect.arrayContaining([
        "older than the subscription's last event",
        'the subscription had ended',
        'superseded',
      ]),
    );
  }, 600_000);
});
