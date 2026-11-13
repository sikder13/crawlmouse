/**
 * One run of the client report schedules (CC-31 D8; docs/specs/v2/31-agency.md §10), for the hourly
 * function `crawlmouse.report.schedules`. For each schedule that is due it decides, in this order:
 *
 * 1. the account's plan has no client reports now: nothing is sent;
 * 2. the client has no contact address: nothing is sent;
 * 3. the account is in its Agency trial and the contact is not the owner's own address: nothing is
 *    sent, the confirmation mail included;
 * 4. the contact has not confirmed: the confirmation mail is asked for, once, and no report is sent.
 *    It is not asked for where the contact may not be asked (`askRefused`: it declined, or it
 *    paused the reports and was asked again within the window);
 * 5. the site has no finished check: nothing is sent;
 * 6. no check queued after the one the last sent report ended on found a change, and the schedule
 *    does not send unchanged: nothing is sent;
 * 7. otherwise the report's row is written for the slot and its mail is asked for. Production's mail
 *    port hands the report on and answers `queued` (`inngestClientReportMail`): the mailer's handler
 *    marks the row `sent` when the mail has gone. A port that sends inside the run answers `sent`,
 *    and the run then marks the row itself; the tests' port is the one that does.
 *
 * Whatever was decided, the schedule moves to its next run, so a client that cannot be sent to this
 * week is looked at again next week and no schedule is run twice for one slot. The due list holds
 * no address (`due_report_schedules` answers whether the contact is the owner's), and none is read
 * here.
 */
import type { ScheduleRunCounts } from '../../../../../inngest/report-schedules';
import { effectiveTier, GATES, type Tier } from '../../entitlement-v2';
import type { AgencyCapture } from './events';
import type { ClientReportMail } from './schedules';

/** A schedule that is due, as `due_report_schedules` lists it. */
export interface DueSchedule {
  siteId: string;
  accountId: string;
  /** The run this is: the schedule's `next_run_at`. */
  slot: string;
  sendWhenUnchanged: boolean;
  hasContact: boolean;
  confirmed: boolean;
  confirmationRequested: boolean;
  /**
   * The contact may not be asked to confirm: it declined to be asked, or it paused the reports and
   * was asked again within the window (`report_ask_refusals`).
   */
  askRefused: boolean;
  contactIsOwner: boolean;
  /** The account's plan as stored, with the two clocks `effectiveTier` reads. */
  account: {
    state: 'free' | 'pro_trial' | 'pro' | 'agency_trial' | 'agency' | 'past_due';
    tier: Tier;
    pastDueTier: Exclude<Tier, 'free'> | null;
    pastDueSince: Date | null;
    trialVariant: 'no_card' | 'card_required' | null;
    trialEndsAt: Date | null;
  };
  /** The site's latest finished or partial check, or null. */
  checkId: string | null;
  /** Whether a check queued after the one the last sent client report ended on found a change. */
  changed: boolean;
}

export interface ScheduleRunStore {
  due(now: Date, limit: number): Promise<DueSchedule[]>;
  /** The slot's report row: written, or the one a run before wrote. Null when there is none to write. */
  writeReport(
    siteId: string,
    slot: string,
    checkId: string,
    now: Date,
  ): Promise<{ reportId: string; status: 'scheduled' | 'sent' } | null>;
  /** The report's mail has gone. `first` when the account had sent no client report before. */
  markSent(reportId: string, now: Date): Promise<{ accountId: string; first: boolean } | null>;
  /** The run is done with the schedule: it moves to its next run. */
  markRun(siteId: string, now: Date): Promise<void>;
}

export interface ScheduleRunDeps {
  store: ScheduleRunStore;
  mail: ClientReportMail;
  capture: AgencyCapture;
  now(): Date;
}

/** Schedules one run takes: the hour's later ones wait for the next run. */
export const RUN_LIMIT = 200;

export const SKIP_REASONS = [
  'plan',
  'no_contact',
  'unconfirmed',
  'trial',
  'no_check',
  'unchanged',
  'no_report',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Why a due schedule's report is not sent, or null when it is. */
export function skipReason(s: DueSchedule, now: Date): SkipReason | null {
  if (!GATES[effectiveTier(s.account, now)].agencyBranding) return 'plan';
  if (!s.hasContact) return 'no_contact';
  // Before the confirmation: in its Agency trial an account mails its owner's own address and no
  // other, and the confirmation is a mail too (`issue_recipient_confirmation` holds the same rule).
  if (s.account.state === 'agency_trial' && !s.contactIsOwner) return 'trial';
  if (!s.confirmed) return 'unconfirmed';
  if (s.checkId === null) return 'no_check';
  if (!s.changed && !s.sendWhenUnchanged) return 'unchanged';
  return null;
}

async function sendReport(
  deps: ScheduleRunDeps,
  s: DueSchedule & { checkId: string },
): Promise<'sent' | 'queued' | 'no_report'> {
  const now = deps.now();
  const report = await deps.store.writeReport(s.siteId, s.slot, s.checkId, now);
  if (report === null) return 'no_report';
  // A run before sent this slot's report and stopped before it moved the schedule on.
  if (report.status === 'sent') return 'sent';
  if ((await deps.mail.report({ reportId: report.reportId })) === 'queued') return 'queued';
  const marked = await deps.store.markSent(report.reportId, deps.now());
  if (marked?.first) await deps.capture('first_client_report_sent', marked.accountId, {});
  return 'sent';
}

export async function runDueSchedules(deps: ScheduleRunDeps): Promise<ScheduleRunCounts> {
  const due = await deps.store.due(deps.now(), RUN_LIMIT);
  const counts: ScheduleRunCounts = {
    due: due.length,
    sent: 0,
    queued: 0,
    confirmations: 0,
    skipped: {},
  };
  const skip = (reason: SkipReason) => {
    counts.skipped[reason] = (counts.skipped[reason] ?? 0) + 1;
  };
  for (const s of due) {
    const reason = skipReason(s, deps.now());
    if (reason === 'unconfirmed' && !s.confirmationRequested && !s.askRefused) {
      // Keyed by the slot: a run that is retried asks once.
      await deps.mail.confirmation({ siteId: s.siteId, key: s.slot });
      counts.confirmations += 1;
    }
    if (reason !== null) {
      skip(reason);
    } else {
      const outcome = await sendReport(deps, s as DueSchedule & { checkId: string });
      if (outcome === 'no_report') skip(outcome);
      else counts[outcome] += 1;
    }
    await deps.store.markRun(s.siteId, deps.now());
  }
  return counts;
}
