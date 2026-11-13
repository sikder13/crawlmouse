import { describe, expect, it, vi } from 'vitest';
import type { AccountState } from '@crawlmouse/types/v2';
import { memoryLedger, memoryTransport, type MemoryTransport } from '../mail/memory';
import { MailRetry, type MailDeps } from '../mail/send';
import { DIGEST_FIGURES, type DigestCounts } from '../mail/templates/founder-digest';
import type { MailTransport } from '../mail/transport';
import type { OutgoingMail } from '../mail/types';
import {
  digest,
  entitlementNotice,
  FOUNDER_LIMIT,
  sweep,
  type EntitlementEvent,
  type FounderDeps,
  type LatestInvoice,
} from './founder';
import type { FounderStore, NoticeAccount, NoticeClaim, NoticeState } from './founder-store';

/**
 * The founder sender (D3) over the in-memory mail ledger and transport and an in-memory notice store
 * that decides as `claim_founder_notice` does (the SQL itself is __tests__/v2-033-founder.test.ts's).
 */

const FOUNDER = ['qzx-founder', 'inbox.example'].join('@');
const OWNER = ['owner', 'shop.example'].join('@');
const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const INTERNAL = 'a0000000-0000-4000-8000-0000000000ff';
const NOW = new Date('2026-11-13T15:00:00.000Z');
const id = (account = ACCOUNT, source = 'evt_1') => `entitlement.changed:${account}:${source}`;

interface Row {
  claim: NoticeClaim;
  state: NoticeState;
  overflowKey: string | null;
}

/** `claim_founder_notice` and `take_founder_overflow`'s decisions, kept in memory. */
function memoryNotices(accounts: Record<string, NoticeAccount> = {}) {
  const rows = new Map<string, Row>();
  const windows: [string, string][] = [];
  const counts = (n: number): DigestCounts =>
    Object.fromEntries(DIGEST_FIGURES.map(([k]) => [k, n])) as DigestCounts;
  const store: FounderStore = {
    async claim(c) {
      const had = rows.get(c.key);
      if (had) return had.state;
      const sent = [...rows.values()].filter(
        (r) =>
          r.state === 'send' &&
          r.claim.internal === c.internal &&
          r.claim.now.getTime() > c.now.getTime() - 3_600_000,
      ).length;
      const state: NoticeState = !c.configured ? 'skipped' : sent < c.limit ? 'send' : 'held';
      rows.set(c.key, { claim: c, state, overflowKey: null });
      return state;
    },
    async takeOverflow(key, n) {
      const mine = () => [...rows.values()].filter((r) => r.overflowKey === key);
      if (mine().length === 0)
        for (const r of rows.values())
          if (r.state === 'held' && r.overflowKey === null) r.overflowKey = key;
      return {
        total: mine().length,
        rows: mine()
          .slice(0, n)
          .map((r) => ({
            kind: r.claim.kind,
            accountId: r.claim.accountId,
            internal: r.claim.internal,
          })),
      };
    },
    async digestCounts(from, to) {
      windows.push([from, to]);
      return counts(windows.length);
    },
    async account(accountId) {
      return accounts[accountId] ?? null;
    },
    unannouncedUsers: vi.fn(async () => []),
    agencyAccounts: vi.fn(async () => []),
    cancellations: vi.fn(async () => []),
  };
  return { store, rows, windows };
}

const account = (over: Partial<NoticeAccount> = {}): NoticeAccount => ({
  internal: false,
  history: [
    { state: 'free', since: '2026-11-01T00:00:00.000Z' },
    { state: 'pro_trial', since: '2026-11-02T00:00:00.000Z' },
    { state: 'pro', since: '2026-11-13T14:59:00.000Z' },
  ],
  subscriptionId: 'sub_123',
  ownerEmail: OWNER,
  host: 'shop.example',
  ...over,
});

interface Setup {
  to?: string | null;
  transport?: MailTransport;
  invoice?: (sub: string) => Promise<LatestInvoice | null>;
  confirmed?: (user: string) => Promise<boolean>;
  accounts?: Record<string, NoticeAccount>;
  now?: Date;
}

function setup(s: Setup = {}) {
  const ledger = memoryLedger();
  const transport = (s.transport ?? memoryTransport()) as MemoryTransport;
  const log = vi.fn<FounderDeps['log']>();
  const mail: MailDeps = {
    ledger,
    transport,
    pepper: 'p'.repeat(40),
    now: () => s.now ?? NOW,
    log: () => undefined,
  };
  const notices = memoryNotices(
    s.accounts ?? { [ACCOUNT]: account(), [INTERNAL]: account({ internal: true }) },
  );
  const d: FounderDeps = {
    mail,
    store: notices.store,
    latestInvoice: vi.fn(
      s.invoice ?? (async () => ({ amountPaid: 1900, amountDue: 1900, currency: 'usd' })),
    ),
    confirmed: vi.fn(s.confirmed ?? (async () => true)),
    to: s.to === undefined ? FOUNDER : s.to,
    now: () => s.now ?? NOW,
    log,
  };
  return { d, ledger, transport, log, ...notices };
}

const change = (
  from: AccountState,
  to: AccountState,
  over: Partial<EntitlementEvent> = {},
): EntitlementEvent => ({
  id: id(over.accountId ?? ACCOUNT),
  accountId: ACCOUNT,
  from,
  to,
  occurredAt: '2026-11-13T14:59:00.000Z',
  ...over,
});

/** A transport that throws on its first send and records the rest. */
function throwsOnce(): MemoryTransport {
  const inner = memoryTransport();
  let thrown = false;
  return {
    sent: inner.sent,
    async send(m: OutgoingMail) {
      if (!thrown) {
        thrown = true;
        throw new Error('network');
      }
      return inner.send(m);
    },
  };
}

describe('entitlementNotice', () => {
  it('mails a first payment to FOUNDER_NOTIFY_TO, keyed by the event, with Stripe’s amount', async () => {
    const { d, transport, ledger } = setup();
    expect(await entitlementNotice(d, change('pro_trial', 'pro'))).toBe('sent');
    expect(transport.sent).toHaveLength(1);
    const m = transport.sent[0]!;
    expect(m.to).toBe(FOUNDER);
    expect(m.subject).toBe('First payment: Pro');
    expect(m.text).toContain('Amount: $19.00');
    expect(m.text).toContain(`Owner: ${OWNER}`);
    expect(m.idempotencyKey).toBe(`founder_event:entitlement:${id()}`);
    expect(d.latestInvoice).toHaveBeenCalledWith('sub_123');
    // The ledger row names no account: the founder's mail is in no customer's list.
    expect(ledger.claims.map((c) => [c.kind, c.accountId])).toEqual([['founder_event', null]]);
  });

  it('sends once for an event delivered twice', async () => {
    const { d, transport } = setup();
    expect(await entitlementNotice(d, change('free', 'pro_trial'))).toBe('sent');
    expect(await entitlementNotice(d, change('free', 'pro_trial'))).toBe('done');
    expect(transport.sent).toHaveLength(1);
  });

  it('a retry after the transport threw sends, exactly once', async () => {
    const { d, transport } = setup({ transport: throwsOnce() });
    await expect(entitlementNotice(d, change('free', 'pro_trial'))).rejects.toThrow(MailRetry);
    expect(await entitlementNotice(d, change('free', 'pro_trial'))).toBe('sent');
    expect(await entitlementNotice(d, change('free', 'pro_trial'))).toBe('done');
    expect(transport.sent).toHaveLength(1);
  });

  it('refuses an event whose id is missing, malformed or names another account, and claims nothing', async () => {
    for (const bad of [
      undefined,
      '',
      'abc',
      `entitlement.changed:${ACCOUNT}:`,
      `entitlement.changed:${INTERNAL}:evt_1`,
      `email.requested:trial_reminder:${ACCOUNT}:evt_1`,
    ]) {
      const { d, transport, rows, log } = setup();
      expect(await entitlementNotice(d, change('free', 'pro_trial', { id: bad }))).toBe(
        'event_id_refused',
      );
      expect(rows.size).toBe(0);
      expect(transport.sent).toEqual([]);
      expect(log.mock.calls.map((c) => c[0])).toEqual(['founder.event_id_refused']);
    }
  });

  it('claims nothing for a change the digest alone reports', async () => {
    const { d, rows } = setup();
    expect(await entitlementNotice(d, change('pro', 'agency'))).toBe('digest_only');
    expect(await entitlementNotice(d, change('pro_trial', 'free'))).toBe('digest_only');
    expect(rows.size).toBe(0);
  });

  it('says the amount was not read when Stripe throws or has no invoice, and uses amount_due for a failure', async () => {
    const thrown = setup({
      invoice: async () => {
        throw new Error('stripe down');
      },
    });
    await entitlementNotice(thrown.d, change('pro_trial', 'pro'));
    expect(thrown.transport.sent[0]!.text).toContain('Amount: not read from Stripe');
    const none = setup({ invoice: async () => null });
    await entitlementNotice(none.d, change('pro_trial', 'pro'));
    expect(none.transport.sent[0]!.text).toContain('Amount: not read from Stripe');
    const failed = setup({
      invoice: async () => ({ amountPaid: 0, amountDue: 19000, currency: 'usd' }),
    });
    await entitlementNotice(failed.d, change('pro', 'past_due'));
    expect(failed.transport.sent[0]!.subject).toBe('Payment failed: Pro');
    expect(failed.transport.sent[0]!.text).toContain('Amount: $190.00');
  });

  it('marks an internal account’s notice [TEST]', async () => {
    const { d, transport, rows } = setup();
    await entitlementNotice(
      d,
      change('free', 'agency_trial', { id: id(INTERNAL), accountId: INTERNAL }),
    );
    expect(transport.sent[0]!.subject).toBe('[TEST] Trial started: Agency');
    expect([...rows.values()][0]!.claim.internal).toBe(true);
  });

  it.each([null, '', '  ', 'not-an-address', `${FOUNDER}, other@example.com`])(
    'with FOUNDER_NOTIFY_TO %j: nothing is mailed, the notice is stored skipped, and the run logs once',
    async (to) => {
      const { d, transport, rows, log } = setup({ to });
      expect(await entitlementNotice(d, change('free', 'pro_trial'))).toBe('skipped');
      expect(transport.sent).toEqual([]);
      expect([...rows.values()].map((r) => r.state)).toEqual(['skipped']);
      expect(log.mock.calls.filter((c) => c[0] === 'founder.unconfigured')).toHaveLength(1);
      expect(JSON.stringify(log.mock.calls)).not.toContain('@');
    },
  );

  it(`mails ${FOUNDER_LIMIT} in an hour and holds the rest for the digest tick’s one notice`, async () => {
    const { d, transport } = setup();
    for (let i = 0; i < FOUNDER_LIMIT + 5; i++)
      await entitlementNotice(d, change('free', 'pro_trial', { id: id(ACCOUNT, `evt_${i}`) }));
    expect(transport.sent).toHaveLength(FOUNDER_LIMIT);
    expect((await digest(d)).overflow).toBe('sent');
    const notices = transport.sent.filter((m) => m.idempotencyKey.includes(':overflow:'));
    expect(notices.map((m) => [m.idempotencyKey, m.subject])).toEqual([
      ['founder_event:overflow:2026-11-13T15', '5 more notices in the last hour'],
    ]);
    // A second tick in the same hour sends nothing more.
    expect((await digest(d)).overflow).toBe('done');
    expect(transport.sent.filter((m) => m.subject.includes('more notice'))).toHaveLength(1);
  });

  it('an overflow notice retried after the transport threw is one notice with the same count', async () => {
    const t = throwsOnce();
    const { d, transport } = setup({ transport: t, now: new Date('2026-11-13T11:00:00.000Z') });
    // Fill the hour without the transport: the first notice's throw is the overflow's.
    const filled = setup({ now: new Date('2026-11-13T11:00:00.000Z') });
    for (let i = 0; i < FOUNDER_LIMIT + 3; i++)
      await entitlementNotice(
        filled.d,
        change('free', 'pro_trial', { id: id(ACCOUNT, `evt_${i}`) }),
      );
    const d2: FounderDeps = { ...d, store: filled.store };
    await expect(digest(d2)).rejects.toThrow(MailRetry);
    // A held notice arriving between the attempts goes to the next hour's notice.
    await entitlementNotice(filled.d, change('free', 'pro_trial', { id: id(ACCOUNT, 'evt_late') }));
    expect((await digest(d2)).overflow).toBe('sent');
    expect(transport.sent.map((m) => m.subject)).toEqual(['3 more notices in the last hour']);
  });
});

describe('sweep', () => {
  it('announces confirmed sign-ups, agency accounts and cancellations, each under its own key', async () => {
    const { d, store, transport } = setup();
    const user = 'b0000000-0000-4000-8000-000000000001';
    const waiting = 'b0000000-0000-4000-8000-000000000002';
    const unread = 'b0000000-0000-4000-8000-000000000003';
    vi.mocked(store.unannouncedUsers).mockResolvedValue([
      { userId: user, accountId: ACCOUNT, createdAt: '2026-11-13T10:00:00.000Z' },
      { userId: waiting, accountId: null, createdAt: '2026-11-13T10:01:00.000Z' },
      { userId: unread, accountId: null, createdAt: '2026-11-13T10:02:00.000Z' },
    ]);
    vi.mocked(d.confirmed).mockImplementation(async (u) => {
      if (u === unread) throw new Error('auth down');
      return u === user;
    });
    vi.mocked(store.agencyAccounts).mockResolvedValue([
      { accountId: ACCOUNT, createdAt: '2026-11-13T14:00:00.000Z' },
    ]);
    vi.mocked(store.cancellations).mockResolvedValue([
      {
        subscriptionId: 'sub_9',
        accountId: ACCOUNT,
        plan: 'agency',
        canceledAt: '2026-11-13T14:30:00.000Z',
      },
    ]);
    expect(await sweep(d)).toEqual({
      signups: { sent: 1, unconfirmed: 1, unread: 1 },
      agencies: { sent: 1 },
      cancellations: { sent: 1 },
    });
    expect(transport.sent.map((m) => [m.idempotencyKey, m.subject])).toEqual([
      [`founder_event:signup:${user}`, 'New sign-up'],
      [`founder_event:agency:${ACCOUNT}`, 'Agency account created'],
      ['founder_event:cancel:sub_9:2026-11-13T14:30:00.000Z', 'Cancellation: Agency'],
    ]);
    // Seven days back for sign-ups, at most 200 in the run's turn; two hours back for the rest.
    // The rotation's turn is the run's five-minute tick: 2026-11-13T15:00Z / 5 min.
    expect(store.unannouncedUsers).toHaveBeenCalledWith('2026-11-06T15:00:00.000Z', 200, 5_981_940);
    expect(store.agencyAccounts).toHaveBeenCalledWith('2026-11-13T13:00:00.000Z');
    expect(store.cancellations).toHaveBeenCalledWith('2026-11-13T13:00:00.000Z');
    // A second sweep over the same rows sends nothing more.
    await sweep(d);
    expect(transport.sent).toHaveLength(3);
  });

  it('keeps an internal account’s mark in each loop: [TEST] subjects, and stored internal so no digest counts them', async () => {
    const { d, store, transport, rows } = setup();
    const user = 'b0000000-0000-4000-8000-0000000000ff';
    vi.mocked(store.unannouncedUsers).mockResolvedValue([
      { userId: user, accountId: INTERNAL, createdAt: '2026-11-13T10:00:00.000Z' },
    ]);
    vi.mocked(store.agencyAccounts).mockResolvedValue([
      { accountId: INTERNAL, createdAt: '2026-11-13T14:00:00.000Z' },
    ]);
    vi.mocked(store.cancellations).mockResolvedValue([
      {
        subscriptionId: 'sub_int',
        accountId: INTERNAL,
        plan: 'pro',
        canceledAt: '2026-11-13T14:30:00.000Z',
      },
    ]);
    await sweep(d);
    expect(transport.sent.map((m) => m.subject)).toEqual([
      '[TEST] New sign-up',
      '[TEST] Agency account created',
      '[TEST] Cancellation: Pro',
    ]);
    expect([...rows.values()].map((r) => [r.claim.kind, r.claim.internal])).toEqual([
      ['signup', true],
      ['agency_created', true],
      ['cancellation', true],
    ]);
  });

  it('logs unconfigured once for the whole run', async () => {
    const { d, store, log } = setup({ to: null });
    vi.mocked(store.agencyAccounts).mockResolvedValue([
      { accountId: ACCOUNT, createdAt: '2026-11-13T14:00:00.000Z' },
    ]);
    await sweep(d);
    expect(log.mock.calls.filter((c) => c[0] === 'founder.unconfigured')).toHaveLength(1);
  });
});

describe('digest', () => {
  it('on a Monday from 08:00 New York sends the daily and the weekly, each once', async () => {
    // 2026-11-02 08:07 EST, a Monday.
    const { d, transport, windows } = setup({ now: new Date('2026-11-02T13:07:00.000Z') });
    expect(await digest(d)).toEqual({ daily: 'sent', weekly: 'sent', overflow: 'none' });
    expect(transport.sent.map((m) => [m.idempotencyKey, m.subject, m.to])).toEqual([
      ['founder_digest:daily:2026-11-01', 'Crawlmouse daily: 2026-11-01', FOUNDER],
      ['founder_digest:weekly:2026-10-26', 'Crawlmouse weekly: week of 2026-10-26', FOUNDER],
    ]);
    expect(windows).toEqual([
      ['2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
      ['2026-10-26T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
      ['2026-10-19T04:00:00.000Z', '2026-10-26T04:00:00.000Z'],
    ]);
    // The next hour's tick finds both sent and reads no counts.
    expect(await digest(d)).toEqual({ daily: 'done', weekly: 'done', overflow: 'none' });
    expect(windows).toHaveLength(3);
  });

  it('sends nothing before 08:00 New York, and nothing at all unconfigured', async () => {
    const early = setup({ now: new Date('2026-11-02T12:59:00.000Z') });
    expect(await digest(early.d)).toEqual({
      daily: 'not_due',
      weekly: 'not_due',
      overflow: 'none',
    });
    const off = setup({ to: null, now: new Date('2026-11-02T13:07:00.000Z') });
    expect(await digest(off.d)).toEqual({
      daily: 'unconfigured',
      weekly: 'unconfigured',
      overflow: 'unconfigured',
    });
    expect(off.transport.sent).toEqual([]);
    expect(off.log.mock.calls.filter((c) => c[0] === 'founder.unconfigured')).toHaveLength(1);
  });
});
