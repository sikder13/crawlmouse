import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelResponse,
  cancelSubscription,
  parseCancel,
  supabaseCancelAccounts,
  type CancelDeps,
  type Followed,
} from './cancel';

const ACCOUNT = '0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11';
const SUB = 'sub_1Followed';
const NOW = new Date('2026-11-08T12:00:00.000Z');
const TRIAL_END = '2026-11-20T00:00:00.000Z';
const PERIOD_END = '2026-12-01T00:00:00.000Z';
const secs = (iso: string) => Date.parse(iso) / 1000;

let followed: Followed | null;
let retrieved: Partial<Stripe.Subscription>;
let log: string[];
const update = vi.fn();
const cancel = vi.fn();

/** The subscription as Stripe returns it after a write: the same, with the cancellation set. */
const answer = () =>
  ({ ...retrieved, cancel_at_period_end: true }) as unknown as Stripe.Subscription;

function deps(): CancelDeps {
  return {
    accounts: { followed: async () => followed },
    now: () => NOW,
    stripe: {
      subscriptions: {
        retrieve: async (id) => {
          log.push(`retrieve ${id}`);
          return { id, ...retrieved } as Stripe.Subscription;
        },
        update: async (...a) => {
          log.push('update');
          update(...a);
          return answer();
        },
        cancel: async (...a) => {
          log.push('cancel');
          cancel(...a);
          return { ...answer(), status: 'canceled' };
        },
      },
    },
  };
}

const items = (...ends: string[]) => ({
  data: ends.map((e) => ({ current_period_end: secs(e) })),
});

beforeEach(() => {
  log = [];
  update.mockReset();
  cancel.mockReset();
  followed = {
    id: SUB,
    mirror: { status: 'active', trialEnd: null, currentPeriodEnd: new Date(PERIOD_END) },
  };
  retrieved = { status: 'active', trial_end: null, items: items(PERIOD_END) as never };
});

const run = (confirmed: boolean) => cancelSubscription(deps(), { accountId: ACCOUNT, confirmed });

describe('parseCancel', () => {
  it.each([
    [{}, false],
    [{ confirm: 'true' }, true],
    [{ confirm: 'true', accountId: ACCOUNT }, true],
  ])('reads the form %j as confirmed=%s', (fields, confirmed) => {
    expect(parseCancel({ kind: 'form', fields })).toEqual({
      accountId: (fields as { accountId?: string }).accountId,
      confirmed,
    });
  });

  it.each([
    [{}, false],
    [{ confirm: true }, true],
    [{ confirm: false }, false],
    [{ confirm: true, accountId: ACCOUNT }, true],
  ])('reads the JSON %j as confirmed=%s', (fields, confirmed) => {
    expect(parseCancel({ kind: 'json', fields })).toEqual({
      accountId: (fields as { accountId?: string }).accountId,
      confirmed,
    });
  });

  it.each([
    ['form', { confirm: 'yes' }],
    ['form', { confirm: 'false' }],
    ['json', { confirm: 'true' }],
    ['json', { confirm: 1 }],
    ['json', { accountId: 'acc' }],
    ['form', { confirm: 'true', reason: 'too expensive' }],
  ] as const)('refuses the %s body %j', (kind, fields) => {
    expect(parseCancel({ kind, fields })).toBeNull();
  });
});

describe('cancelSubscription', () => {
  it('409 no_subscription for an account that follows none (a no-card trial), with no Stripe call', async () => {
    followed = null;
    expect(await run(true)).toEqual({ ok: false, status: 409, error: 'no_subscription' });
    expect(log).toEqual([]);
  });

  describe('the first click: what would happen, and no Stripe call at all', () => {
    it.each([
      ['active: at the period end', 'active', PERIOD_END],
      ['trialing: at the trial end', 'trialing', TRIAL_END],
      ['past_due: at once (spec 03, Q14)', 'past_due', NOW.toISOString()],
      ['unpaid: at once', 'unpaid', NOW.toISOString()],
      ['paused: at once', 'paused', NOW.toISOString()],
      ['canceled: nothing left to end', 'canceled', null],
    ] as const)('%s', async (_, status, endsAt) => {
      followed = {
        id: SUB,
        mirror: { status, trialEnd: new Date(TRIAL_END), currentPeriodEnd: new Date(PERIOD_END) },
      };
      expect(await run(false)).toEqual({ ok: true, step: 'confirm', endsAt });
      expect(log).toEqual([]);
    });

    it('says nothing of the end when the subscription is not mirrored yet', async () => {
      followed = { id: SUB, mirror: null };
      expect(await run(false)).toEqual({ ok: true, step: 'confirm', endsAt: null });
      expect(log).toEqual([]);
    });
  });

  describe('the second click', () => {
    it('cancels an active subscription at the period end, once, with no idempotency key', async () => {
      expect(await run(true)).toEqual({ ok: true, step: 'done', endsAt: PERIOD_END });
      expect(log).toEqual([`retrieve ${SUB}`, 'update']);
      expect(update.mock.calls).toEqual([[SUB, { cancel_at_period_end: true }]]);
      expect(cancel).not.toHaveBeenCalled();
    });

    it('writes again on a second cancellation, as after a renewal in the portal', async () => {
      await run(true);
      await run(true);
      expect(update.mock.calls).toEqual([
        [SUB, { cancel_at_period_end: true }],
        [SUB, { cancel_at_period_end: true }],
      ]);
    });

    it('answers the earliest period end of the items', async () => {
      retrieved.items = items('2027-01-01T00:00:00.000Z', PERIOD_END) as never;
      expect(await run(true)).toEqual({ ok: true, step: 'done', endsAt: PERIOD_END });
    });

    it('cancels a trialing subscription at the trial end, so the card is not charged', async () => {
      retrieved = {
        status: 'trialing',
        trial_end: secs(TRIAL_END),
        items: items(TRIAL_END) as never,
      };
      expect(await run(true)).toEqual({ ok: true, step: 'done', endsAt: TRIAL_END });
      expect(update.mock.calls).toEqual([[SUB, { cancel_at_period_end: true }]]);
    });

    it.each(['past_due', 'unpaid', 'paused'] as const)(
      'cancels a %s subscription at once without proration, so a retry cannot charge (Q14)',
      async (status) => {
        retrieved = { status, trial_end: null, items: items(PERIOD_END) as never };
        expect(await run(true)).toEqual({ ok: true, step: 'done', endsAt: NOW.toISOString() });
        expect(log).toEqual([`retrieve ${SUB}`, 'cancel']);
        expect(cancel.mock.calls).toEqual([
          [SUB, { prorate: false }, { idempotencyKey: `cancel-now:${SUB}` }],
        ]);
        expect(update).not.toHaveBeenCalled();
      },
    );

    it('decides on the status Stripe gives now, not the mirror', async () => {
      followed = {
        id: SUB,
        mirror: { status: 'active', trialEnd: null, currentPeriodEnd: new Date(PERIOD_END) },
      };
      retrieved = { status: 'past_due', trial_end: null, items: items(PERIOD_END) as never };
      await run(true);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(update).not.toHaveBeenCalled();
    });

    it.each(['canceled', 'incomplete_expired', 'incomplete'] as const)(
      '409 no_subscription for a %s subscription, with no write',
      async (status) => {
        retrieved = { status, trial_end: null, items: items(PERIOD_END) as never };
        expect(await run(true)).toEqual({ ok: false, status: 409, error: 'no_subscription' });
        expect(log).toEqual([`retrieve ${SUB}`]);
      },
    );
  });
});

describe('cancelResponse', () => {
  const ORIGIN = 'https://crawlmouse.com';

  it.each(['confirm', 'done'] as const)(
    'sends a form back to Settings › Plan at step %s',
    (step) => {
      const res = cancelResponse('form', ORIGIN, { ok: true, step, endsAt: PERIOD_END });
      expect([res.status, res.headers.get('location')]).toEqual([
        303,
        `${ORIGIN}/settings/plan?cancel=${step}`,
      ]);
    },
  );

  it('answers JSON with the step and the end', async () => {
    const res = cancelResponse('json', ORIGIN, { ok: true, step: 'confirm', endsAt: null });
    expect([res.status, await res.text()]).toEqual([200, '{"step":"confirm","endsAt":null}']);
  });

  it.each(['form', 'json'] as const)(
    'answers a %s refusal with its status and error',
    async (kind) => {
      const res = cancelResponse(kind, ORIGIN, {
        ok: false,
        status: 409,
        error: 'no_subscription',
      });
      expect([res.status, await res.text()]).toEqual([409, '{"error":"no_subscription"}']);
    },
  );
});

describe('supabaseCancelAccounts', () => {
  function admin(answers: { data: unknown; error: unknown }[]) {
    const calls: unknown[][] = [];
    const sb = {
      from(table: string) {
        calls.push(['from', table]);
        const result = answers.shift()!;
        const chain: Record<string, unknown> = {};
        for (const m of ['select', 'eq']) {
          chain[m] = (...args: unknown[]) => {
            calls.push([m, ...args]);
            return chain;
          };
        }
        chain.maybeSingle = () => {
          calls.push(['maybeSingle']);
          return Promise.resolve(result);
        };
        return chain;
      },
    } as unknown as SupabaseClient;
    return { sb, calls };
  }

  it("reads the followed subscription and its mirror row, on the account's own row", async () => {
    const { sb, calls } = admin([
      { data: { current_subscription_id: SUB }, error: null },
      {
        data: { status: 'trialing', trial_end: TRIAL_END, current_period_end: TRIAL_END },
        error: null,
      },
    ]);
    expect(await supabaseCancelAccounts(sb).followed(ACCOUNT)).toEqual({
      id: SUB,
      mirror: {
        status: 'trialing',
        trialEnd: new Date(TRIAL_END),
        currentPeriodEnd: new Date(TRIAL_END),
      },
    });
    expect(calls).toEqual([
      ['from', 'accounts'],
      ['select', 'current_subscription_id'],
      ['eq', 'id', ACCOUNT],
      ['maybeSingle'],
      ['from', 'subscriptions'],
      ['select', 'status, trial_end, current_period_end'],
      ['eq', 'id', SUB],
      ['eq', 'account_id', ACCOUNT],
      ['maybeSingle'],
    ]);
  });

  it('answers null when the account follows no subscription, without reading the mirror', async () => {
    const { sb, calls } = admin([{ data: { current_subscription_id: null }, error: null }]);
    expect(await supabaseCancelAccounts(sb).followed(ACCOUNT)).toBeNull();
    expect(calls.filter(([m]) => m === 'from')).toEqual([['from', 'accounts']]);
  });

  it('answers a null mirror for a subscription not mirrored yet', async () => {
    const { sb } = admin([
      { data: { current_subscription_id: SUB }, error: null },
      { data: null, error: null },
    ]);
    expect(await supabaseCancelAccounts(sb).followed(ACCOUNT)).toEqual({ id: SUB, mirror: null });
  });

  it('throws on a failed read, or an account that is not there', async () => {
    await expect(
      supabaseCancelAccounts(admin([{ data: null, error: { message: 'boom' } }]).sb).followed(
        ACCOUNT,
      ),
    ).rejects.toThrow('accounts read failed: boom');
    await expect(
      supabaseCancelAccounts(admin([{ data: null, error: null }]).sb).followed(ACCOUNT),
    ).rejects.toThrow(`account ${ACCOUNT} not found`);
    await expect(
      supabaseCancelAccounts(
        admin([
          { data: { current_subscription_id: SUB }, error: null },
          { data: null, error: { message: 'gone' } },
        ]).sb,
      ).followed(ACCOUNT),
    ).rejects.toThrow('subscriptions read failed: gone');
  });
});
