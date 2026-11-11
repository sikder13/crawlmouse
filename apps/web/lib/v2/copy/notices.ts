/**
 * What a page says when a form posted from it was refused: one line per notice code
 * (`NOTICE_CODES` in lib/v2/account/route.ts, which sends the form back with `?notice=`). The
 * compiler holds the two lists to one set. A code outside it shows nothing.
 */
import type { Addition } from '../copy-registry';
import { weekdayTime } from '../format';
import { noticeOf, type NoticeCode } from '../account/route';

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
  site_paused: () => 'Checks of this site are paused, so it was not checked.',
  site_exists: () => 'That site is already on this account.',
  upgrade_required: () => 'That needs a paid plan.',
  invalid_host: () => 'That is not a site address. Enter a domain, such as example.com.',
  host_refused: () => 'That address leads somewhere we do not crawl, such as a private network.',
  staging_site: () => 'A staging site has no competitors and no staging site of its own.',
  role_refused: () => 'Your seat cannot do that. The account’s owner or a manager can.',
  scoped_seat: () => 'Your seat covers only some clients, so it cannot add a site.',
  no_account: () => 'This sign-in is not a member of any account.',
  account_ambiguous: () =>
    'This sign-in is a member of more than one account and none is set as the one to open.',
  not_owner: () => 'Only the account’s owner can start the trial.',
  not_eligible: () => 'This account cannot start a trial: it is on a plan, or has had its trial.',
  refused: () => 'A trial could not be started for this account.',
  conflict: () =>
    'The account changed while the trial was starting. Reload the page and try again.',
  trial_failed: () => 'The trial did not start. Nothing was changed; try again later.',
  trial_unavailable: () => 'Trials cannot be started right now. Try again later.',
  invalid: () => 'That request was not understood, so nothing was changed.',
};

/** The line for a page's search params, or null when they carry no notice of ours. */
export function noticeLine(
  params: Readonly<Record<string, string | string[] | undefined>>,
  zone: string,
): { code: NoticeCode; text: string } | null {
  const n = noticeOf(params);
  if (n === null) return null;
  return { code: n.code, text: NOTICE_LINES[n.code](n.next ? weekdayTime(n.next, zone) : null) };
}

export const NOTICE_ADDITIONS: Addition[] = [
  {
    screen: 'dashboard, site',
    what: 'A form the account routes refused comes back to its page with one line saying why (and, for a cap, when the next is allowed)',
    source: 'CC-26b follow-up (refused live forms)',
  },
];
