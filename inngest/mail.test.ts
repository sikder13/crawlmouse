import { describe, expect, it, vi } from 'vitest';
import { inngest } from './client';
import { PLAN_CONCURRENCY_CAP } from './concurrency';
import {
  ACCOUNT_MAIL_FN_ID,
  CHECK_FINISHED_EVENT_FN_ID,
  CHECK_NOTIFY_FN_ID,
  CLIENT_REPORT_FN_ID,
  createAccountMailFn,
  createCheckFinishedEventFn,
  createCheckNotifyFn,
  createClientReportFn,
  createFixToDeveloperFn,
  createReportConfirmFn,
  createSeatInviteFn,
  FIX_TO_DEVELOPER_FN_ID,
  guarded,
  MAIL_RETRIES,
  REPORT_CONFIRM_FN_ID,
  SEAT_INVITE_FN_ID,
  type MailHandlers,
  type ReportMailHandlers,
} from './mail';

type Config = Record<string, unknown>;
const configOf = (fn: unknown): Config =>
  (fn as { getConfig(o: { baseUrl: URL; appPrefix: string }): Config[] }).getConfig({
    baseUrl: new URL('https://crawlmouse.com/api/webhooks/inngest'),
    appPrefix: inngest.id,
  })[0]!;
type Handler = (ctx: { event?: unknown; step: unknown }) => Promise<unknown>;
const handler = (fn: unknown) => (fn as { fn: Handler }).fn;

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

const handlers = (over: Partial<MailHandlers> = {}): MailHandlers => ({
  accountEmail: vi.fn(async () => 'sent'),
  checkNotify: vi.fn(async () => 'sent'),
  fixToDeveloper: vi.fn(async () => 'sent'),
  checkFinished: vi.fn(async () => 'captured'),
  seatInvite: vi.fn(async () => 'sent'),
  ...over,
});

const reportHandlers = (over: Partial<ReportMailHandlers> = {}): ReportMailHandlers => ({
  reportConfirm: vi.fn(async () => 'sent'),
  clientReport: vi.fn(async () => 'sent'),
  ...over,
});

class MailRetry extends Error {
  constructor() {
    super('mail send to be retried: busy');
    this.name = 'MailRetry';
  }
}

describe('the configs', () => {
  it('each listens to its events, within the plan cap, with room to retry past a claim’s lease', () => {
    const h = () => handlers();
    const cases = [
      [createAccountMailFn(h), ACCOUNT_MAIL_FN_ID, [{ event: 'email.requested' }]],
      [
        createCheckNotifyFn(h),
        CHECK_NOTIFY_FN_ID,
        [
          { event: 'check.notify_requested' },
          { event: 'check.finished' },
          { event: 'check.failed' },
        ],
      ],
      [
        createFixToDeveloperFn(h),
        FIX_TO_DEVELOPER_FN_ID,
        [{ event: 'fix.email_developer_requested' }],
      ],
      [createSeatInviteFn(h), SEAT_INVITE_FN_ID, [{ event: 'seat.invite.requested' }]],
      [
        createReportConfirmFn(() => reportHandlers()),
        REPORT_CONFIRM_FN_ID,
        [{ event: 'report.confirmation.requested' }],
      ],
      [
        createClientReportFn(() => reportHandlers()),
        CLIENT_REPORT_FN_ID,
        [{ event: 'report.send.requested' }],
      ],
    ] as const;
    for (const [fn, id, triggers] of cases) {
      const c = configOf(fn);
      expect(c).toMatchObject({ id: `crawlmouse-${id}`, triggers });
      expect((c.concurrency as { limit: number }).limit).toBeLessThanOrEqual(PLAN_CONCURRENCY_CAP);
      expect(c.steps).toMatchObject({ step: { retries: { attempts: MAIL_RETRIES } } });
    }
  });

  it('check_finished runs once per check: Inngest’s idempotency is keyed on the check id', () => {
    const c = configOf(createCheckFinishedEventFn(() => handlers()));
    expect(c).toMatchObject({
      id: `crawlmouse-${CHECK_FINISHED_EVENT_FN_ID}`,
      triggers: [{ event: 'check.finished' }],
      idempotency: 'event.data.checkId',
    });
  });
});

describe('the handlers run in one step, with the event’s ids', () => {
  it('passes each event’s data to its handler', async () => {
    const h = handlers();
    const data = { accountId: 'a1', template: 'account_delete', tokenId: 't1' };
    await handler(createAccountMailFn(() => h))({ event: { data }, step: steps().step });
    expect(h.accountEmail).toHaveBeenCalledWith(data);
    const { step, ran } = steps();
    for (const name of ['check.notify_requested', 'check.finished', 'check.failed']) {
      await handler(createCheckNotifyFn(() => h))({
        event: { name, data: { checkId: 'c1' } },
        step,
      });
    }
    expect(h.checkNotify).toHaveBeenNthCalledWith(3, 'c1');
    expect(ran).toEqual(['send', 'send', 'send']);
    await handler(createFixToDeveloperFn(() => h))({
      event: { data: { requestId: 'r1' } },
      step: steps().step,
    });
    expect(h.fixToDeveloper).toHaveBeenCalledWith('r1');
    const out = await handler(createCheckFinishedEventFn(() => h))({
      event: { data: { checkId: 'c1' } },
      step: steps().step,
    });
    expect(h.checkFinished).toHaveBeenCalledWith('c1');
    expect(out).toBe('captured');
  });

  it('an invitation’s event gives its handler the seat and the invitation’s number', async () => {
    const h = handlers();
    const { step, ran } = steps();
    const out = await handler(createSeatInviteFn(() => h))({
      event: { data: { seat_id: 's1', seq: 2 } },
      step,
    });
    expect(h.seatInvite).toHaveBeenCalledWith('s1', 2);
    expect(ran).toEqual(['send']);
    expect(out).toBe('sent');
  });

  it('a report schedule’s two events give their handlers the site with the request, and the report', async () => {
    const h = reportHandlers();
    const confirm = steps();
    await handler(createReportConfirmFn(() => h))({
      event: { data: { site_id: 'site1', request_id: 'req-7' } },
      step: confirm.step,
    });
    expect(h.reportConfirm).toHaveBeenCalledWith('site1', 'req-7');
    const report = steps();
    await handler(createClientReportFn(() => h))({
      event: { data: { report_id: 'rep1' } },
      step: report.step,
    });
    expect(h.clientReport).toHaveBeenCalledWith('rep1');
    expect([...confirm.ran, ...report.ran]).toEqual(['send', 'send']);
  });

  it('a retry signal from an invitation’s handler is thrown on, so its step retries', async () => {
    const h = handlers({ seatInvite: vi.fn(async () => Promise.reject(new MailRetry())) });
    await expect(
      handler(createSeatInviteFn(() => h))({
        event: { data: { seat_id: 's1', seq: 1 } },
        step: steps().step,
      }),
    ).rejects.toThrow('mail send to be retried');
  });
});

describe('guarded: a MailRetry retries; nothing else throws into the caller', () => {
  it('throws a MailRetry on, so Inngest retries the step', async () => {
    await expect(guarded('f', async () => Promise.reject(new MailRetry()))).rejects.toThrow(
      'mail send to be retried',
    );
  });

  it('ends on any other error, logging its name and not its message', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = new Error('to someone@example.com: https://hooks.example/abc');
    expect(await guarded('f', async () => Promise.reject(secret))).toBe('error');
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]![0])).not.toMatch(/someone|hooks/);
    err.mockRestore();
  });

  it('a function whose handler fails for another reason completes', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = handlers({ checkNotify: vi.fn(async () => Promise.reject(new TypeError('x'))) });
    const out = await handler(createCheckNotifyFn(() => h))({
      event: { data: { checkId: 'c1' } },
      step: steps().step,
    });
    expect(out).toBe('error');
    err.mockRestore();
  });
});
