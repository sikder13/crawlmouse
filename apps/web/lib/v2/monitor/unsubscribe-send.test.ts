/**
 * Rulings-3 item 5: an alert's and a summary's `List-Unsubscribe` (the RFC 8058 one-click target,
 * `/api/unsubscribe`) and its footer link (the page, `/unsubscribe`) carry the same real signed token
 * in a non-preview send, and both routes accept that token.
 *
 * The deps are production's (`alertDeps`, `summaryDeps` in functions.ts, so their `unsubscribeLinks`
 * wiring is the one under test) with the store, the mail ledger and transport, and the event capture
 * replaced by in-memory ones: nothing here reaches a database, a mail provider or Slack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { memoryLedger, memoryTransport } from '../mail/memory';
import type { MailDeps } from '../mail/send';
import { htmlTargets } from '../mail/templates/inspect';
import type { OutgoingMail, UnsubscribeKind } from '../mail/types';
import { UNSUBSCRIBE_COPY } from '../mail/unsubscribe';
import { verifyUnsubscribe } from '../mail/unsubscribe-token';
import { deliverAlert, type AlertDeps, type StoredChange } from './alerts';
import { alertDeps, summaryDeps } from './functions';
import { sendSummary, type SummaryDeps } from './summary';

vi.mock('server-only', () => ({}));
const rpc = vi.fn(async () => ({ data: true, error: null }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc, from: rpc }) }));
vi.mock('@/lib/analytics-server', () => ({ captureServerEvent: vi.fn(async () => undefined) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

const SECRET = 'u'.repeat(40);
const ENV = {
  EMAIL_LINK_SECRET: SECRET,
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
  SUPABASE_SERVICE_ROLE_KEY: 'not-a-key',
};
const ACCOUNT = 'a0000000-0000-4000-8000-0000000000a1';
const SITE = '50000000-0000-4000-8000-0000000000a1';
const CHECK = 'c0000000-0000-4000-8000-0000000000a2';
const SEAT = 'e0000000-0000-4000-8000-0000000000a1';
// Signed now: the routes verify against the real clock, and a token lasts 90 days.
const NOW = new Date();

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

function mail(): { deps: MailDeps; sent: OutgoingMail[] } {
  const transport = memoryTransport();
  return {
    sent: transport.sent,
    deps: {
      ledger: memoryLedger(),
      transport,
      pepper: 'p'.repeat(40),
      now: () => NOW,
      log: () => {},
    },
  };
}

async function alertSent(): Promise<OutgoingMail> {
  const m = mail();
  const deps: AlertDeps = {
    ...alertDeps(ENV),
    mail: m.deps,
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
      emailRecipients: async () => [{ seatId: SEAT, email: 'owner@agency.example' }],
      slackUrl: async () => null,
      claimSlack: async () => ({ outcome: 'done' }),
      finishSlack: async () => {},
      record: async () => {},
    },
    capture: async () => {},
    now: () => NOW,
  };
  expect(await deliverAlert(deps, CHECK, 'email')).toEqual({ status: 'sent', reason: null });
  expect(m.sent).toHaveLength(1);
  return m.sent[0]!;
}

async function summarySent(): Promise<OutgoingMail> {
  const m = mail();
  const deps: SummaryDeps = {
    ...summaryDeps(ENV),
    mail: m.deps,
    store: {
      due: async () => [],
      account: async () => ({ marked: false, zone: 'UTC' }),
      sites: async (_a, since) => [
        { siteId: SITE, host: 'shop.example', changes: [{ ...change, detected_at: since }] },
      ],
      recipients: async () => [{ seatId: SEAT, email: 'owner@agency.example', sites: null }],
    },
    capture: async () => {},
    now: () => NOW,
  };
  const weekStart = new Date(Date.UTC(2026, 10, 16)).toISOString();
  const answer = await sendSummary(deps, { accountId: ACCOUNT, weekKey: '2026-W47', weekStart });
  expect(answer).toEqual({ sent: 1, outcomes: ['sent'] });
  return m.sent[0]!;
}

/** The one-click URL in `List-Unsubscribe`, and the footer's page link in the HTML and the text. */
function links(m: OutgoingMail) {
  const header = /^<(https:\/\/[^>]+)>$/.exec(m.headers['List-Unsubscribe'] ?? '')?.[1];
  const footer = htmlTargets(m.html).filter((h) => h.includes('unsubscribe'));
  const text = /^Unsubscribe: (\S+)$/m.exec(m.text)?.[1];
  return { header: new URL(header!), footer: footer.map((f) => new URL(f)), text: new URL(text!) };
}

beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('EMAIL_LINK_SECRET', SECRET);
  rpc.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe.each<[string, () => Promise<OutgoingMail>, UnsubscribeKind]>([
  ['an alert', alertSent, 'alerts'],
  ['a weekly summary', summarySent, 'summary'],
])('%s, sent (not a preview)', (_, sent, kind) => {
  it('carries one real signed token in List-Unsubscribe and in the footer, for the seat and kind', async () => {
    const m = await sent();
    const l = links(m);
    expect(m.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(`${l.header.origin}${l.header.pathname}`).toBe('https://crawlmouse.com/api/unsubscribe');
    expect(l.footer).toHaveLength(1);
    expect(`${l.footer[0]!.origin}${l.footer[0]!.pathname}`).toBe(
      'https://crawlmouse.com/unsubscribe',
    );
    const token = l.header.searchParams.get('t')!;
    expect(l.footer[0]!.searchParams.get('t')).toBe(token);
    expect(l.text.searchParams.get('t')).toBe(token);
    expect(token).not.toMatch(/PREVIEW/);
    expect(verifyUnsubscribe(SECRET, token, new Date())).toEqual({ ok: true, seatId: SEAT, kind });
  });

  it('POST /api/unsubscribe accepts the header’s one-click URL as a mail client sends it', async () => {
    const { header } = links(await sent());
    const { POST } = await import('@/app/api/unsubscribe/route');
    const res = await POST(
      new Request(header.href, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('unsubscribe_seat', { p_seat: SEAT, p_kind: kind });
  });

  it('the footer’s page accepts its token and asks, and its form’s POST is accepted too', async () => {
    const { footer } = links(await sent());
    const t = footer[0]!.searchParams.get('t')!;
    const { default: Page } = await import('@/app/unsubscribe/page');
    const out = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ t }) }));
    expect(out).toContain(`<input type="hidden" name="t" value="${t}"/>`);
    expect(out).toContain(UNSUBSCRIBE_COPY.ask[kind]);
    expect(rpc).not.toHaveBeenCalled();
    const { POST } = await import('@/app/api/unsubscribe/route');
    const res = await POST(
      new Request('https://crawlmouse.com/api/unsubscribe', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'https://crawlmouse.com',
        },
        body: new URLSearchParams({ t }).toString(),
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://crawlmouse.com/unsubscribe');
    expect(rpc).toHaveBeenCalledWith('unsubscribe_seat', { p_seat: SEAT, p_kind: kind });
  });
});
