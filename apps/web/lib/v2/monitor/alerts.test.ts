/**
 * alertFn's work (D5) over in-memory ports: what is skipped, one email per recipient seat with its
 * List-Unsubscribe, one Slack message per check, the record per channel, and the rule that neither an
 * address nor the webhook URL leaves in a record, a log line, an event or an error.
 */
import { describe, expect, it } from 'vitest';
import type { Claim, MailLedger } from '../mail/ledger';
import { MailRetry } from '../mail/send';
import type { MailTransport } from '../mail/transport';
import type { OutgoingMail } from '../mail/types';
import {
  deliverAlert,
  emailDestinationHash,
  NO_DESTINATION,
  planAlert,
  slackDestinationHash,
  SlackRetry,
  type AlertContext,
  type AlertData,
  type AlertDeps,
  type Delivery,
  type StoredChange,
} from './alerts';
import type { SlackResult } from './slack';
import { ALERT_RETRIES } from '../../../../../inngest/alerts';

const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const SITE = '50000000-0000-4000-8000-000000000001';
const CHECK = 'c0000000-0000-4000-8000-000000000002';
const SEAT_1 = 'e0000000-0000-4000-8000-000000000001';
const SEAT_2 = 'e0000000-0000-4000-8000-000000000002';
const RULE_BLOCK = '70000000-0000-4000-8000-000000000001';
const RULE_ANY = '70000000-0000-4000-8000-000000000006';
const PEPPER = 'p'.repeat(40);
const SECRET = 's'.repeat(40);
const HOOK = 'https://hooks.slack.com/services/T0000/B0000/topSecretTokenXYZ';
const ADDRESSES = ['owner@agency.example', 'second@agency.example'];
const NOW = new Date('2026-11-13T11:00:00.000Z');

const block: StoredChange = {
  id: '90000000-0000-4000-8000-000000000001',
  site_id: SITE,
  check_id: CHECK,
  kind: 'opened',
  subject: 'crawler_access',
  severity: 'bad',
  summary: 'GPTBot: allowed → disallowed by robots.txt',
  where: 'robots.txt',
  pages_affected: 40,
  ua: 'GPTBot',
  fix_id: null,
  grade_deltas: [],
};
const content: StoredChange = {
  ...block,
  id: '90000000-0000-4000-8000-000000000002',
  kind: 'changed',
  subject: 'content',
  severity: null,
  summary: '3 pages changed content',
  where: '/blog/*',
  ua: null,
};

function context(o: Partial<AlertContext> = {}): AlertContext {
  return {
    checkId: CHECK,
    siteId: SITE,
    accountId: ACCOUNT,
    siteRemoved: false,
    accountMarked: false,
    previousCheckId: 'c0000000-0000-4000-8000-000000000001',
    firstCheck: false,
    finished: true,
    host: 'shop.example',
    slackChannel: '#seo',
    finishedAt: '2026-11-13T10:58:00.000Z',
    zone: 'UTC',
    ...o,
  };
}

const data = (o: Partial<AlertData> = {}): AlertData => ({
  changes: [block, content],
  rules: [
    {
      id: RULE_BLOCK,
      site_id: null,
      kind: 'crawler_blocked',
      enabled: true,
      threshold_points: null,
      channels: ['email', 'slack'],
    },
    {
      id: RULE_ANY,
      site_id: null,
      kind: 'any_change',
      enabled: true,
      threshold_points: null,
      channels: ['email'],
    },
  ],
  verdicts: { now: { GPTBot: 'disallowed_by_robots' }, before: { GPTBot: 'allowed' } },
  textShare: { before: null, now: null },
  fixEvents: [],
  ...o,
});

/**
 * The ledger's rule from claim_email_send (migration 028, section A), without its two-minute lease:
 * a sent key is done, a key that failed three times is exhausted, otherwise the next attempt goes.
 */
function memoryLedger(): MailLedger & { rows: Map<string, string>; attempts: Map<string, number> } {
  const rows = new Map<string, string>();
  const attempts = new Map<string, number>();
  return {
    rows,
    attempts,
    async claim(c): Promise<Claim> {
      const s = rows.get(c.key);
      if (s === 'sent') return { outcome: 'done' };
      const n = attempts.get(c.key) ?? 0;
      if (n >= 3) return { outcome: 'exhausted' };
      rows.set(c.key, 'sending');
      attempts.set(c.key, n + 1);
      return { outcome: 'go', attempt: n + 1 };
    },
    async finish(f) {
      rows.set(f.key, f.status);
      return true;
    },
  };
}

function harness(
  o: {
    ctx?: AlertContext | null;
    data?: AlertData;
    slackUrl?: string | null;
    slack?: SlackResult;
    linkSecret?: string | null;
    recipients?: { seatId: string; email: string }[];
    transport?: MailTransport;
    /** How many of the first `record` calls throw, as a database that is down for a moment. */
    recordFailures?: number;
  } = {},
) {
  const sent: OutgoingMail[] = [];
  const records: Delivery[] = [];
  const logs: unknown[] = [];
  const captures: unknown[] = [];
  const posts: { url: string; text: string }[] = [];
  const slackRows = new Map<string, string>();
  const reads: string[] = [];
  const ledger = memoryLedger();
  let recordFailures = o.recordFailures ?? 0;
  const transport: MailTransport = o.transport ?? {
    async send(m) {
      sent.push(m);
      return { ok: true, providerId: `p${sent.length}` };
    },
  };
  const deps: AlertDeps = {
    store: {
      context: async () => (o.ctx === undefined ? context() : o.ctx),
      seedDefaultRules: async (accountId) => {
        reads.push(`seed:${accountId}`);
      },
      data: async () => {
        reads.push('data');
        return o.data ?? data();
      },
      emailRecipients: async () =>
        o.recipients ?? [
          { seatId: SEAT_1, email: ADDRESSES[0]! },
          { seatId: SEAT_2, email: ADDRESSES[1]! },
        ],
      slackUrl: async () => (o.slackUrl === undefined ? HOOK : o.slackUrl),
      claimSlack: async (key) => {
        if (slackRows.get(key) === 'sent') return { outcome: 'done' };
        slackRows.set(key, 'sending');
        return { outcome: 'go', attempt: 1 };
      },
      finishSlack: async (key, status) => {
        slackRows.set(key, status);
      },
      record: async (d) => {
        if (recordFailures > 0) {
          recordFailures--;
          throw new Error('record_alert_delivery: 57P01');
        }
        records.push(d);
      },
    },
    mail: {
      ledger,
      transport,
      pepper: PEPPER,
      now: () => NOW,
      log: (event, fields) => logs.push({ event, fields }),
    },
    linkSecret: o.linkSecret === undefined ? SECRET : o.linkSecret,
    unsubscribeLinks: (_s, seat) => ({
      page: `https://crawlmouse.com/unsubscribe?t=${seat}`,
      oneClick: `https://crawlmouse.com/api/unsubscribe?t=${seat}`,
    }),
    postSlack: async (url, text) => {
      posts.push({ url, text });
      return o.slack ?? { ok: true };
    },
    capture: async (accountId, properties) => {
      captures.push({ accountId, properties });
    },
    log: (event, fields) => logs.push({ event, fields }),
    now: () => NOW,
  };
  return { deps, sent, records, logs, captures, posts, slackRows, ledger, reads };
}

/** Everything the work let out, but the transport's own message and the Slack POST. */
const leaked = (h: ReturnType<typeof harness>, extra: unknown[] = []) =>
  JSON.stringify([h.records, h.logs, h.captures, ...extra]);

describe('what alerts nothing', () => {
  it.each<[string, AlertContext | null, string]>([
    ['no such check', null, 'no_check'],
    ['a check still running', context({ finished: false }), 'not_finished'],
    ['an audit nobody kept', context({ accountId: null }), 'unkept'],
    ['a removed site', context({ siteRemoved: true }), 'unkept'],
    ['an account marked for deletion', context({ accountMarked: true }), 'marked'],
    ['a site’s first check', context({ firstCheck: true }), 'first_check'],
  ])('%s', async (_, ctx, skip) => {
    const h = harness({ ctx });
    expect(await planAlert(h.deps, CHECK)).toEqual({ skip });
    expect(await deliverAlert(h.deps, CHECK, 'email')).toEqual({ status: 'none' });
    expect(await deliverAlert(h.deps, CHECK, 'slack')).toEqual({ status: 'none' });
    expect([h.sent, h.posts, h.records]).toEqual([[], [], []]);
  });

  it('a check whose changes fire no rule', async () => {
    const h = harness({ data: data({ changes: [] }) });
    expect(await planAlert(h.deps, CHECK)).toEqual({ skip: 'nothing_fired' });
  });

  it('seeds the account’s default rules before it reads them (Q13)', async () => {
    const h = harness();
    await planAlert(h.deps, CHECK);
    expect(h.reads.slice(0, 2)).toEqual([`seed:${ACCOUNT}`, 'data']);
  });

  it('plans the channels the firing rules name', async () => {
    expect(await planAlert(harness().deps, CHECK)).toEqual({
      fired: 2,
      channels: ['email', 'slack'],
    });
  });
});

describe('email (D5, D7)', () => {
  it('sends one message per recipient seat, keyed by check and seat, with that seat’s unsubscribe', async () => {
    const h = harness();
    expect(await deliverAlert(h.deps, CHECK, 'email')).toEqual({ status: 'sent', reason: null });
    expect(h.sent.map((m) => [m.to, m.idempotencyKey, m.headers['List-Unsubscribe']])).toEqual([
      [
        ADDRESSES[0],
        `alert:${CHECK}:email:${SEAT_1}`,
        `<https://crawlmouse.com/api/unsubscribe?t=${SEAT_1}>`,
      ],
      [
        ADDRESSES[1],
        `alert:${CHECK}:email:${SEAT_2}`,
        `<https://crawlmouse.com/api/unsubscribe?t=${SEAT_2}>`,
      ],
    ]);
    expect(h.sent[0]!.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(h.sent[0]!.subject).toBe('shop.example: 2 changes, 1 problem');
  });

  it('records the email channel once, with each email rule and its changes', async () => {
    const h = harness();
    await deliverAlert(h.deps, CHECK, 'email');
    expect(h.records).toEqual([
      {
        check_id: CHECK,
        site_id: SITE,
        channel: 'email',
        status: 'sent',
        reason: null,
        destination_hash: emailDestinationHash(PEPPER, [...ADDRESSES].reverse()),
        provider_message_id: null,
        slack_channel: null,
        sent_at: NOW.toISOString(),
        rules: [
          { rule_id: RULE_BLOCK, change_ids: [block.id] },
          { rule_id: RULE_ANY, change_ids: [block.id, content.id] },
        ],
      },
    ]);
    expect(h.captures).toEqual([
      { accountId: ACCOUNT, properties: { channel: 'email', changes: 2 } },
    ]);
  });

  it('a step run again after it completed (a replayed event) sends nobody twice', async () => {
    const h = harness();
    await deliverAlert(h.deps, CHECK, 'email');
    await deliverAlert(h.deps, CHECK, 'email');
    expect(h.sent).toHaveLength(2);
    expect(h.records.map((r) => r.status)).toEqual(['sent', 'sent']);
    // Counted on each run that completes with the mail delivered (spec 28, known gaps).
    expect(h.captures).toHaveLength(2);
  });

  it('lets a retryable failure retry the step', async () => {
    const h = harness({
      transport: { send: async () => ({ ok: false, code: 'provider_503', retryable: true }) },
    });
    await expect(deliverAlert(h.deps, CHECK, 'email')).rejects.toBeInstanceOf(MailRetry);
  });

  it('records a failure that is not retried, with its reason', async () => {
    const h = harness({
      transport: { send: async () => ({ ok: false, code: 'provider_422', retryable: false }) },
    });
    expect(await deliverAlert(h.deps, CHECK, 'email')).toEqual({
      status: 'failed',
      reason: 'send_failed',
    });
    expect(h.captures).toEqual([]);
  });

  it('sends nothing without EMAIL_LINK_SECRET, logs the miss and records it (Q6)', async () => {
    const h = harness({ linkSecret: null });
    expect(await deliverAlert(h.deps, CHECK, 'email')).toEqual({
      status: 'suppressed',
      reason: 'no_link_secret',
    });
    expect(h.sent).toEqual([]);
    expect(h.logs).toEqual([{ event: 'alert.no_link_secret', fields: { check: CHECK } }]);
    expect(h.records[0]!.destination_hash).toBe(NO_DESTINATION);
  });

  it('records no recipients as suppressed', async () => {
    const h = harness({ recipients: [] });
    expect(await deliverAlert(h.deps, CHECK, 'email')).toEqual({
      status: 'suppressed',
      reason: 'no_recipients',
    });
  });

  it('puts no address in a record, a log line or an event', async () => {
    const h = harness({
      transport: { send: async () => ({ ok: false, code: 'provider_422', retryable: false }) },
    });
    await deliverAlert(h.deps, CHECK, 'email');
    for (const a of ADDRESSES) expect(leaked(h)).not.toContain(a);
  });
});

describe('Slack (D5)', () => {
  it('posts one plain-text message per check and records it with the site’s channel', async () => {
    const h = harness();
    expect(await deliverAlert(h.deps, CHECK, 'slack')).toEqual({ status: 'sent', reason: null });
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0]!.text).toContain('Crawlmouse: 1 change on shop.example');
    expect(h.records).toEqual([
      expect.objectContaining({
        channel: 'slack',
        status: 'sent',
        slack_channel: '#seo',
        destination_hash: slackDestinationHash(PEPPER, HOOK),
        rules: [{ rule_id: RULE_BLOCK, change_ids: [block.id] }],
      }),
    ]);
    expect(h.captures).toEqual([
      { accountId: ACCOUNT, properties: { channel: 'slack', changes: 1 } },
    ]);
    await deliverAlert(h.deps, CHECK, 'slack');
    expect(h.posts).toHaveLength(1);
  });

  it('sends nothing when the account’s tier has no Slack now, and records why', async () => {
    const h = harness({ slackUrl: null });
    expect(await deliverAlert(h.deps, CHECK, 'slack')).toEqual({
      status: 'suppressed',
      reason: 'slack_unavailable',
    });
    expect(h.posts).toEqual([]);
  });

  it('retries a retryable failure with an error that does not carry the URL', async () => {
    const h = harness({ slack: { ok: false, code: 'slack_503', retryable: true } });
    const err = await deliverAlert(h.deps, CHECK, 'slack').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SlackRetry);
    expect(String((err as Error).message) + String((err as Error).stack)).not.toContain(
      'hooks.slack.com',
    );
    expect(h.slackRows.get(`alert:${CHECK}:slack`)).toBe('failed');
  });

  it('records a refused URL or a 404 as failed, and logs only the code', async () => {
    const h = harness({ slack: { ok: false, code: 'slack_404', retryable: false } });
    expect(await deliverAlert(h.deps, CHECK, 'slack')).toEqual({
      status: 'failed',
      reason: 'slack_404',
    });
    expect(h.logs).toEqual([
      { event: 'alert.slack_failed', fields: { check: CHECK, code: 'slack_404' } },
    ]);
  });

  it('never puts the webhook URL in a record, a log line, an event or an answer', async () => {
    for (const slack of [
      { ok: true } as const,
      { ok: false, code: 'slack_404', retryable: false } as const,
    ]) {
      const h = harness({ slack });
      const answer = await deliverAlert(h.deps, CHECK, 'slack');
      const plan = await planAlert(h.deps, CHECK);
      const out = leaked(h, [answer, plan]);
      expect(out).not.toContain('hooks.slack.com');
      expect(out).not.toContain('topSecretTokenXYZ');
    }
  });
});

describe('a failure stops neither the other seats nor the record (review r1 B2, N4)', () => {
  /** A transport that refuses one address retryably and sends the rest. */
  const failing = (address: string, sent: OutgoingMail[]): MailTransport => ({
    async send(m) {
      if (m.to === address) return { ok: false, code: 'provider_503', retryable: true };
      sent.push(m);
      return { ok: true, providerId: `p${sent.length}` };
    },
  });

  it('sends to the next seat when one seat’s send is retried, records the channel, then retries', async () => {
    const out: OutgoingMail[] = [];
    const h = harness({ transport: failing(ADDRESSES[0]!, out) });
    await expect(deliverAlert(h.deps, CHECK, 'email')).rejects.toBeInstanceOf(MailRetry);
    expect(out.map((m) => m.to)).toEqual([ADDRESSES[1]]);
    expect(h.records.map((r) => [r.status, r.reason])).toEqual([['sent', null]]);
    expect(h.captures).toEqual([]);
  });

  it('records a channel whose every seat is still being retried as failed, retrying', async () => {
    const h = harness({
      transport: { send: async () => ({ ok: false, code: 'provider_503', retryable: true }) },
    });
    await expect(deliverAlert(h.deps, CHECK, 'email')).rejects.toBeInstanceOf(MailRetry);
    expect(h.records.map((r) => [r.status, r.reason])).toEqual([['failed', 'send_retrying']]);
  });

  it('gives every seat its three attempts within the step’s runs, whatever the number of seats', async () => {
    const seats = Array.from({ length: 4 }, (_, k) => ({
      seatId: `e0000000-0000-4000-8000-00000000001${k}`,
      email: `seat${k}@agency.example`,
    }));
    let calls = 0;
    const h = harness({
      recipients: seats,
      transport: {
        send: async () => {
          calls++;
          return { ok: false, code: 'provider_503', retryable: true };
        },
      },
    });
    let answer: unknown = null;
    for (let run = 0; run <= ALERT_RETRIES && answer === null; run++) {
      answer = await deliverAlert(h.deps, CHECK, 'email').catch(() => null);
    }
    expect(answer).toEqual({ status: 'failed', reason: 'send_exhausted' });
    expect(calls).toBe(seats.length * 3);
    for (const s of seats)
      expect(h.ledger.attempts.get(`alert:${CHECK}:email:${s.seatId}`)).toBe(3);
    expect(h.records.at(-1)).toMatchObject({ status: 'failed', reason: 'send_exhausted' });
  });

  it('a send whose record failed counts on the retry that finds it done', async () => {
    const h = harness({ recordFailures: 1 });
    await expect(deliverAlert(h.deps, CHECK, 'email')).rejects.toThrow(/record_alert_delivery/);
    expect(await deliverAlert(h.deps, CHECK, 'email')).toEqual({ status: 'sent', reason: null });
    expect(h.sent).toHaveLength(2);
    expect(h.captures).toEqual([
      { accountId: ACCOUNT, properties: { channel: 'email', changes: 2 } },
    ]);
  });

  it('a Slack post whose record failed counts on the retry that finds it done, and posts once', async () => {
    const h = harness({ recordFailures: 1 });
    await expect(deliverAlert(h.deps, CHECK, 'slack')).rejects.toThrow(/record_alert_delivery/);
    expect(await deliverAlert(h.deps, CHECK, 'slack')).toEqual({ status: 'sent', reason: null });
    expect(h.posts).toHaveLength(1);
    expect(h.captures).toEqual([
      { accountId: ACCOUNT, properties: { channel: 'slack', changes: 1 } },
    ]);
  });
});
