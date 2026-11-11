import { NonRetriableError } from 'inngest';
import { describe, expect, it, vi } from 'vitest';
import { inngest } from './client';
import { PLAN_CONCURRENCY_CAP } from './concurrency';
import {
  createDeletionCancelFn,
  createDeletionResumeFn,
  createPurgeDeletedAccountsFn,
  DELETION_CANCEL_FN_ID,
  DELETION_RESUME_FN_ID,
  PURGE_DELETED_ACCOUNTS_FN_ID,
  PURGE_LIMIT,
  type DeletionBilling,
  type Purge,
} from './deletion';

type Config = Record<string, unknown>;
const configOf = (fn: unknown): Config =>
  (fn as { getConfig(o: { baseUrl: URL; appPrefix: string }): Config[] }).getConfig({
    baseUrl: new URL('https://crawlmouse.com/api/webhooks/inngest'),
    appPrefix: inngest.id,
  })[0]!;
type Handler = (ctx: { event?: unknown; step: unknown }) => Promise<unknown>;
const handler = (fn: unknown) => (fn as { fn: Handler }).fn;

/** Inngest's step tool within one invocation: each step runs once, its output through JSON. */
function steps() {
  const ran: string[] = [];
  const step = {
    run: async (id: string, fn: () => unknown) => {
      ran.push(id);
      return JSON.parse(JSON.stringify((await fn()) ?? null)) as unknown;
    },
  };
  return { step, ran };
}

const billing = (): DeletionBilling => ({
  cancel: vi.fn(async () => 'cancelled'),
  resume: vi.fn(async () => 'resumed'),
});

describe('the configs', () => {
  it('the cancel runs per marked account, one at a time per person with the resume, and stops on a restore', () => {
    const cancel = configOf(createDeletionCancelFn(billing));
    const resume = configOf(createDeletionResumeFn(billing));
    const perPerson = [{ scope: 'env', key: '"account-deletion:" + event.data.userId', limit: 1 }];
    expect(cancel).toMatchObject({
      id: `crawlmouse-${DELETION_CANCEL_FN_ID}`,
      triggers: [{ event: 'account.deletion_confirmed' }],
      concurrency: perPerson,
      cancel: [{ event: 'account.restored', if: 'event.data.userId == async.data.userId' }],
    });
    expect(resume).toMatchObject({
      id: `crawlmouse-${DELETION_RESUME_FN_ID}`,
      triggers: [{ event: 'account.restored' }],
      concurrency: perPerson,
    });
  });

  it('the purge runs daily, alone, within the plan cap', () => {
    const p = configOf(createPurgeDeletedAccountsFn(() => ({}) as Purge));
    expect(p).toMatchObject({
      id: `crawlmouse-${PURGE_DELETED_ACCOUNTS_FN_ID}`,
      triggers: [{ cron: '30 3 * * *' }],
      concurrency: { limit: 1 },
    });
    expect((p.concurrency as { limit: number }).limit).toBeLessThanOrEqual(PLAN_CONCURRENCY_CAP);
  });
});

describe('the cancel and the resume', () => {
  it('the cancel ends the event’s account for the event’s person, in one step', async () => {
    const b = billing();
    const { step, ran } = steps();
    const out = await handler(createDeletionCancelFn(() => b))({
      event: { data: { userId: 'u1', accountId: 'a1' } },
      step,
    });
    expect(b.cancel).toHaveBeenCalledWith('u1', 'a1');
    expect(ran).toEqual(['cancel']);
    expect(out).toBe('cancelled');
  });

  it('the resume continues each subscription named, a step each', async () => {
    const b = billing();
    const { step, ran } = steps();
    await handler(createDeletionResumeFn(() => b))({
      event: { data: { userId: 'u1', subscriptionIds: ['sub_1', 'sub_2'] } },
      step,
    });
    expect(ran).toEqual(['resume-sub_1', 'resume-sub_2']);
    expect(vi.mocked(b.resume).mock.calls).toEqual([['sub_1'], ['sub_2']]);
  });
});

describe('purgeDeletedAccountsFn', () => {
  const NOW = Date.parse('2026-11-20T03:30:00.000Z');
  function fakePurge(over: Partial<Purge> = {}): Purge {
    return {
      now: () => NOW,
      due: vi.fn(async () => [
        { userId: 'u1', accounts: ['a1'] },
        { userId: 'u2', accounts: ['a2'] },
        { userId: 'u3', accounts: ['a3'] },
      ]),
      purgeOne: vi.fn(async ({ userId }) =>
        userId === 'u2'
          ? { outcome: 'refused' as const, refusals: ['subscription sub_9 is live'] }
          : { outcome: 'purged' as const, counts: { 'accounts deleted': 1 } },
      ),
      failed: vi.fn(async () => {}),
      sweepLinks: vi.fn(async () => 4),
      ...over,
    };
  }

  it('asks for the people due at its time, purges each in its own step, then sweeps the links', async () => {
    const p = fakePurge();
    const { step, ran } = steps();
    const out = await handler(createPurgeDeletedAccountsFn(() => p))({ step });
    expect(p.due).toHaveBeenCalledWith(new Date(NOW), PURGE_LIMIT);
    expect(ran).toEqual(['now', 'due', 'purge-u1', 'purge-u2', 'purge-u3', 'sweep-links']);
    expect(out).toEqual({ due: 3, purged: 2, refused: 1, links: 4 });
    expect(p.failed).not.toHaveBeenCalled();
  });

  it('a person whose step fails is counted and reported, the others still go, and the run ends failed', async () => {
    const p = fakePurge({
      purgeOne: vi.fn(async ({ userId }) => {
        if (userId === 'u1') throw new Error('Auth admin delete failed: 503');
        return { outcome: 'purged' as const, counts: {} };
      }),
    });
    const { step, ran } = steps();
    await expect(handler(createPurgeDeletedAccountsFn(() => p))({ step })).rejects.toThrow(
      NonRetriableError,
    );
    expect(p.failed).toHaveBeenCalledWith('u1', 'Auth admin delete failed: 503');
    expect(ran).toEqual([
      'now',
      'due',
      'purge-u1',
      'failed-u1',
      'purge-u2',
      'purge-u3',
      'sweep-links',
    ]);
  });
});
