import { describe, expect, it, vi } from 'vitest';
import {
  dispatchPlanned,
  planEffects,
  PlannedEffectsSchema,
  type EffectContext,
  type EffectSinks,
  type InngestSend,
  type PlannedAlert,
  type PlannedCancel,
  type PlannedEffect,
} from './effects';
import { FREE_START, next, type Effect, type EntitlementSnapshot } from './state-machine';

const ACCOUNT = '5b3c1f7e-2c4a-4b8e-9d0f-1a2b3c4d5e6f';
const AT = new Date('2026-11-08T12:00:00.000Z');
const DAY = 86_400_000;

function ctx(
  before: EntitlementSnapshot,
  after: EntitlementSnapshot,
  source = 'evt_1',
): EffectContext {
  return { accountId: ACCOUNT, source, before, after };
}

/** A no-card trial started at AT, by the machine itself. */
function trialing(): {
  before: EntitlementSnapshot;
  after: EntitlementSnapshot;
  effects: Effect[];
} {
  const t = next(FREE_START, { type: 'trial_started', at: AT, variant: 'no_card' });
  if (t.outcome !== 'applied') throw new Error('the trial did not start');
  return { before: FREE_START, after: t.state, effects: t.effects };
}

describe('planEffects', () => {
  it('plans a started trial as trial.started with its end, and entitlement.changed; nothing for the limits', () => {
    const { before, after, effects } = trialing();
    // The machine also returns relimit and resume for this transition; the RPC applies those.
    expect(effects.map((e) => e.kind)).toEqual(['relimit', 'resume', 'event', 'event']);
    expect(planEffects(effects, ctx(before, after, 'trial-start'))).toEqual([
      {
        kind: 'send',
        id: `trial.started:${ACCOUNT}:trial-start`,
        name: 'trial.started',
        // 14 days after AT, computed here rather than read from the machine.
        data: {
          accountId: ACCOUNT,
          trialEndsAt: new Date(AT.getTime() + 14 * DAY).toISOString(),
          variant: 'no_card',
        },
      },
      {
        kind: 'send',
        id: `entitlement.changed:${ACCOUNT}:trial-start`,
        name: 'entitlement.changed',
        data: { accountId: ACCOUNT, from: 'free', to: 'pro_trial' },
      },
    ]);
  });

  it('plans a paid checkout from a no-card trial as trial.converted then entitlement.changed', () => {
    const { after: trial } = trialing();
    const t = next(trial, {
      type: 'checkout_completed',
      at: new Date(AT.getTime() + DAY),
      plan: 'pro',
      subscriptionId: 'sub_1',
      subscriptionStatus: 'active',
      extras: { seats: 0, sites: 0 },
    });
    expect(planEffects(t.effects, ctx(trial, t.state, 'evt_checkout'))).toEqual([
      {
        kind: 'send',
        id: `trial.converted:${ACCOUNT}:evt_checkout`,
        name: 'trial.converted',
        data: { accountId: ACCOUNT },
      },
      {
        kind: 'send',
        id: `entitlement.changed:${ACCOUNT}:evt_checkout`,
        name: 'entitlement.changed',
        data: { accountId: ACCOUNT, from: 'pro_trial', to: 'pro' },
      },
    ]);
  });

  it('plans the reminder as email.requested, the template named, and nothing else', () => {
    const { after: trial } = trialing();
    const t = next(trial, { type: 'trial_reminder_due', at: new Date(AT.getTime() + 11 * DAY) });
    expect(planEffects(t.effects, ctx(trial, t.state, 'trial-reminder:end'))).toEqual([
      {
        kind: 'send',
        id: `email.requested:trial_reminder:${ACCOUNT}:trial-reminder:end`,
        name: 'email.requested',
        data: { accountId: ACCOUNT, template: 'trial_reminder' },
      },
    ]);
  });

  it('plans a dispute as a founder alert naming the source', () => {
    const t = next(FREE_START, { type: 'dispute_created', at: AT });
    const planned = planEffects(t.effects, ctx(FREE_START, t.state, 'evt_dispute'));
    expect(planned).toContainEqual({
      kind: 'alert',
      reason: 'dispute',
      accountId: ACCOUNT,
      subscriptionId: null,
      source: 'evt_dispute',
    });
  });

  it('plans nothing for the four effects apply_entitlement_transition carries out', () => {
    const done: Effect[] = [
      { kind: 'relimit' },
      { kind: 'pause_others' },
      { kind: 'pause_over_limit' },
      { kind: 'resume' },
    ];
    expect(planEffects(done, ctx(FREE_START, FREE_START))).toEqual([]);
  });

  it('gives every effect kind the machine can return a plan the stored-plan schema accepts', () => {
    const { after: trial } = trialing();
    // Every variant of `Effect` (state-machine.ts), by kind and by name or template.
    const every: Effect[] = [
      { kind: 'relimit' },
      { kind: 'pause_others' },
      { kind: 'pause_over_limit' },
      { kind: 'resume' },
      { kind: 'email', template: 'trial_reminder' },
      { kind: 'event', name: 'trial.started' },
      { kind: 'event', name: 'trial.converted' },
      { kind: 'event', name: 'entitlement.changed' },
      { kind: 'founder_alert', reason: 'dispute' },
    ];
    const planned = planEffects(every, ctx(FREE_START, trial));
    expect(planned).toHaveLength(5);
    expect(PlannedEffectsSchema.parse(planned)).toEqual(planned);
  });

  it('fixes ids by account and source, so a repeated plan repeats its ids and another source does not', () => {
    const { before, after, effects } = trialing();
    const ids = (source: string) =>
      planEffects(effects, ctx(before, after, source)).map((p) =>
        p.kind === 'send' ? p.id : p.source,
      );
    expect(ids('evt_a')).toEqual(ids('evt_a'));
    expect(ids('evt_a').filter((id) => ids('evt_b').includes(id))).toEqual([]);
  });

  it('refuses trial.started from a snapshot with no trial', () => {
    expect(() =>
      planEffects([{ kind: 'event', name: 'trial.started' }], ctx(FREE_START, FREE_START)),
    ).toThrow('trial.started from a snapshot with no trial');
  });
});

describe('PlannedEffectsSchema', () => {
  it.each([
    ['an unknown event name', [{ kind: 'send', id: 'x', name: 'site.deleted', data: {} }]],
    [
      'an extra field',
      [{ kind: 'send', id: 'x', name: 'trial.converted', data: { accountId: 'a', more: 1 } }],
    ],
    ['an empty id', [{ kind: 'send', id: '', name: 'trial.converted', data: { accountId: 'a' } }]],
    [
      'not an array',
      { kind: 'alert', reason: 'dispute', accountId: 'a', subscriptionId: null, source: 's' },
    ],
    [
      'a cancel of something not a subscription',
      [{ kind: 'cancel', subscriptionId: 'cus_1', reason: 'orphaned', source: 's' }],
    ],
    [
      'a cancel for a reason the webhook has none of',
      [{ kind: 'cancel', subscriptionId: 'sub_1', reason: 'unpaid', source: 's' }],
    ],
  ])('refuses %s', (_label, stored) => {
    expect(PlannedEffectsSchema.safeParse(stored).success).toBe(false);
  });
});

describe('dispatchPlanned', () => {
  const plan: PlannedEffect[] = [
    {
      kind: 'alert',
      reason: 'dispute',
      accountId: ACCOUNT,
      subscriptionId: 'sub_1',
      source: 'evt_1',
    },
    { kind: 'cancel', subscriptionId: 'sub_1', reason: 'disputed', source: 'evt_1' },
    { kind: 'send', id: 'a', name: 'trial.converted', data: { accountId: ACCOUNT } },
    {
      kind: 'send',
      id: 'b',
      name: 'entitlement.changed',
      data: { accountId: ACCOUNT, from: 'pro', to: 'free' },
    },
  ];

  function sinks(send: EffectSinks['send'] = async () => {}): EffectSinks & {
    calls: string[];
  } {
    const calls: string[] = [];
    return {
      calls,
      send: vi.fn(async (events: readonly InngestSend[]) => {
        calls.push(`send:${events.map((e) => e.id).join(',')}`);
        await send(events);
      }),
      cancel: vi.fn(async (c: PlannedCancel) => {
        calls.push(`cancel:${c.subscriptionId}`);
      }),
      alert: vi.fn(async (a: PlannedAlert) => {
        calls.push(`alert:${a.reason}`);
      }),
    };
  }

  it('sends every event in one call, without the plan tag, then cancels, then raises the alerts', async () => {
    const s = sinks();
    await dispatchPlanned(plan, s);
    expect(s.calls).toEqual(['send:a,b', 'cancel:sub_1', 'alert:dispute']);
    expect(s.send).toHaveBeenCalledWith([
      { id: 'a', name: 'trial.converted', data: { accountId: ACCOUNT } },
      {
        id: 'b',
        name: 'entitlement.changed',
        data: { accountId: ACCOUNT, from: 'pro', to: 'free' },
      },
    ]);
  });

  it('makes no send call for a plan with no events', async () => {
    const s = sinks();
    await dispatchPlanned([plan[0]!], s);
    expect(s.calls).toEqual(['alert:dispute']);
  });

  it('throws when the send fails, before any cancellation or alert', async () => {
    const s = sinks(async () => {
      throw new Error('inngest down');
    });
    await expect(dispatchPlanned(plan, s)).rejects.toThrow('inngest down');
    expect(s.cancel).not.toHaveBeenCalled();
    expect(s.alert).not.toHaveBeenCalled();
  });

  it('waits for an alert to be raised, and fails when raising it fails', async () => {
    const s = sinks();
    s.alert = vi.fn(async () => {
      throw new Error('not raised');
    });
    await expect(dispatchPlanned([plan[0]!], s)).rejects.toThrow('not raised');
  });
});
