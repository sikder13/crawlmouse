import { describe, expect, it, vi } from 'vitest';
import {
  runDueSchedules,
  skipReason,
  type DueSchedule,
  type ScheduleRunStore,
} from './schedules-run';

// One run of the client report schedules (CC-31 D8), with the store and the mail port faked: each
// decision of schedules-run.ts, and that a run sends nothing twice. The store over the real SQL is
// schedules-run.pglite.test.ts.

const NOW = new Date('2026-11-16T09:04:00.000Z');
const SLOT = '2026-11-16T09:00:00.000Z';
const ACCOUNT = '6f1c2a8e-0000-4000-8000-00000000000a';

const AGENCY: DueSchedule['account'] = {
  state: 'agency',
  tier: 'agency',
  pastDueTier: null,
  pastDueSince: null,
  trialVariant: null,
  trialEndsAt: null,
};

let n = 0;
/** A schedule whose report is sent: confirmed contact, a check, a change, on Agency. */
const due = (over: Partial<DueSchedule> = {}): DueSchedule => ({
  siteId: `site-${++n}`,
  accountId: ACCOUNT,
  slot: SLOT,
  sendWhenUnchanged: false,
  hasContact: true,
  confirmed: true,
  confirmationRequested: true,
  contactIsOwner: false,
  account: AGENCY,
  checkId: 'check-1',
  changed: true,
  ...over,
});

/** A fake store that keeps one report row a site and slot, as `write_client_report` does. */
function fakes(schedules: DueSchedule[], mailAnswer: 'sent' | 'queued' = 'sent') {
  const reports = new Map<string, { reportId: string; status: 'scheduled' | 'sent' }>();
  const ran = new Set<string>();
  const sentBefore = new Set<string>();
  const store: ScheduleRunStore = {
    due: vi.fn(async () => schedules.filter((s) => !ran.has(s.siteId))),
    writeReport: vi.fn(async (siteId: string, slot: string) => {
      const key = `${siteId}:${slot}`;
      if (!reports.has(key)) reports.set(key, { reportId: `report-${key}`, status: 'scheduled' });
      return { ...reports.get(key)! };
    }),
    markSent: vi.fn(async (reportId: string) => {
      const row = [...reports.values()].find((r) => r.reportId === reportId)!;
      row.status = 'sent';
      const first = !sentBefore.has(ACCOUNT);
      sentBefore.add(ACCOUNT);
      return { accountId: ACCOUNT, first };
    }),
    markRun: vi.fn(async (siteId: string) => {
      ran.add(siteId);
    }),
  };
  const mail = {
    confirmation: vi.fn(async (_req: { siteId: string; key: string }) => undefined),
    report: vi.fn(async (_req: { reportId: string }) => mailAnswer),
  };
  const capture = vi.fn(async (..._a: unknown[]) => undefined);
  return { store, mail, capture, now: () => NOW, reports };
}

describe('skipReason', () => {
  it('is null for a confirmed contact on Agency with a check and a change', () => {
    expect(skipReason(due(), NOW)).toBeNull();
  });

  it.each([
    ['a Pro account', { account: { ...AGENCY, state: 'pro', tier: 'pro' } }, 'plan'],
    ['a Free account', { account: { ...AGENCY, state: 'free', tier: 'free' } }, 'plan'],
    [
      'an Agency account past due for more than seven days',
      {
        account: {
          ...AGENCY,
          state: 'past_due',
          pastDueTier: 'agency',
          pastDueSince: new Date('2026-11-01T00:00:00Z'),
        },
      },
      'plan',
    ],
    ['no contact', { hasContact: false, confirmed: false }, 'no_contact'],
    ['a contact that has not confirmed', { confirmed: false }, 'unconfirmed'],
    [
      'an Agency trial whose contact is not the owner',
      { account: { ...AGENCY, state: 'agency_trial' } },
      'trial',
    ],
    ['no finished check', { checkId: null }, 'no_check'],
    ['nothing changed', { changed: false }, 'unchanged'],
  ] as const)('%s: %s', (_name, over, reason) => {
    expect(skipReason(due(over as Partial<DueSchedule>), NOW)).toBe(reason);
  });

  it('an Agency trial sends to the owner’s own address, once it has confirmed', () => {
    const trial = { account: { ...AGENCY, state: 'agency_trial' as const }, contactIsOwner: true };
    expect(skipReason(due(trial), NOW)).toBeNull();
    expect(skipReason(due({ ...trial, confirmed: false }), NOW)).toBe('unconfirmed');
  });

  it('nothing changed still sends when the schedule says to', () => {
    expect(skipReason(due({ changed: false, sendWhenUnchanged: true }), NOW)).toBeNull();
  });

  it('an Agency account past due inside its seven days still sends', () => {
    const account = {
      ...AGENCY,
      state: 'past_due' as const,
      pastDueTier: 'agency' as const,
      pastDueSince: new Date('2026-11-14T00:00:00Z'),
    };
    expect(skipReason(due({ account }), NOW)).toBeNull();
  });
});

describe('runDueSchedules', () => {
  it('sends a due report: the row for the slot and its check, the mail by the report’s id, sent, and the schedule moved on', async () => {
    const s = due();
    const f = fakes([s]);
    expect(await runDueSchedules(f)).toEqual({
      due: 1,
      sent: 1,
      queued: 0,
      confirmations: 0,
      skipped: {},
    });
    expect(f.store.writeReport).toHaveBeenCalledWith(s.siteId, SLOT, 'check-1', NOW);
    const reportId = `report-${s.siteId}:${SLOT}`;
    expect(f.mail.report.mock.calls).toEqual([[{ reportId }]]);
    expect(f.store.markSent).toHaveBeenCalledWith(reportId, NOW);
    expect(f.store.markRun).toHaveBeenCalledWith(s.siteId, NOW);
    expect(f.mail.confirmation).not.toHaveBeenCalled();
  });

  it('leaves the row scheduled when the mail was only handed on, and does not say it was sent', async () => {
    const f = fakes([due()], 'queued');
    expect(await runDueSchedules(f)).toMatchObject({ sent: 0, queued: 1 });
    expect(f.store.markSent).not.toHaveBeenCalled();
    expect(f.capture).not.toHaveBeenCalled();
    expect([...f.reports.values()].map((r) => r.status)).toEqual(['scheduled']);
  });

  it('an unconfirmed contact gets the confirmation asked for once, keyed by the slot, and no report', async () => {
    const [fresh, asked] = [
      due({ confirmed: false, confirmationRequested: false }),
      due({ confirmed: false, confirmationRequested: true }),
    ];
    const f = fakes([fresh, asked]);
    expect(await runDueSchedules(f)).toEqual({
      due: 2,
      sent: 0,
      queued: 0,
      confirmations: 1,
      skipped: { unconfirmed: 2 },
    });
    expect(f.mail.confirmation.mock.calls).toEqual([[{ siteId: fresh.siteId, key: SLOT }]]);
    expect(f.mail.report).not.toHaveBeenCalled();
    expect(f.store.writeReport).not.toHaveBeenCalled();
  });

  it('a trial account sends to its owner’s own address and to no other', async () => {
    const trial = { ...AGENCY, state: 'agency_trial' as const };
    const [own, client] = [
      due({ account: trial, contactIsOwner: true }),
      due({ account: trial, contactIsOwner: false }),
    ];
    const f = fakes([own, client]);
    expect(await runDueSchedules(f)).toMatchObject({ sent: 1, skipped: { trial: 1 } });
    expect(f.mail.report.mock.calls).toEqual([[{ reportId: `report-${own.siteId}:${SLOT}` }]]);
    expect(f.mail.confirmation).not.toHaveBeenCalled();
  });

  it('sends nothing for an unchanged site, a site with no check, a client with no contact and a plan without client reports, and moves each on', async () => {
    const all = [
      due({ changed: false }),
      due({ checkId: null }),
      due({ hasContact: false, confirmed: false, confirmationRequested: false }),
      due({ account: { ...AGENCY, state: 'pro', tier: 'pro' } }),
    ];
    const f = fakes(all);
    expect(await runDueSchedules(f)).toEqual({
      due: 4,
      sent: 0,
      queued: 0,
      confirmations: 0,
      skipped: { unchanged: 1, no_check: 1, no_contact: 1, plan: 1 },
    });
    expect(f.mail.report).not.toHaveBeenCalled();
    expect(f.mail.confirmation).not.toHaveBeenCalled();
    expect(f.store.writeReport).not.toHaveBeenCalled();
    expect(vi.mocked(f.store.markRun).mock.calls.map((c) => c[0])).toEqual(
      all.map((s) => s.siteId),
    );
  });

  it('a second run in the same hour sends nothing twice', async () => {
    const f = fakes([due(), due({ confirmed: false, confirmationRequested: false })]);
    await runDueSchedules(f);
    expect(await runDueSchedules(f)).toEqual({
      due: 0,
      sent: 0,
      queued: 0,
      confirmations: 0,
      skipped: {},
    });
    expect(f.mail.report).toHaveBeenCalledTimes(1);
    expect(f.mail.confirmation).toHaveBeenCalledTimes(1);
  });

  it('a run that stopped after the mail went sends no second mail for the slot', async () => {
    const s = due();
    const f = fakes([s]);
    vi.mocked(f.store.markRun).mockRejectedValueOnce(new Error('connection lost'));
    await expect(runDueSchedules(f)).rejects.toThrow('connection lost');
    expect(await runDueSchedules(f)).toMatchObject({ due: 1, sent: 1 });
    expect(f.mail.report).toHaveBeenCalledTimes(1);
    expect(f.store.markSent).toHaveBeenCalledTimes(1);
  });

  it('sends first_client_report_sent once for the account, with no property', async () => {
    const f = fakes([due(), due(), due()]);
    await runDueSchedules(f);
    expect(f.capture.mock.calls).toEqual([['first_client_report_sent', ACCOUNT, {}]]);
  });

  it('counts a slot whose row could not be written, and sends nothing for it', async () => {
    const f = fakes([due()]);
    vi.mocked(f.store.writeReport).mockResolvedValueOnce(null);
    expect(await runDueSchedules(f)).toMatchObject({ sent: 0, skipped: { no_report: 1 } });
    expect(f.mail.report).not.toHaveBeenCalled();
  });
});
