import { describe, expect, it } from 'vitest';
import { buildOutgoing, SUBJECT_MAX } from '../headers';
import type { RenderedMail } from '../types';
import { accountDelete, emailChangeConfirm, emailChangeNotice } from './account-links';
import { agencyPlusContact, type AgencyPlusContactInput } from './agency-plus-contact';
import { alertTemplate, type AlertMailInput, type MailChange } from './alert';
import { checkNotify, type CheckNotifyInput } from './check-notify';
import { clientReport, type ClientReportInput } from './client-report';
import { fixToDeveloper, type FixToDeveloperInput } from './fix-to-developer';
import { DIGEST_FIGURES, founderDigest, type DigestCounts } from './founder-digest';
import {
  founderEvent,
  founderOverflow,
  type FounderEventInput,
  type FounderOverflowInput,
} from './founder-event';
import { foreignTargets } from './inspect';
import { reportConfirm, type ReportConfirmInput } from './report-confirm';
import { seatInvite, type SeatInviteInput } from './seat-invite';
import { trialReminder, type TrialReminderInput } from './trial-reminder';
import { weeklySummaryTemplate, type WeeklySummaryInput } from './weekly-summary';

/**
 * D3 swept over the axis the rule keys on (§10): every string a template takes from outside our code,
 * in every template, set in turn to each hostile value. Each template's input is walked for its string
 * leaves, and each leaf must be named below as outside or as ours, so a field added to an input fails
 * here until it is classed. Ours are ids, tokens, times, zones and enum values, which the templates
 * check (an id that is not one throws) or which no outsider writes.
 */

const HOSTILE = [
  'a\r\nBcc: victim@example.com',
  'a\nb',
  'a\rb',
  'a\u2028b\u2029c',
  'a\u0000b\u007fc',
  'a\tb',
  '<x-hostile href="https://evil.example/">x</x-hostile>',
  `" onmouseover='x' &amp; https://evil.example/x`,
  'h'.repeat(10_000),
];

const ID = 'c0000000-0000-4000-8000-0000000000aa';
const SITE = 'b0000000-0000-4000-8000-0000000000bb';
const FIX = 'f0000000-0000-4000-8000-0000000000cc';
const TOKEN = 'T'.repeat(43);
const UNSUB = 'https://crawlmouse.com/unsubscribe?t=abc.def';

const change = (): MailChange => ({
  kind: 'opened',
  subject: 'crawler_access',
  severity: 'bad',
  summary: 'GPTBot: allowed → disallowed',
  where: 'robots.txt',
  pages_affected: 3,
  ua: 'GPTBot',
  grade_deltas: [
    { grade: 'ai_readability', from_score: 41, to_score: 22, from_grade: 'D', to_grade: 'F' },
  ],
});

interface Case<I> {
  name: string;
  input: I;
  render(input: I): RenderedMail;
  /** String leaves set from outside our code, as paths with `*` for an array index. */
  outside: readonly string[];
  /** String leaves that are ours. */
  ours: readonly string[];
}

/** A case typed by its own input, kept in one list. */
const kase = <I>(c: Case<I>): Case<unknown> => c as unknown as Case<unknown>;

const CASES: readonly Case<unknown>[] = [
  kase({
    name: 'check-notify',
    input: { host: 'example.com', checkId: ID, outcome: 'finished' } satisfies CheckNotifyInput,
    render: checkNotify,
    outside: ['host'],
    ours: ['checkId', 'outcome'],
  }),
  kase({
    name: 'fix-to-developer',
    input: {
      host: 'example.com',
      fixTitle: 'Let GPTBot read the site',
      packet: 'robots.txt blocks GPTBot.',
    } satisfies FixToDeveloperInput,
    render: fixToDeveloper,
    outside: ['host', 'fixTitle', 'packet'],
    ours: [],
  }),
  kase({
    name: 'trial-reminder',
    input: {
      plan: 'pro',
      variant: 'no_card',
      endsAt: '2026-11-16T10:00:00.000Z',
      timezone: 'America/New_York',
    } satisfies TrialReminderInput,
    render: trialReminder,
    outside: [],
    ours: ['plan', 'variant', 'endsAt', 'timezone'],
  }),
  kase({
    name: 'email-change-confirm',
    input: { token: TOKEN },
    render: emailChangeConfirm,
    outside: [],
    ours: ['token'],
  }),
  kase({
    name: 'email-change-notice',
    input: { token: TOKEN },
    render: emailChangeNotice,
    outside: [],
    ours: ['token'],
  }),
  kase({
    name: 'account-delete',
    input: { confirmToken: TOKEN, restoreToken: TOKEN },
    render: accountDelete,
    outside: [],
    ours: ['confirmToken', 'restoreToken'],
  }),
  kase({
    name: 'alert',
    input: {
      host: 'example.com',
      checkId: ID,
      checkedAt: '2026-11-13T10:00:00.000Z',
      zone: 'America/New_York',
      changes: [{ ...change(), fix_id: FIX }],
      unsubscribeUrl: UNSUB,
    } satisfies AlertMailInput,
    render: alertTemplate,
    outside: ['host', 'changes.*.summary', 'changes.*.where', 'changes.*.ua'],
    ours: [
      'checkId',
      'checkedAt',
      'zone',
      'unsubscribeUrl',
      'changes.*.kind',
      'changes.*.subject',
      'changes.*.severity',
      'changes.*.fix_id',
      'changes.*.grade_deltas.*.grade',
      'changes.*.grade_deltas.*.from_grade',
      'changes.*.grade_deltas.*.to_grade',
    ],
  }),
  kase({
    name: 'weekly-summary',
    input: {
      since: '2026-11-09T05:00:00.000Z',
      until: '2026-11-16T05:00:00.000Z',
      zone: 'America/New_York',
      sites: [
        {
          siteId: SITE,
          host: 'example.com',
          changes: [{ ...change(), detected_at: '2026-11-10T05:00:00.000Z' }],
        },
      ],
      unsubscribeUrl: UNSUB,
    } satisfies WeeklySummaryInput,
    render: weeklySummaryTemplate,
    outside: [
      'sites.*.host',
      'sites.*.changes.*.summary',
      'sites.*.changes.*.where',
      'sites.*.changes.*.ua',
    ],
    ours: [
      'since',
      'until',
      'zone',
      'unsubscribeUrl',
      'sites.*.siteId',
      'sites.*.changes.*.kind',
      'sites.*.changes.*.subject',
      'sites.*.changes.*.severity',
      'sites.*.changes.*.detected_at',
      'sites.*.changes.*.grade_deltas.*.grade',
      'sites.*.changes.*.grade_deltas.*.from_grade',
      'sites.*.changes.*.grade_deltas.*.to_grade',
    ],
  }),
  kase({
    name: 'seat-invite',
    input: {
      token: TOKEN,
      accountName: 'Summit Digital',
      role: 'developer',
    } satisfies SeatInviteInput,
    render: seatInvite,
    outside: ['accountName'],
    ours: ['token', 'role'],
  }),
  kase({
    name: 'report-confirm',
    input: {
      token: TOKEN,
      declineToken: TOKEN,
      agencyName: 'Summit Digital',
      host: 'example.com',
    } satisfies ReportConfirmInput,
    render: reportConfirm,
    outside: ['agencyName', 'host'],
    ours: ['token', 'declineToken'],
  }),
  kase({
    name: 'client-report',
    input: {
      agencyName: 'Summit Digital',
      host: 'example.com',
      headline: 'Report for example.com',
      lines: ['example.com', 'Checked Fri 30 Oct'],
      footer: 'Checked with Crawlmouse · Fri 30 Oct',
      shareToken: 'S'.repeat(22),
      pauseToken: TOKEN,
    } satisfies ClientReportInput,
    render: clientReport,
    outside: ['agencyName', 'host', 'headline', 'lines.*', 'footer'],
    ours: ['shareToken', 'pauseToken'],
  }),
  kase({
    name: 'agency-plus-contact',
    input: {
      email: 'ops@summit.example',
      sites: 40,
      note: 'We run 40 client sites.',
    } satisfies AgencyPlusContactInput,
    render: agencyPlusContact,
    outside: ['email', 'note'],
    ours: [],
  }),
  // CC-33: the founder's notices. The host and the owner's address are outside; Stripe's currency
  // is checked against three lower-case letters before it is shown, and its invoice status against
  // Stripe's five statuses.
  kase({
    name: 'founder-event',
    input: {
      kind: 'payment',
      internal: false,
      accountId: ID,
      plan: 'pro',
      payment: 'first',
      amount: { minor: 1900, currency: 'usd', status: 'paid' },
      host: 'example.com',
      ownerEmail: 'owner@example.com',
      occurredAt: '2026-11-13T10:00:00.000Z',
    } satisfies FounderEventInput,
    render: founderEvent,
    outside: ['host', 'ownerEmail'],
    ours: [
      'kind',
      'accountId',
      'plan',
      'payment',
      'amount.currency',
      'amount.status',
      'occurredAt',
    ],
  }),
  kase({
    name: 'founder-overflow',
    input: {
      total: 1,
      rows: [{ kind: 'signup', accountId: ID, internal: false }],
    } satisfies FounderOverflowInput,
    render: founderOverflow,
    outside: [],
    ours: ['rows.*.kind', 'rows.*.accountId'],
  }),
  kase({
    name: 'founder-digest',
    input: {
      variant: 'weekly',
      monday: '2026-11-09',
      week: Object.fromEntries(DIGEST_FIGURES.map(([k]) => [k, 1])) as DigestCounts,
      previous: Object.fromEntries(DIGEST_FIGURES.map(([k]) => [k, 0])) as DigestCounts,
    },
    render: founderDigest,
    outside: [],
    ours: ['variant', 'monday'],
  }),
];

/** Every string leaf of `v`, as a path with `*` for each array index. */
function stringPaths(v: unknown, at = ''): string[] {
  if (typeof v === 'string') return [at];
  if (Array.isArray(v)) return v.flatMap((x) => stringPaths(x, at ? `${at}.*` : '*'));
  if (v !== null && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => stringPaths(x, at ? `${at}.${k}` : k));
  }
  return [];
}

/** A copy of `v` with every leaf at `path` set to `value`. */
function setPath(v: unknown, path: readonly string[], value: string): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(v)) return v.map((x) => setPath(x, rest, value));
  const o = v as Record<string, unknown>;
  return { ...o, [head!]: setPath(o[head!], rest, value) };
}

describe('every template input’s string is classed as outside or ours', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_, c) => {
    expect([...new Set(stringPaths(c.input))].sort()).toEqual([...c.outside, ...c.ours].sort());
  });
});

describe('D3: every outside string, set to each hostile value, leaves a sendable message', () => {
  const sweep = CASES.flatMap((c) =>
    c.outside.flatMap((path) =>
      HOSTILE.map((bad, k) => [`${c.name} ${path} #${k}`, c, path, bad] as const),
    ),
  );

  it('sweeps each template that takes an outside string', () => {
    expect(new Set(sweep.map(([, c]) => c.name))).toEqual(
      new Set([
        'check-notify',
        'fix-to-developer',
        'alert',
        'weekly-summary',
        'seat-invite',
        'report-confirm',
        'client-report',
        'agency-plus-contact',
        'founder-event',
      ]),
    );
  });

  it.each(sweep)('%s', (_, c, path, bad) => {
    const m = c.render(setPath(c.input, path.split('.'), bad));
    // The subject is one bounded line, so the header builder accepts it.
    expect(() => buildOutgoing({ to: 'a@b.com', mail: m, idempotencyKey: 'k' })).not.toThrow();
    expect(m.subject.length).toBeLessThanOrEqual(SUBJECT_MAX);
    expect(m.subject).not.toMatch(/[\r\n\u2028\u2029]/);
    // Escaped in the HTML, and never a link target.
    expect(m.html).not.toContain('<x-hostile');
    expect(m.html).not.toContain(`" onmouseover`);
    expect(foreignTargets(m)).toEqual([]);
  });
});
