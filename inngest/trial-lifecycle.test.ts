import { describe, expect, it, vi } from 'vitest';
import { inngest } from './client';
import {
  createTrialLifecycleFn,
  TRIAL_LIFECYCLE_FN_ID,
  type ClockDecision,
  type TrialClock,
} from './trial-lifecycle';

const ACCOUNT = '0b6f3c1e-8a4d-4f2b-9c7e-5d1a2b3c4d5e';
const END = '2099-01-15T00:00:00.000Z';
// Three days before END, written out rather than computed from the module's constant.
const REMINDER = '2099-01-12T00:00:00.000Z';

const event = (trialEndsAt = END) => ({
  name: 'trial.started',
  data: { accountId: ACCOUNT, trialEndsAt, variant: 'no_card' },
});

const decided = (planned: unknown[] = []): ClockDecision => ({
  outcome: 'applied',
  reason: null,
  planned,
});

/**
 * A step tool that behaves as Inngest's does across invocations: a step that returned is recorded
 * (through JSON, as Inngest stores it) and not run again; a step that threw is not recorded, so the
 * next invocation runs it again.
 */
function memoStep() {
  const memo = new Map<string, unknown>();
  const ran: string[] = [];
  const slept: { id: string; until: string }[] = [];
  const step = {
    run: async (id: string, fn: () => unknown) => {
      if (memo.has(id)) return memo.get(id);
      ran.push(id);
      const out = JSON.parse(JSON.stringify((await fn()) ?? null)) as unknown;
      memo.set(id, out);
      return out;
    },
    sleepUntil: async (id: string, until: Date | string) => {
      if (memo.has(id)) return;
      slept.push({ id, until: new Date(until).toISOString() });
      memo.set(id, null);
    },
  };
  return { step, memo, ran, slept };
}

/** A clock whose every method is a mock: the reminder step wakes on time unless `now` says otherwise. */
function fakeClock(over: Partial<TrialClock> = {}) {
  return {
    now: vi.fn<TrialClock['now']>(over.now ?? (() => Date.parse(REMINDER))),
    remind: vi.fn<TrialClock['remind']>(
      over.remind ?? (async () => decided([{ kind: 'send', id: 'reminder' }])),
    ),
    expire: vi.fn<TrialClock['expire']>(
      over.expire ?? (async () => decided([{ kind: 'send', id: 'expiry' }])),
    ),
    dispatch: vi.fn<TrialClock['dispatch']>(over.dispatch ?? (async () => {})),
  };
}

type Handler = (ctx: { event: unknown; step: unknown }) => Promise<unknown>;
const handlerOf = (clock: TrialClock) =>
  (createTrialLifecycleFn(() => clock) as unknown as { fn: Handler }).fn;

describe('trialLifecycleFn config (CC-03 D9a)', () => {
  const [config] = (
    createTrialLifecycleFn(() => fakeClock()) as unknown as {
      getConfig(o: { baseUrl: URL; appPrefix: string }): Record<string, unknown>[];
    }
  ).getConfig({
    baseUrl: new URL('https://crawlmouse.com/api/webhooks/inngest'),
    appPrefix: inngest.id,
  });

  it('runs on trial.started, once per account, cancelled by the account’s trial.converted or deletion', () => {
    expect(config).toMatchObject({
      id: `crawlmouse-${TRIAL_LIFECYCLE_FN_ID}`,
      triggers: [{ event: 'trial.started' }],
      idempotency: 'event.data.accountId',
      cancel: [
        { event: 'trial.converted', if: 'event.data.accountId == async.data.accountId' },
        {
          event: 'account.deletion_confirmed',
          if: 'event.data.accountId == async.data.accountId',
        },
      ],
    });
    expect(TRIAL_LIFECYCLE_FN_ID).toBe('crawlmouse.trial.lifecycle');
  });

  it('declares a concurrency limit of 2, within the Inngest plan cap of 5', () => {
    expect(config!.concurrency).toEqual({ limit: 2 });
  });
});

describe('trialLifecycleFn steps', () => {
  it('sleeps to three days before the end, reminds and sends, sleeps to the end, expires and sends', async () => {
    const clock = fakeClock();
    const { step, ran, slept } = memoStep();
    const out = await handlerOf(clock)({ event: event(), step });
    expect(slept).toEqual([
      { id: 'reminder-due', until: REMINDER },
      { id: 'trial-ends', until: END },
    ]);
    expect(ran).toEqual(['remind', 'remind-effects', 'expire', 'expire-effects']);
    expect(clock.remind).toHaveBeenCalledWith(ACCOUNT, new Date(REMINDER));
    expect(clock.expire).toHaveBeenCalledWith(ACCOUNT, new Date(END));
    expect(clock.dispatch.mock.calls).toEqual([
      [[{ kind: 'send', id: 'reminder' }]],
      [[{ kind: 'send', id: 'expiry' }]],
    ]);
    expect(out).toEqual({ remind: 'applied', expire: 'applied' });
  });

  it('returns what the machine decided: a converted trial is ignored at both steps', async () => {
    const ignored: ClockDecision = {
      outcome: 'ignored',
      reason: 'not a no-card trial',
      planned: [],
    };
    const clock = fakeClock({ remind: async () => ignored, expire: async () => ignored });
    const out = await handlerOf(clock)({ event: event(), step: memoStep().step });
    expect(out).toEqual({ remind: 'ignored', expire: 'ignored' });
  });

  it('skips the reminder when its step wakes at the trial’s end or later (a late trial.started)', async () => {
    for (const now of [Date.parse(END), Date.parse(END) + 1]) {
      const clock = fakeClock({ now: () => now });
      const { step, ran, memo } = memoStep();
      const out = await handlerOf(clock)({ event: event(), step });
      expect(clock.remind).not.toHaveBeenCalled();
      expect(memo.get('remind')).toEqual({ outcome: 'skipped', reason: 'the trial has ended' });
      expect(ran).toEqual(['remind', 'expire', 'expire-effects']);
      // Only the expiry's plan is sent: no reminder email after the end.
      expect(clock.dispatch.mock.calls).toEqual([[[{ kind: 'send', id: 'expiry' }]]]);
      expect(out).toEqual({ remind: 'skipped', expire: 'applied' });
    }
  });

  it('still reminds one millisecond before the end', async () => {
    const clock = fakeClock({ now: () => Date.parse(END) - 1 });
    await handlerOf(clock)({ event: event(), step: memoStep().step });
    expect(clock.remind).toHaveBeenCalledTimes(1);
  });

  it('a failed send is retried with the recorded plan; the event is not applied again', async () => {
    const clock = fakeClock({
      dispatch: vi
        .fn<TrialClock['dispatch']>()
        .mockRejectedValueOnce(new Error('inngest send failed'))
        .mockResolvedValue(undefined),
    });
    const { step, memo } = memoStep();
    const handler = handlerOf(clock);
    await expect(handler({ event: event(), step })).rejects.toThrow('inngest send failed');
    expect(memo.get('remind')).toEqual(decided([{ kind: 'send', id: 'reminder' }]));
    expect(memo.has('remind-effects')).toBe(false);

    // Inngest runs the function again from the top: the recorded steps return their outputs.
    await handler({ event: event(), step });
    expect(clock.remind).toHaveBeenCalledTimes(1);
    expect(clock.dispatch.mock.calls.slice(0, 2)).toEqual([
      [[{ kind: 'send', id: 'reminder' }]],
      [[{ kind: 'send', id: 'reminder' }]],
    ]);
  });

  it('refuses an event without a readable end, without sleeping or applying', async () => {
    const clock = fakeClock();
    const { step, ran, slept } = memoStep();
    await expect(handlerOf(clock)({ event: event('not a date'), step })).rejects.toThrow(
      'trialEndsAt',
    );
    expect([...ran, ...slept.map((s) => s.id)]).toEqual([]);
  });
});
