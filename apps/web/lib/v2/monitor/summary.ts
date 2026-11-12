/**
 * The weekly summary's work (CC-28 D6), behind ports. `due_summary_accounts` answers the paid,
 * unmarked accounts whose Monday 08:00 hour it is in their zone, with the ISO week and the Monday that
 * starts it; the summary covers the week before, from the Monday before that, read in the same zone
 * (`weekBefore`, so a week that crosses a clock change is still Monday to Monday).
 *
 * `sendSummary` sends nothing to an account marked for deletion, nothing for a week with no change
 * (a `baseline` row is not a change of the site), and nothing without `EMAIL_LINK_SECRET` (Q6, logged);
 * otherwise one email per recipient seat (`summary_recipients`), keyed
 * `summary:<accountId>:<weekKey>:<seatId>`, with List-Unsubscribe for that seat.
 */
import { unsubscribeHeaders } from '../mail/headers';
import type { UnsubscribeLinks } from '../mail/links';
import { send, type MailDeps } from '../mail/send';
import { sendEach, type SeatOutcome } from './alerts';
import { weeklySummaryTemplate, type SummarySite } from '../mail/templates/weekly-summary';

export interface SummaryDue {
  accountId: string;
  /** "2026-W47": the ISO week of the Monday the summary is sent, in the account's zone. */
  weekKey: string;
  /** That Monday 00:00 in the account's zone: the end of the week the summary covers. */
  weekStart: string;
}

export interface SummaryStore {
  due(now: Date): Promise<SummaryDue[]>;
  /** The account's zone and whether it is marked for deletion; null when there is no such account. */
  account(accountId: string): Promise<{ marked: boolean; zone: string } | null>;
  /** The account's live sites' changes detected in [since, until), baselines left out. */
  sites(accountId: string, since: string, until: string): Promise<SummarySite[]>;
  recipients(accountId: string): Promise<{ seatId: string; email: string }[]>;
}

export interface SummaryDeps {
  store: SummaryStore;
  mail: MailDeps;
  linkSecret: string | null;
  /** The seat's unsubscribe page (footer) and RFC 8058 one-click target (header) for this kind. */
  unsubscribeLinks(secret: string, seatId: string, now: Date): UnsubscribeLinks;
  capture(accountId: string, properties: { sites: number; changes: number }): Promise<void>;
  log(event: 'summary.no_link_secret', fields: Readonly<Record<string, string>>): void;
  now(): Date;
}

export type SummaryAnswer =
  | { skip: 'no_account' | 'marked' | 'empty' | 'no_link_secret' | 'no_recipients' }
  | { sent: number; outcomes: SeatOutcome[] };

/** The offset of `zone` from UTC at `ms`, in milliseconds. */
function offsetMs(zone: string, ms: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  const local = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return local - (ms - (ms % 1000));
}

const WEEK_MS = 7 * 86_400_000;

/** The same local time one calendar week before `iso`, in `zone`. */
export function weekBefore(iso: string, zone: string): string {
  const end = Date.parse(iso);
  const guess = end - WEEK_MS;
  return new Date(guess + offsetMs(zone, end) - offsetMs(zone, guess)).toISOString();
}

/** Sorted by account, so a page of the list is the same page on every retry of its step. */
export async function duePage(
  store: SummaryStore,
  now: Date,
  offset: number,
  limit: number,
): Promise<SummaryDue[]> {
  const all = [...(await store.due(now))].sort((a, b) => a.accountId.localeCompare(b.accountId));
  return all.filter((_, k) => k >= offset && k < offset + limit);
}

export async function sendSummary(deps: SummaryDeps, due: SummaryDue): Promise<SummaryAnswer> {
  const account = await deps.store.account(due.accountId);
  if (account === null) return { skip: 'no_account' };
  if (account.marked) return { skip: 'marked' };
  const since = weekBefore(due.weekStart, account.zone);
  const sites = (await deps.store.sites(due.accountId, since, due.weekStart)).filter(
    (s) => s.changes.length > 0,
  );
  if (sites.length === 0) return { skip: 'empty' };
  if (deps.linkSecret === null) {
    deps.log('summary.no_link_secret', { account: due.accountId });
    return { skip: 'no_link_secret' };
  }
  const secret = deps.linkSecret;
  const recipients = await deps.store.recipients(due.accountId);
  if (recipients.length === 0) return { skip: 'no_recipients' };
  const now = deps.now();
  const { outcomes, retry } = await sendEach(recipients, (r) => {
    const links = deps.unsubscribeLinks(secret, r.seatId, now);
    return send(deps.mail, {
      kind: 'weekly_summary',
      to: r.email,
      idempotencyKey: `summary:${due.accountId}:${due.weekKey}:${r.seatId}`,
      accountId: due.accountId,
      render: async () =>
        weeklySummaryTemplate({
          since,
          until: due.weekStart,
          zone: account.zone,
          sites,
          unsubscribeUrl: links.page,
        }),
      headers: () => unsubscribeHeaders({ url: links.oneClick }),
    });
  });
  // Every seat had its attempt this run; a retry now moves only the seats not yet sent.
  if (retry !== null) throw retry;
  const sent = outcomes.filter((o) => o === 'sent').length;
  // Counted on the run that completes, so a summary first sent by a run that then failed counts.
  if (outcomes.some((o) => o === 'sent' || o === 'done')) {
    await deps.capture(due.accountId, {
      sites: sites.length,
      changes: sites.reduce((n, s) => n + s.changes.length, 0),
    });
  }
  return { sent, outcomes };
}
