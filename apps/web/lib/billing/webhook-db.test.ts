import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postgrestOver, type Call } from '../../__tests__/helpers/postgrest-pglite';
import type { PlannedEffect } from './effects';
import { EntitlementConflictError } from './state-machine-apply';
import {
  BindingConflictError,
  supabaseWebhookDb,
  type ApplyEventParams,
  type WebhookDb,
} from './webhook-db';
import { webhookWorld, type WebhookWorld } from './webhook-db.pglite';

vi.mock('server-only', () => ({}));

/**
 * `supabaseWebhookDb`, the port the deployed webhook reads and writes through, over a PostgREST
 * stand-in on PGlite with every migration (__tests__/helpers/postgrest-pglite.ts): each method's
 * requests, written out call by call, and what the database holds after them. The handler's own
 * tests (./stripe-webhook.test.ts) run through this port as well as through ./webhook-db.pglite.ts.
 */

let w: WebhookWorld;
let log: Call[][];
let port: WebhookDb;
beforeEach(async () => {
  w = await webhookWorld();
  log = [];
  port = supabaseWebhookDb(postgrestOver(w.db, { log }));
}, 120_000);
afterEach(async () => {
  await w?.db.close();
});

const event = (id: string) => ({ id, type: 'invoice.paid', livemode: false });

const alert: PlannedEffect = {
  kind: 'alert',
  reason: 'dispute',
  accountId: null,
  subscriptionId: null,
  source: 'evt_1',
};

async function ledgerRow(id: string) {
  return (
    await w.db.query<{
      type: string;
      livemode: boolean | null;
      handled: boolean | null;
      handled_reason: string | null;
      processed_at: Date | null;
    }>(
      `select type, livemode, handled, handled_reason, processed_at
         from public.stripe_events where id = $1`,
      [id],
    )
  ).rows[0];
}

/** What `recordDecision` sends for an event recorded without an account. */
const recorded = (eventId: string, effects: PlannedEffect[] = []): ApplyEventParams => ({
  event_id: eventId,
  event_created: '2099-01-01T00:00:00.000Z',
  account_id: null,
  customer_id: null,
  subscription: null,
  transition: null,
  expected_version: null,
  handled: false,
  handled_reason: 'not subscribed',
  effects,
});

const STAMP: Call[] = [
  ['from', 'stripe_events'],
  ['update', { processed_at: expect.any(String) }],
  ['eq', 'id', 'evt_1'],
  ['not', 'handled', 'is', null],
  ['is', 'processed_at', null],
];

describe('begin', () => {
  it('inserts the row; again, it reads the row back: undecided, decided with its plan, processed', async () => {
    expect(await port.begin(event('evt_1'))).toEqual({ kind: 'new' });
    expect(await ledgerRow('evt_1')).toEqual({
      type: 'invoice.paid',
      livemode: false,
      handled: null,
      handled_reason: null,
      processed_at: null,
    });
    expect(await port.begin(event('evt_1'))).toEqual({ kind: 'retry' });
    await port.applyEvent(recorded('evt_1', [alert]));
    expect(await port.begin(event('evt_1'))).toEqual({ kind: 'decided', effects: [alert] });
    await port.stamp('evt_1');
    expect(await port.begin(event('evt_1'))).toEqual({ kind: 'processed' });

    const insert: Call[] = [
      ['from', 'stripe_events'],
      ['insert', { id: 'evt_1', type: 'invoice.paid', livemode: false }],
    ];
    const read: Call[] = [
      ['from', 'stripe_events'],
      ['select', 'handled, processed_at, effects'],
      ['eq', 'id', 'evt_1'],
      ['maybeSingle'],
    ];
    expect(log).toEqual([
      insert,
      insert,
      read,
      [['rpc', 'apply_stripe_event', { p: recorded('evt_1', [alert]) }]],
      insert,
      read,
      STAMP,
      insert,
      read,
    ]);
  });

  it('an insert error other than a duplicate throws, and so does a row gone before it is read', async () => {
    // `type` is not null: the insert fails with 23502, not 23505.
    await expect(
      port.begin({ id: 'evt_2', type: null as unknown as string, livemode: false }),
    ).rejects.toThrow(/^stripe_events insert failed: /);
    expect(await ledgerRow('evt_2')).toBeUndefined();

    await port.begin(event('evt_3'));
    const vanishing = supabaseWebhookDb(
      postgrestOver(w.db, {
        before: async (calls) => {
          if (calls.some(([m]) => m === 'select')) {
            await w.db.query(`delete from public.stripe_events where id = 'evt_3'`);
          }
        },
      }),
    );
    await expect(vanishing.begin(event('evt_3'))).rejects.toThrow(
      'stripe_events row evt_3 is gone',
    );
  });
});

describe('recordRefused', () => {
  it('writes the row undecided with the reason, and leaves a row already there as it is', async () => {
    await port.recordRefused(event('evt_1'), 'livemode_mismatch');
    expect(await ledgerRow('evt_1')).toEqual({
      type: 'invoice.paid',
      livemode: false,
      handled: null,
      handled_reason: 'livemode_mismatch',
      processed_at: null,
    });
    expect(log).toEqual([
      [
        ['from', 'stripe_events'],
        [
          'upsert',
          {
            id: 'evt_1',
            type: 'invoice.paid',
            livemode: false,
            handled_reason: 'livemode_mismatch',
          },
          { onConflict: 'id', ignoreDuplicates: true },
        ],
      ],
    ]);

    await port.begin(event('evt_2'));
    await port.applyEvent(recorded('evt_2'));
    await port.recordRefused({ ...event('evt_2'), livemode: true }, 'livemode_mismatch');
    expect(await ledgerRow('evt_2')).toMatchObject({
      livemode: false,
      handled: false,
      handled_reason: 'not subscribed',
    });
  });
});

describe('the account and mirror reads', () => {
  it('accountById: a live account with its customer; a deleted one, an unknown one and a non-UUID are null', async () => {
    const id = await w.account('cus_a');
    expect(await port.accountById(id)).toEqual({ id, stripeCustomerId: 'cus_a' });
    expect(log).toEqual([
      [
        ['from', 'accounts'],
        ['select', 'id, stripe_customer_id'],
        ['eq', 'id', id],
        ['is', 'deleted_at', null],
        ['maybeSingle'],
      ],
    ]);
    expect(await port.accountById('7d0a4f43-7f1c-4c55-9f3a-8f9f7b0e2c11')).toBeNull();
    log.length = 0;
    expect(await port.accountById('not-a-uuid')).toBeNull();
    expect(log).toEqual([]);
    await w.db.query(`update public.accounts set deleted_at = now() where id = $1`, [id]);
    expect(await port.accountById(id)).toBeNull();
  });

  it('accountByCustomer: the live account bound to it, else null', async () => {
    const id = await w.account('cus_a');
    expect(await port.accountByCustomer('cus_a')).toBe(id);
    expect(log).toEqual([
      [
        ['from', 'accounts'],
        ['select', 'id'],
        ['eq', 'stripe_customer_id', 'cus_a'],
        ['is', 'deleted_at', null],
        ['maybeSingle'],
      ],
    ]);
    expect(await port.accountByCustomer('cus_none')).toBeNull();
    await w.db.query(`update public.accounts set deleted_at = now() where id = $1`, [id]);
    expect(await port.accountByCustomer('cus_a')).toBeNull();
  });

  it('subscriptionById: the stored plan columns, or null', async () => {
    const accountId = await w.account('cus_a');
    await w.db.query(
      `insert into public.subscriptions (id, account_id, status, plan, interval, seat_quantity,
                                         extra_site_quantity)
       values ('sub_1', $1, 'active', 'agency', 'year', 2, 3)`,
      [accountId],
    );
    expect(await port.subscriptionById('sub_1')).toEqual({
      accountId,
      plan: 'agency',
      interval: 'year',
      seatQuantity: 2,
      extraSiteQuantity: 3,
    });
    expect(await port.subscriptionById('sub_none')).toBeNull();
    expect(log[0]).toEqual([
      ['from', 'subscriptions'],
      ['select', 'account_id, plan, interval, seat_quantity, extra_site_quantity'],
      ['eq', 'id', 'sub_1'],
      ['maybeSingle'],
    ]);
  });

  it('load: the account’s snapshot and version, read by id', async () => {
    const id = await w.account('cus_a');
    const stored = await port.load(id);
    expect(stored).toMatchObject({
      version: 0,
      snapshot: { state: 'free', tier: 'free', subscriptionId: null, disputedAt: null },
    });
    expect(log).toEqual([
      [
        ['from', 'accounts'],
        [
          'select',
          'state, tier, trial_variant, trial_ends_at, trial_used_at, past_due_tier, past_due_since, ' +
            'disputed_at, seat_limit, site_limit, competitor_limit, entitlement_version, ' +
            'current_subscription_id, entitlement_changed_at, state_history',
        ],
        ['eq', 'id', id],
        ['maybeSingle'],
      ],
    ]);
  });
});

describe('applyEvent', () => {
  it('sends the call as the RPC’s one argument and answers what it recorded, then what was recorded before', async () => {
    await port.begin(event('evt_1'));
    log.length = 0;
    expect(await port.applyEvent(recorded('evt_1', [alert]))).toEqual({
      decidedBefore: false,
      handled: false,
      reason: 'not subscribed',
      effects: [alert],
      version: null,
    });
    expect(await port.applyEvent({ ...recorded('evt_1'), handled_reason: 'other' })).toEqual({
      decidedBefore: true,
      handled: false,
      reason: 'not subscribed',
      effects: [alert],
      version: null,
    });
    expect(log[0]).toEqual([['rpc', 'apply_stripe_event', { p: recorded('evt_1', [alert]) }]]);
  });

  it('a stale version is EntitlementConflictError, a binding clash BindingConflictError, anything else an error with its code', async () => {
    const accountId = await w.account('cus_a');
    await port.begin(event('evt_1'));
    const onAccount = { ...recorded('evt_1'), account_id: accountId };

    const stale = port.applyEvent({ ...onAccount, expected_version: 7 });
    await expect(stale).rejects.toBeInstanceOf(EntitlementConflictError);

    const clash = port.applyEvent({ ...onAccount, customer_id: 'cus_other' });
    await expect(clash).rejects.toBeInstanceOf(BindingConflictError);

    const missing = port.applyEvent(recorded('evt_not_in_the_ledger'));
    await expect(missing).rejects.toThrow(/^apply_stripe_event failed: /);
    await expect(missing).rejects.toMatchObject({ code: 'P0002' });
    await expect(missing).rejects.not.toBeInstanceOf(EntitlementConflictError);
    await expect(missing).rejects.not.toBeInstanceOf(BindingConflictError);

    expect((await ledgerRow('evt_1'))!.handled).toBeNull();
  });
});

describe('stamp', () => {
  it('sets processed_at on a decided row only, and only once', async () => {
    await port.begin(event('evt_1'));
    await port.stamp('evt_1');
    expect((await ledgerRow('evt_1'))!.processed_at).toBeNull();

    await port.applyEvent(recorded('evt_1'));
    await port.stamp('evt_1');
    const first = (await ledgerRow('evt_1'))!.processed_at;
    expect(first).toBeInstanceOf(Date);

    await new Promise((r) => setTimeout(r, 5)); // a second stamp would carry a later time
    await port.stamp('evt_1');
    expect((await ledgerRow('evt_1'))!.processed_at).toEqual(first);
    expect(log.filter((r) => r.some(([m]) => m === 'update'))).toEqual([STAMP, STAMP, STAMP]);
  });
});
