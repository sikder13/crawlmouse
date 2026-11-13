/**
 * What a page says when a form posted from it was refused: one line per notice code
 * (`NOTICE_CODES` in lib/v2/account/route.ts, which sends the form back with `?notice=`). The
 * compiler holds the two lists to one set. A code outside it shows nothing.
 */
import type { Tier } from '../../entitlement-v2';
import { CONFIRM_MAILS_PER_DAY, REASK_WINDOW_DAYS } from '../agency/confirm-bounds';
import { sitesFullMessage } from '../agency/gates';
import { ALERTS_SENDER } from '../../auth/constants';
import type { Addition } from '../copy-registry';
import { dayDate, weekdayTime } from '../format';
import { noticeOf, type NoticeCode } from '../account/route';

const NEXT_CHECK = 'the next check confirms the fix or reopens it.';
const capitalised = (t: string) => t[0]!.toUpperCase() + t.slice(1);

/** In an Agency trial: why a client's contact was not mailed, and when it will be. */
const WAITS_FOR_PLAN =
  'During the trial, reports go to your own address only: this contact is asked to confirm once the trial has become the plan.';

/**
 * What a sender is told once the confirmation was asked for. It states a request and not a
 * delivery: the mailer keeps the address's own bound, across senders, and past it sends nothing.
 */
const ASKED_TO_CONFIRM = `The contact is being asked to confirm, and reports are sent once it does. These requests are bounded by the day, for an account and for an address (an address is sent at most ${CONFIRM_MAILS_PER_DAY.address}, from any sender); past a bound, the schedule’s next run asks.`;

/** A save whose contact may not be asked: the row on the page says which of the two it is. */
const NOT_ASKED =
  'The contact is not asked to confirm: it answered “Don’t ask me again”, or it paused the reports and has been asked again since. The client’s row says which.';

/** `at` is the next-allowed time in the account's zone ("Tue 13:30"), or null when none was sent. */
export const NOTICE_LINES: Record<NoticeCode, (at: string | null) => string> = {
  capped: (at) =>
    `This site has used its re-checks for the last 24 hours on your plan.${at ? ` The next can run ${at}.` : ''}`,
  adds_capped: (at) =>
    `This account has added as many sites in the last 24 hours as its plan allows.${at ? ` The next can be added ${at}.` : ''}`,
  domain_capped: (at) =>
    `That address has been audited too often in the last hour.${at ? ` It can be added again ${at}.` : ''}`,
  paused: () => 'Checks are paused for maintenance, so nothing was started. Try again later.',
  unavailable: () => 'Checks are not running yet, so nothing was started.',
  capacity: () => 'Today’s checks are all taken, so nothing was started. Try again later.',
  check_running: () => 'A check of this site is already running. Ask for another once it ends.',
  recently_checked: (at) =>
    // The bucket's check may have finished, failed or been deferred: the line names the request only.
    `A check of this site was asked for in the last few minutes, so no new one was started.${at ? ` Ask again from ${at}.` : ''}`,
  site_paused: () => 'Checks of this site are paused, so it was not checked.',
  site_exists: () => 'That site is already on this account.',
  upgrade_required: () => 'That needs a paid plan.',
  invalid_host: () => 'That is not a site address. Enter a domain, such as example.com.',
  host_refused: () => 'That address leads somewhere we do not crawl, such as a private network.',
  staging_site: () => 'A staging site has no competitors and no staging site of its own.',
  role_refused: () => 'Your seat cannot do that. The account’s owner or a manager can.',
  scoped_seat: () => 'Your seat covers only some clients, so it cannot add a site.',
  no_account: () => 'This sign-in is not a member of any account.',
  confirm_required: () => 'The site was not removed: tick the box to confirm, then remove it.',
  account_ambiguous: () =>
    'This sign-in is a member of more than one account and none is set as the one to open.',
  not_owner: () => 'Only the account’s owner can start the trial.',
  not_eligible: () => 'This account cannot start a trial: it is on a plan, or has had its trial.',
  refused: () => 'A trial could not be started for this account.',
  conflict: () =>
    'The account changed while the trial was starting. Reload the page and try again.',
  trial_failed: () => 'The trial did not start. Nothing was changed; try again later.',
  trial_unavailable: () => 'Trials cannot be started right now. Try again later.',
  not_markable: () => 'That fix cannot be marked done: it is already marked, or no longer open.',
  // The mark stands in each of these; reopen is deferred, so none offers an undo (owner ruling Q4).
  marked_done: () => 'Marked done. A re-check is queued; it confirms the fix or reopens it.',
  marked_done_capped: (at) =>
    `Marked done. This site has used its re-checks for the last 24 hours, so none was queued; ${NEXT_CHECK}${at ? ` A re-check can be asked from ${at}.` : ''}`,
  marked_done_check_running: () =>
    `Marked done. A check of this site was already running, so no re-check was queued; ask for one once it ends. ${capitalised(NEXT_CHECK)}`,
  marked_done_recently_checked: (at) =>
    `Marked done. A check of this site was asked for in the last few minutes, so no re-check was queued; ${NEXT_CHECK}${at ? ` A re-check can be asked from ${at}.` : ''}`,
  marked_done_capacity: () =>
    `Marked done. Today’s checks are all taken, so no re-check was queued; ${NEXT_CHECK}`,
  marked_done_site_paused: () =>
    `Marked done. Checks of this site are paused, so no re-check was queued; ${NEXT_CHECK}`,
  marked_done_not_checked: () => `Marked done. No re-check was queued; ${NEXT_CHECK}`,
  // CC-28's mailer sends the recorded request (`fix.email_developer_requested`), registered under the
  // same V2_CHECKS_PUBLIC that serves the route this line answers.
  email_requested: () => `Recorded. The fix will be emailed to that address from ${ALERTS_SENDER}.`,
  invalid_email: () => 'That is not an email address, so nothing was recorded.',
  rate_limited: (at) =>
    `Too many emails were asked for in a short time, so nothing was recorded.${at ? ` Ask again from ${at}.` : ''}`,
  // The mailer sends the invitation (`seat.invite.requested`, inngest/mail.ts), registered under the
  // same V2_CHECKS_PUBLIC that serves the route this line answers.
  seat_invited: () =>
    `Invited. The invitation will be emailed to that address from ${ALERTS_SENDER}, and the seat is held for it until the invitation is accepted or removed.`,
  seat_resent: () =>
    'A new invitation replaces the one sent before; the earlier link no longer works.',
  seat_changed: () => 'The seat was changed.',
  seat_removed: () => 'Removed. That person no longer sees this account.',
  seat_exists: () => 'That address already has a seat or an invitation on this account.',
  seats_full: () => 'Every seat on this account is taken, so nobody was invited.',
  invalid_scope: () =>
    'Choose every client, or at least one client site of this account that is not a staging copy.',
  seat_owner: () => 'The owner’s seat cannot be changed or removed.',
  not_invited: () => 'That invitation was already accepted, so nothing was sent.',
  invite_not_mailed: () =>
    'The invitation is saved, but its email could not be sent just now. Use “Send a new invitation” on the seat’s row.',
  invite_gone: () =>
    'This invitation cannot be used: it was accepted, replaced, removed or has expired.',
  // `/invite` says this and `invite_gone` as its own state (`inviteView`), not as a line beside it.
  invite_no_link: () =>
    'Nothing was accepted: this page no longer holds the invitation. Open the link in the invitation email again.',
  email_mismatch: () =>
    'This invitation was sent to another address. Sign in with the address it was sent to.',
  invite_full: () =>
    'The account has no seat free, so the invitation was not accepted. Its owner can free one.',
  already_member: () => 'You already have a seat on this account.',
  extras_changed: () =>
    'The change was sent to billing. The new limits show here once the payment is confirmed.',
  extras_unchanged: () => 'The plan already has those quantities, so nothing was changed.',
  in_use: () =>
    'More seats or sites are in use than that would leave. Remove a seat or a site first, then lower the quantity.',
  mixed_change: () =>
    'Raise one quantity or lower one, not both at once: a raise is charged now and a lowering is not credited. Nothing was changed.',
  payment_failed: () => 'The card was declined, so nothing was changed.',
  subscription_unchangeable: () =>
    'This plan cannot be changed here: it is set to end, or its last payment has not gone through. Settings › Plan has the details.',
  extras_in_trial: () => 'Seats and sites are bought once the trial has become the plan.',
  billing_unavailable: () =>
    'Billing cannot be reached right now, so nothing was changed. Try again later.',
  reports_capped: (at) =>
    `This account has made as many reports as it may for now, so none was made.${at ? ` The next can be made ${at}.` : ''}`,
  links_capped: (at) =>
    `No link was made: the account’s limit on new links was reached, or could not be read.${at ? ` Try again from ${at}.` : ''}`,
  fix_not_verified: () =>
    'That check did not verify the fix, so there is no proof to make. Nothing was made.',
  share_made: () =>
    'The link is made. It is shown on its report’s row for a short while: copy it now. Making another replaces it.',
  share_revoked: () => 'The link was withdrawn and no longer opens.',
  not_ready: () => 'That report’s file is not stored yet, so no link was made.',
  schedule_saved: () => 'The schedule was saved.',
  schedule_saved_asked: () => `The schedule was saved. ${ASKED_TO_CONFIRM}`,
  schedule_saved_waits: () => `The schedule was saved. ${WAITS_FOR_PLAN}`,
  schedule_cleared: () => 'The schedule was removed. No more reports are sent for this client.',
  client_saved: () => 'Saved.',
  client_saved_asked: () => `Saved. ${ASKED_TO_CONFIRM}`,
  client_saved_waits: () => `Saved. ${WAITS_FOR_PLAN}`,
  client_saved_later: () =>
    'Saved. No more confirmations can be sent today: the contact is asked at the schedule’s next run.',
  invalid_owner: () => 'That seat cannot own this client: it is not active, or does not cover it.',
  confirmation_requested: () =>
    'A confirmation was asked for. Reports are sent once the contact confirms.',
  confirmation_waits: () => WAITS_FOR_PLAN,
  nothing_to_confirm: () =>
    'There is nothing to confirm: the client has no schedule or no contact, the contact has confirmed, or the recipient has paused the reports.',
  schedule_resumed: () => `The pause was lifted. ${ASKED_TO_CONFIRM}`,
  schedule_resumed_later: () =>
    'The pause was lifted. The contact is asked to confirm again at the schedule’s next run; reports start once it confirms.',
  not_paused: () => 'That schedule is not paused.',
  schedule_saved_not_asked: () => `The schedule was saved. ${NOT_ASKED}`,
  client_saved_not_asked: () => `Saved. ${NOT_ASKED}`,
  contact_declined: () =>
    'This contact answered “Don’t ask me again”, so no request to confirm is sent to that address for this client, and no report. Nothing done here changes that.',
  asked_recently: (at) =>
    `This contact paused the reports and has been asked to confirm again since. A contact that paused is asked at most once in ${REASK_WINDOW_DAYS} days.${at ? ` It can be asked again from ${at}.` : ''}`,
  report_declined: () =>
    'Done. You will not be asked again about these reports, and none is sent to this address.',
  report_confirmed: () => 'Confirmed. The reports will be sent to this address.',
  report_paused: () =>
    `Paused. No more reports are sent. They start again only if you are asked to confirm again and do; you are asked at most once in ${REASK_WINDOW_DAYS} days.`,
  report_link_gone: () => 'This link can no longer be used: it was replaced or has expired.',
  invalid: () => 'That request was not understood, so nothing was changed.',
  method_not_allowed: () => 'That form could not be sent that way. Reload the page and try again.',
};

/**
 * The line for a page's search params, or null when they carry no notice of ours.
 *
 * `sitesOn` is the account's tier, given by a page where the add-site form is the form a plan's
 * limit refuses (the dashboard, the client matrix). There `upgrade_required` is said as the gate
 * message for sites (`sitesFullMessage`, whose numbers are GATES' and prices.ts's). A page that
 * gives none keeps the code's general line: the address carries the code, not which gate refused.
 */
const DATED: ReadonlySet<NoticeCode> = new Set(['asked_recently']);

export function noticeLine(
  params: Readonly<Record<string, string | string[] | undefined>>,
  zone: string,
  sitesOn?: Tier,
): { code: NoticeCode; text: string } | null {
  const n = noticeOf(params);
  if (n === null) return null;
  if (n.code === 'upgrade_required' && sitesOn !== undefined) {
    return { code: n.code, text: sitesFullMessage(sitesOn) };
  }
  // A day weeks away is named by its date; the others are hours away, a weekday and a time.
  const at = n.next
    ? DATED.has(n.code)
      ? dayDate(n.next, zone)
      : weekdayTime(n.next, zone)
    : null;
  return { code: n.code, text: NOTICE_LINES[n.code](at) };
}

export const NOTICE_ADDITIONS: Addition[] = [
  {
    screen: 'dashboard, site',
    what: 'A form the account routes refused comes back to its page with one line saying why (and, for a cap, when the next is allowed)',
    source: 'CC-26b follow-up (refused live forms)',
  },
];
