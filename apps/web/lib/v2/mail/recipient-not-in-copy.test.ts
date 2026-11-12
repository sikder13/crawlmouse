/**
 * Tier B review S3: no message names its recipient. Every send path runs once here (each mail handler,
 * the two report-schedule handlers, `deliverAlert`, `sendSummary`) over the in-memory ledger and
 * transport, and each message's subject,
 * text and HTML are read for its `to` address and for that address's local part. The sweep asserts
 * that the ledger was claimed for every kind in `MAIL_KINDS`, so a kind added without a path here
 * fails it rather than passing unswept.
 *
 * Nothing here reaches a database, a mail provider, PostHog or Slack: the stores are stubs, the
 * transport is `memoryTransport`, and `capture` and `postSlack` are no-ops.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Fix } from '@crawlmouse/types/v2';
import { fixture } from '../fixtures';
import { deliverAlert, type AlertDeps, type StoredChange } from '../monitor/alerts';
import { sendSummary, type SummaryDeps } from '../monitor/summary';
import { mailHandlers, reportMailHandlers } from './handlers';
import { unsubscribeLinks } from './links';
import { memoryLedger, memoryTransport } from './memory';
import type { MailDeps } from './send';
import type { MailStore, ReportMailStore } from './store';
import { MAIL_KINDS, type OutgoingMail } from './types';

vi.mock('server-only', () => ({}));

const NOW = new Date('2026-11-13T10:00:00.000Z');
const ACCOUNT = 'a0000000-0000-4000-8000-000000000001';
const CHECK = 'c0000000-0000-4000-8000-0000000000aa';
const SITE = '50000000-0000-4000-8000-0000000000a1';
const SEAT = 'e0000000-0000-4000-8000-0000000000a1';
const SECRET = 'u'.repeat(40);
const FIX: Fix = fixture('bad-site').fixes.find((f) => f.packet !== null)!;

/** One address per path; each local part is a string no template or fixture holds. */
const TO = {
  emailChange: 'qzx-change@inbox.example',
  emailUndo: 'qzx-undo@inbox.example',
  deletion: 'qzx-delete@inbox.example',
  trialOwner: 'qzx-trial@inbox.example',
  visitor: 'qzx-visitor@inbox.example',
  developer: 'qzx-developer@inbox.example',
  alert: 'qzx-alert@inbox.example',
  summary: 'qzx-summary@inbox.example',
  invitee: 'qzx-invitee@inbox.example',
  confirming: 'qzx-confirming@inbox.example',
  reportReader: 'qzx-report@inbox.example',
};

const LINK_ROWS: Record<string, { kind: string; recipient: string; tokens: string[] }> = {
  't-confirm': { kind: 'email_change', recipient: TO.emailChange, tokens: ['email_change'] },
  't-notice': { kind: 'email_change_undo', recipient: TO.emailUndo, tokens: ['email_change_undo'] },
  't-delete': {
    kind: 'delete_confirm',
    recipient: TO.deletion,
    tokens: ['delete_confirm', 'delete_restore'],
  },
};

const store: MailStore = {
  accountLinkRecipient: async (tokenId: string) => {
    const r = LINK_ROWS[tokenId];
    return r ? { kind: r.kind, recipient: r.recipient } : null;
  },
  issueAccountLink: async (tokenId: string) =>
    LINK_ROWS[tokenId]!.tokens.map((kind) => ({ kind, token: 'R'.repeat(43) })),
  trialAccount: async () => ({
    state: 'pro_trial',
    trialVariant: 'card_required',
    trialEndsAt: '2026-11-16T10:00:00.000Z',
    timezone: 'UTC',
    remind: true,
    marked: false,
    ownerEmail: TO.trialOwner,
  }),
  notifyCheck: async () => ({
    status: 'finished',
    notifyEmail: TO.visitor,
    host: 'example.com',
    accountId: null,
  }),
  fixEmailRequest: async () => ({
    toEmail: TO.developer,
    sentAt: null,
    accountId: ACCOUNT,
    host: 'example.com',
    fix: FIX,
  }),
  markFixEmailSent: async () => undefined,
  finishedCheck: async () => null,
  seatInvitation: async () => ({ recipient: TO.invitee, accountId: ACCOUNT, marked: false }),
  issueSeatInvite: async () => ({
    token: 'R'.repeat(43),
    recipient: TO.invitee,
    accountName: 'Summit Digital',
    role: 'account_manager',
  }),
} as unknown as MailStore;

const reportStore: ReportMailStore = {
  confirmationRecipient: async () => ({ recipient: TO.confirming, accountId: ACCOUNT }),
  issueConfirmation: async () => ({
    token: 'R'.repeat(43),
    recipient: TO.confirming,
    agencyName: 'Summit Digital',
    host: 'shop.example',
  }),
  clientReportRecipient: async () => ({ recipient: TO.reportReader, accountId: ACCOUNT }),
  issueClientReport: async () => ({
    recipient: TO.reportReader,
    agencyName: 'Summit Digital',
    host: 'shop.example',
    headline: 'Report for shop.example',
    lines: ['shop.example', 'Checked Fri 13 Nov'],
    footer: 'Checked with Crawlmouse · Fri 13 Nov',
    shareToken: 'S'.repeat(22),
    pauseToken: 'P'.repeat(43),
  }),
};

const change: StoredChange = {
  id: '90000000-0000-4000-8000-0000000000a1',
  site_id: SITE,
  check_id: CHECK,
  kind: 'opened',
  subject: 'crawler_access',
  severity: 'bad',
  summary: 'GPTBot: allowed → disallowed by robots.txt',
  where: 'robots.txt',
  pages_affected: 4,
  ua: 'GPTBot',
  fix_id: null,
  grade_deltas: [],
};

async function sweep() {
  const ledger = memoryLedger();
  const transport = memoryTransport();
  const mail: MailDeps = {
    ledger,
    transport,
    pepper: 'p'.repeat(40),
    now: () => NOW,
    log: () => {},
  };
  const h = mailHandlers({ mail, store, capture: async () => undefined });
  const reports = reportMailHandlers({ mail, store: reportStore });

  const answers = [
    await h.accountEmail({
      accountId: ACCOUNT,
      template: 'email_change_confirm',
      tokenId: 't-confirm',
    }),
    await h.accountEmail({
      accountId: ACCOUNT,
      template: 'email_change_notice',
      tokenId: 't-notice',
    }),
    await h.accountEmail({ accountId: ACCOUNT, template: 'account_delete', tokenId: 't-delete' }),
    await h.accountEmail({ accountId: ACCOUNT, template: 'trial_reminder' }),
    await h.checkNotify(CHECK),
    await h.fixToDeveloper('r0000000-0000-4000-8000-000000000001'),
    await h.seatInvite(SEAT, 1),
    await reports.reportConfirm(SITE, 'request-1'),
    await reports.clientReport('d0000000-0000-4000-8000-0000000000a1'),
  ];

  const alert: AlertDeps = {
    mail,
    linkSecret: SECRET,
    unsubscribeLinks: (secret, seat, now) => unsubscribeLinks(secret, seat, 'alerts', now),
    postSlack: async () => ({ ok: true }),
    capture: async () => {},
    log: () => {},
    now: () => NOW,
    store: {
      context: async () => ({
        checkId: CHECK,
        siteId: SITE,
        accountId: ACCOUNT,
        siteRemoved: false,
        accountMarked: false,
        previousCheckId: 'c0000000-0000-4000-8000-0000000000a1',
        firstCheck: false,
        finished: true,
        host: 'shop.example',
        slackChannel: null,
        finishedAt: NOW.toISOString(),
        zone: 'UTC',
      }),
      seedDefaultRules: async () => {},
      data: async () => ({
        changes: [change],
        rules: [
          {
            id: '70000000-0000-4000-8000-0000000000a1',
            site_id: null,
            kind: 'any_change',
            enabled: true,
            threshold_points: null,
            channels: ['email'],
          },
        ],
        verdicts: { now: {}, before: null },
        textShare: { before: null, now: null },
        fixEvents: [],
      }),
      emailRecipients: async () => [{ seatId: SEAT, email: TO.alert }],
      slackUrl: async () => null,
      claimSlack: async () => ({ outcome: 'done' }),
      finishSlack: async () => {},
      record: async () => {},
    },
  };
  answers.push((await deliverAlert(alert, CHECK, 'email')).status);

  const summary: SummaryDeps = {
    mail,
    linkSecret: SECRET,
    unsubscribeLinks: (secret, seat, now) => unsubscribeLinks(secret, seat, 'summary', now),
    capture: async () => {},
    log: () => {},
    now: () => NOW,
    store: {
      due: async () => [],
      account: async () => ({ marked: false, zone: 'UTC' }),
      sites: async (_a, since) => [
        { siteId: SITE, host: 'shop.example', changes: [{ ...change, detected_at: since }] },
      ],
      recipients: async () => [{ seatId: SEAT, email: TO.summary, sites: null }],
    },
  };
  const weekStart = new Date(Date.UTC(2026, 10, 16)).toISOString();
  answers.push(
    JSON.stringify(
      await sendSummary(summary, { accountId: ACCOUNT, weekKey: '2026-W47', weekStart }),
    ),
  );
  return { answers, sent: transport.sent, kinds: new Set(ledger.claims.map((c) => c.kind)) };
}

describe('no message names its recipient (S3)', () => {
  it('runs every send path, one message each, covering every mail kind', async () => {
    const { answers, sent, kinds } = await sweep();
    expect(answers).toEqual([
      'sent',
      'sent',
      'sent',
      'sent',
      'sent',
      'sent',
      'sent',
      'sent',
      'sent',
      'sent',
      JSON.stringify({ sent: 1, outcomes: ['sent'] }),
    ]);
    expect(MAIL_KINDS.filter((k) => !kinds.has(k))).toEqual([]);
    expect(sent.map((m) => m.to).sort()).toEqual(Object.values(TO).sort());
  });

  it('leaves the address, and its local part, out of every subject, text and HTML', async () => {
    const { sent } = await sweep();
    const named = (m: OutgoingMail) =>
      [m.to, m.to.split('@')[0]!].flatMap((needle) =>
        (['subject', 'text', 'html'] as const)
          .filter((part) => m[part].includes(needle))
          .map((part) => `${m.to} in ${part}`),
      );
    expect(sent.flatMap(named)).toEqual([]);
  });
});
