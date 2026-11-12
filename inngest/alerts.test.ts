import { NonRetriableError } from 'inngest';
import { describe, expect, it } from 'vitest';
import { ALERT_FN_ID, ALERT_RETRIES, createAlertFn, type AlertWork } from './alerts';
import { inngest } from './client';
import { PLAN_CONCURRENCY_CAP } from './concurrency';

const CHECK = 'c0000000-0000-4000-8000-000000000002';

const config = (fn: unknown) =>
  (
    fn as { getConfig(o: { baseUrl: URL; appPrefix: string }): Record<string, unknown>[] }
  ).getConfig({ baseUrl: new URL('https://example.com/api/inngest'), appPrefix: inngest.id })[0]!;

async function run(work: AlertWork) {
  const ids: string[] = [];
  const fn = createAlertFn(work, {}) as unknown as { fn: (ctx: unknown) => Promise<unknown> };
  const out = await fn.fn({
    event: { data: { checkId: CHECK, siteId: 's', accountId: null, status: 'finished' } },
    step: {
      run: async (id: string, body: () => Promise<unknown>) => {
        ids.push(id);
        return body();
      },
    },
  });
  return { out, ids };
}

describe('createAlertFn (D5)', () => {
  it('runs on check.finished, with retries for the ledgers’ three attempts, within the plan cap', () => {
    const c = config(
      createAlertFn(
        { plan: async () => ({ skip: 'x' }), deliver: async () => ({ status: 'none' }) },
        {
          INNGEST_ALERT_CONCURRENCY: '50',
        },
      ),
    );
    expect(c).toMatchObject({
      id: `${inngest.id}-${ALERT_FN_ID}`,
      triggers: [{ event: 'check.finished' }],
      concurrency: { limit: PLAN_CONCURRENCY_CAP },
    });
    expect(ALERT_RETRIES).toBeGreaterThanOrEqual(3);
  });

  it('plans, then sends each channel the plan names in its own step', async () => {
    const delivered: string[] = [];
    const { out, ids } = await run({
      plan: async () => ({ fired: 2, channels: ['email', 'slack'] }),
      deliver: async (checkId, channel) => {
        delivered.push(`${checkId} ${channel}`);
        return { status: 'sent', reason: null };
      },
    });
    expect(ids).toEqual(['plan', 'email', 'slack']);
    expect(delivered).toEqual([`${CHECK} email`, `${CHECK} slack`]);
    expect(out).toEqual({
      fired: 2,
      sent: { email: { status: 'sent', reason: null }, slack: { status: 'sent', reason: null } },
    });
  });

  it('stops after the plan when the check alerts nothing', async () => {
    const { out, ids } = await run({
      plan: async () => ({ skip: 'first_check' }),
      deliver: async () => {
        throw new Error('not reached');
      },
    });
    expect(ids).toEqual(['plan']);
    expect(out).toEqual({ skip: 'first_check' });
  });

  it('runs the Slack step when the email step failed every retry, then ends the run failed, not retried', async () => {
    const delivered: string[] = [];
    const err = await run({
      plan: async () => ({ fired: 2, channels: ['email', 'slack'] }),
      deliver: async (_checkId, channel) => {
        if (channel === 'email') throw new Error('mail send to be retried: provider_503');
        delivered.push(channel);
        return { status: 'sent', reason: null };
      },
    }).catch((e: unknown) => e);
    expect(delivered).toEqual(['slack']);
    expect(err).toBeInstanceOf(NonRetriableError);
    expect((err as Error).message).toBe('alert channels failed: email');
  });

  it('runs the email step when the Slack step failed, in the order the plan names them', async () => {
    const delivered: string[] = [];
    const err = await run({
      plan: async () => ({ fired: 1, channels: ['slack', 'email'] }),
      deliver: async (_checkId, channel) => {
        if (channel === 'slack') throw new Error('slack send to be retried: slack_503');
        delivered.push(channel);
        return { status: 'sent', reason: null };
      },
    }).catch((e: unknown) => e);
    expect(delivered).toEqual(['email']);
    expect((err as Error).message).toBe('alert channels failed: slack');
  });
});
