import { describe, expect, it } from 'vitest';
import type { Claim, MailLedger } from '../mail/ledger';
import { MailRetry } from '../mail/send';
import type { MailTransport } from '../mail/transport';
import type { OutgoingMail } from '../mail/types';
import type { SummaryChange, SummarySite } from '../mail/templates/weekly-summary';
import { duePage, sendSummary, weekBefore, type SummaryDeps, type SummaryDue } from './summary';

const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const SITE = '50000000-0000-4000-8000-000000000001';
const SEAT_1 = 'e0000000-0000-4000-8000-000000000001';
const SEAT_2 = 'e0000000-0000-4000-8000-000000000002';
const NOW = new Date('2026-11-16T13:30:00.000Z');
const DUE: SummaryDue = {
  accountId: ACCOUNT,
  weekKey: '2026-W47',
  weekStart: '2026-11-16T05:00:00.000Z',
};

const change: SummaryChange = {
  kind: 'opened',
  subject: 'orphans',
  severity: 'warn',
  summary: '4 pages have no link to them',
  where: '/blog/*',
  pages_affected: 4,
  ua: null,
  grade_deltas: [],
  detected_at: '2026-11-13T10:00:00.000Z',
};

function harness(
  o: {
    marked?: boolean;
    sites?: SummarySite[];
    linkSecret?: string | null;
    /** Answers for the transport, by address; an address not named is sent. */
    refuse?: Readonly<Record<string, { code: string; retryable: boolean }>>;
    /** How many of the first counts throw. */
    captureFailures?: number;
  } = {},
) {
  const sent: OutgoingMail[] = [];
  const captures: unknown[] = [];
  const logs: unknown[] = [];
  const asked: [string, string][] = [];
  const rows = new Map<string, string>();
  let captureFailures = o.captureFailures ?? 0;
  const ledger: MailLedger = {
    async claim(c): Promise<Claim> {
      if (rows.get(c.key) === 'sent') return { outcome: 'done' };
      return { outcome: 'go', attempt: 1 };
    },
    async finish(f) {
      rows.set(f.key, f.status);
      return true;
    },
  };
  const deps: SummaryDeps = {
    store: {
      due: async () => [],
      account: async () => ({ marked: o.marked ?? false, zone: 'America/New_York' }),
      sites: async (_a, since, until) => {
        asked.push([since, until]);
        return o.sites ?? [{ siteId: SITE, host: 'shop.example', changes: [change] }];
      },
      recipients: async () => [
        { seatId: SEAT_1, email: 'one@agency.example' },
        { seatId: SEAT_2, email: 'two@agency.example' },
      ],
    },
    mail: {
      ledger,
      transport: {
        async send(m) {
          const refused = o.refuse?.[m.to];
          if (refused) return { ok: false, ...refused };
          sent.push(m);
          return { ok: true, providerId: 'p' };
        },
      } satisfies MailTransport,
      pepper: 'p'.repeat(40),
      now: () => NOW,
      log: (event, fields) => logs.push({ event, fields }),
    },
    linkSecret: o.linkSecret === undefined ? 's'.repeat(40) : o.linkSecret,
    unsubscribeLinks: (_s, seat) => ({
      page: `https://crawlmouse.com/unsubscribe?t=${seat}`,
      oneClick: `https://crawlmouse.com/api/unsubscribe?t=${seat}`,
    }),
    capture: async (accountId, properties) => {
      if (captureFailures > 0) {
        captureFailures--;
        throw new Error('capture failed');
      }
      captures.push({ accountId, properties });
    },
    log: (event, fields) => logs.push({ event, fields }),
    now: () => NOW,
  };
  return { deps, sent, captures, logs, asked, rows };
}

describe('the week a summary covers', () => {
  it('runs Monday to Monday in the account’s zone, across a clock change', () => {
    // New York left daylight time on Sun 1 Nov 2026: Mon 26 Oct 00:00 is 04:00Z, Mon 2 Nov 05:00Z.
    expect(weekBefore('2026-11-02T05:00:00.000Z', 'America/New_York')).toBe(
      '2026-10-26T04:00:00.000Z',
    );
    // and into it, on Sun 8 Mar 2026: Mon 2 Mar 00:00 is 05:00Z, Mon 9 Mar 04:00Z.
    expect(weekBefore('2026-03-09T04:00:00.000Z', 'America/New_York')).toBe(
      '2026-03-02T05:00:00.000Z',
    );
    expect(weekBefore('2026-11-16T00:00:00.000Z', 'UTC')).toBe('2026-11-09T00:00:00.000Z');
  });

  it('asks for the changes of that week', async () => {
    const h = harness();
    await sendSummary(h.deps, DUE);
    expect(h.asked).toEqual([['2026-11-09T05:00:00.000Z', '2026-11-16T05:00:00.000Z']]);
  });
});

describe('sendSummary (D6)', () => {
  it('sends one email per recipient seat, keyed by account, week and seat, with that seat’s unsubscribe', async () => {
    const h = harness();
    expect(await sendSummary(h.deps, DUE)).toEqual({ sent: 2, outcomes: ['sent', 'sent'] });
    expect(h.sent.map((m) => [m.idempotencyKey, m.headers['List-Unsubscribe']])).toEqual([
      [
        `summary:${ACCOUNT}:2026-W47:${SEAT_1}`,
        `<https://crawlmouse.com/api/unsubscribe?t=${SEAT_1}>`,
      ],
      [
        `summary:${ACCOUNT}:2026-W47:${SEAT_2}`,
        `<https://crawlmouse.com/api/unsubscribe?t=${SEAT_2}>`,
      ],
    ]);
    expect(h.sent[0]!.subject).toBe('Your week on Crawlmouse: 1 change on 1 site, 1 problem');
    // The footer links the page that asks; the header names the one-click route (RFC 8058).
    expect(h.sent[0]!.html).toContain(`https://crawlmouse.com/unsubscribe?t=${SEAT_1}`);
    expect(h.sent[0]!.html).not.toContain('/api/unsubscribe');
    expect(h.captures).toEqual([{ accountId: ACCOUNT, properties: { sites: 1, changes: 1 } }]);
    expect(JSON.stringify([h.captures, h.logs])).not.toContain('@agency.example');
  });

  it('a step run again after it completed (a replayed event) sends nobody twice', async () => {
    const h = harness();
    await sendSummary(h.deps, DUE);
    expect(await sendSummary(h.deps, DUE)).toEqual({ sent: 0, outcomes: ['done', 'done'] });
    expect(h.sent).toHaveLength(2);
    // Counted on each run that completes with the mail delivered (spec 28, known gaps).
    expect(h.captures).toHaveLength(2);
  });

  it('sends to the next seat when one seat’s send is retried, then retries, and counts once (review r1 B2, N4)', async () => {
    const refuse = { 'one@agency.example': { code: 'provider_503', retryable: true } };
    const h = harness({ refuse });
    await expect(sendSummary(h.deps, DUE)).rejects.toBeInstanceOf(MailRetry);
    expect(h.sent.map((m) => m.to)).toEqual(['two@agency.example']);
    expect(h.captures).toEqual([]);
    delete (refuse as Record<string, unknown>)['one@agency.example'];
    expect(await sendSummary(h.deps, DUE)).toEqual({ sent: 1, outcomes: ['sent', 'done'] });
    expect(h.sent.map((m) => m.to)).toEqual(['two@agency.example', 'one@agency.example']);
    expect(h.captures).toEqual([{ accountId: ACCOUNT, properties: { sites: 1, changes: 1 } }]);
  });

  it('a summary sent by a run that then failed counts on the retry that finds it done (review r1 N4)', async () => {
    const h = harness({ captureFailures: 1 });
    await expect(sendSummary(h.deps, DUE)).rejects.toThrow(/capture failed/);
    expect(await sendSummary(h.deps, DUE)).toEqual({ sent: 0, outcomes: ['done', 'done'] });
    expect(h.sent).toHaveLength(2);
    expect(h.captures).toEqual([{ accountId: ACCOUNT, properties: { sites: 1, changes: 1 } }]);
  });

  it('is never sent empty', async () => {
    for (const sites of [[], [{ siteId: SITE, host: 'shop.example', changes: [] }]]) {
      const h = harness({ sites });
      expect(await sendSummary(h.deps, DUE)).toEqual({ skip: 'empty' });
      expect(h.sent).toEqual([]);
    }
  });

  it('is never sent to an account marked for deletion', async () => {
    const h = harness({ marked: true });
    expect(await sendSummary(h.deps, DUE)).toEqual({ skip: 'marked' });
    expect(h.sent).toEqual([]);
  });

  it('sends nothing without EMAIL_LINK_SECRET, and logs the miss (Q6)', async () => {
    const h = harness({ linkSecret: null });
    expect(await sendSummary(h.deps, DUE)).toEqual({ skip: 'no_link_secret' });
    expect(h.logs).toEqual([{ event: 'summary.no_link_secret', fields: { account: ACCOUNT } }]);
  });
});

describe('duePage', () => {
  it('pages the due accounts in account order, the same page on every call', async () => {
    const ids = ['c', 'a', 'b', 'd', 'e'].map((x) => ({
      accountId: x,
      weekKey: 'w',
      weekStart: 's',
    }));
    const store = { due: async () => ids } as never;
    expect((await duePage(store, NOW, 0, 2)).map((d) => d.accountId)).toEqual(['a', 'b']);
    expect((await duePage(store, NOW, 2, 2)).map((d) => d.accountId)).toEqual(['c', 'd']);
    expect((await duePage(store, NOW, 4, 2)).map((d) => d.accountId)).toEqual(['e']);
  });
});
