/** The line a page shows when a form posted from it was refused (CC-26b follow-up). */
import { describe, expect, it } from 'vitest';
import { NOTICE_CODES } from '../account/route';
import { gateMessage, sitesFullMessage } from '../agency/gates';
import { NOTICE_LINES, noticeLine } from './notices';

const NEXT = '2026-11-10T13:30:00.000Z';
const ZONE = 'UTC';

describe('noticeLine', () => {
  it.each([
    [
      'capped',
      'This site has used its re-checks for the last 24 hours on your plan. The next can run Tue 13:30.',
    ],
    [
      'adds_capped',
      'This account has added as many sites in the last 24 hours as its plan allows. The next can be added Tue 13:30.',
    ],
    [
      'domain_capped',
      'That address has been audited too often in the last hour. It can be added again Tue 13:30.',
    ],
    ['paused', 'Checks are paused for maintenance, so nothing was started. Try again later.'],
    ['unavailable', 'Checks are not running yet, so nothing was started.'],
    ['capacity', 'Today’s checks are all taken, so nothing was started. Try again later.'],
    ['check_running', 'A check of this site is already running. Ask for another once it ends.'],
    [
      'recently_checked',
      'A check of this site was asked for in the last few minutes, so no new one was started. Ask again from Tue 13:30.',
    ],
    ['confirm_required', 'The site was not removed: tick the box to confirm, then remove it.'],
    ['site_paused', 'Checks of this site are paused, so it was not checked.'],
    ['site_exists', 'That site is already on this account.'],
    ['upgrade_required', 'That needs a paid plan.'],
    ['invalid_host', 'That is not a site address. Enter a domain, such as example.com.'],
    ['host_refused', 'That address leads somewhere we do not crawl, such as a private network.'],
    ['staging_site', 'A staging site has no competitors and no staging site of its own.'],
    ['role_refused', 'Your seat cannot do that. The account’s owner or a manager can.'],
    ['scoped_seat', 'Your seat covers only some clients, so it cannot add a site.'],
    ['no_account', 'This sign-in is not a member of any account.'],
    [
      'account_ambiguous',
      'This sign-in is a member of more than one account and none is set as the one to open.',
    ],
    ['not_owner', 'Only the account’s owner can start the trial.'],
    ['not_eligible', 'This account cannot start a trial: it is on a plan, or has had its trial.'],
    ['refused', 'A trial could not be started for this account.'],
    [
      'conflict',
      'The account changed while the trial was starting. Reload the page and try again.',
    ],
    ['trial_failed', 'The trial did not start. Nothing was changed; try again later.'],
    ['trial_unavailable', 'Trials cannot be started right now. Try again later.'],
    ['not_markable', 'That fix cannot be marked done: it is already marked, or no longer open.'],
    ['marked_done', 'Marked done. A re-check is queued; it confirms the fix or reopens it.'],
    [
      'marked_done_capped',
      'Marked done. This site has used its re-checks for the last 24 hours, so none was queued; the next check confirms the fix or reopens it. A re-check can be asked from Tue 13:30.',
    ],
    [
      'marked_done_check_running',
      'Marked done. A check of this site was already running, so no re-check was queued; ask for one once it ends. The next check confirms the fix or reopens it.',
    ],
    [
      'marked_done_recently_checked',
      'Marked done. A check of this site was asked for in the last few minutes, so no re-check was queued; the next check confirms the fix or reopens it. A re-check can be asked from Tue 13:30.',
    ],
    [
      'marked_done_capacity',
      'Marked done. Today’s checks are all taken, so no re-check was queued; the next check confirms the fix or reopens it.',
    ],
    [
      'marked_done_site_paused',
      'Marked done. Checks of this site are paused, so no re-check was queued; the next check confirms the fix or reopens it.',
    ],
    [
      'marked_done_not_checked',
      'Marked done. No re-check was queued; the next check confirms the fix or reopens it.',
    ],
    [
      'email_requested',
      'Recorded. The fix will be emailed to that address from alerts@crawlmouse.com.',
    ],
    ['invalid_email', 'That is not an email address, so nothing was recorded.'],
    [
      'rate_limited',
      'Too many emails were asked for in a short time, so nothing was recorded. Ask again from Tue 13:30.',
    ],
    [
      'reports_capped',
      'This account has made as many reports as it may for now, so none was made. The next can be made Tue 13:30.',
    ],
    [
      'fix_not_verified',
      'That check did not verify the fix, so there is no proof to make. Nothing was made.',
    ],
    ['invalid', 'That request was not understood, so nothing was changed.'],
    ['method_not_allowed', 'That form could not be sent that way. Reload the page and try again.'],
  ] as const)('%s', (code, line) => {
    expect(noticeLine({ notice: code, next: NEXT }, ZONE)).toEqual({ code, text: line });
  });

  it('a line is written for every notice code, and only for those', () => {
    expect(Object.keys(NOTICE_LINES).sort()).toEqual([...NOTICE_CODES].sort());
  });

  it('a cap with no readable time leaves the time out rather than guess', () => {
    expect(noticeLine({ notice: 'capped', next: 'soon' }, ZONE)!.text).toBe(
      'This site has used its re-checks for the last 24 hours on your plan.',
    );
  });

  it('a capped mark with no time still says the mark stands', () => {
    expect(noticeLine({ notice: 'marked_done_capped' }, ZONE)!.text).toBe(
      'Marked done. This site has used its re-checks for the last 24 hours, so none was queued; the next check confirms the fix or reopens it.',
    );
  });

  it('neither recently-checked line claims a check ran or succeeded (its check may have failed)', () => {
    for (const code of ['recently_checked', 'marked_done_recently_checked'] as const)
      expect(noticeLine({ notice: code, next: NEXT }, ZONE)!.text).not.toMatch(
        /\bwas checked\b|succeeded|passed/,
      );
  });

  it('the time is in the account’s zone', () => {
    expect(
      noticeLine({ notice: 'capped', next: NEXT }, 'America/Indiana/Indianapolis')!.text,
    ).toMatch(/run Tue 08:30\.$/);
  });

  it('on a page that names the account’s tier, a refused add is told the sites its plan keeps and the plan that lifts it', () => {
    const line = (tier: 'free' | 'pro' | 'agency') =>
      noticeLine({ notice: 'upgrade_required' }, ZONE, tier)!.text;
    expect(line('free')).toBe(gateMessage('sites', 'free'));
    expect(line('pro')).toBe(gateMessage('sites', 'pro'));
    expect(line('agency')).toBe(sitesFullMessage('agency'));
    // The sentences today, written out once: the second site on Free, the sixth on Pro.
    expect(line('free')).toBe('Free keeps 1 site. Pro keeps 5 sites: Pro is $19 a month.');
    expect(line('pro')).toBe('Pro keeps 5 sites. Agency keeps 25 sites: Agency is $99 a month.');
  });

  it('the tier changes no other line, and a page that names none keeps the general one', () => {
    for (const code of NOTICE_CODES.filter((c) => c !== 'upgrade_required')) {
      expect(noticeLine({ notice: code, next: NEXT }, ZONE, 'free')).toEqual(
        noticeLine({ notice: code, next: NEXT }, ZONE),
      );
    }
    expect(noticeLine({ notice: 'upgrade_required' }, ZONE)!.text).toBe('That needs a paid plan.');
  });

  it('the general line for a refused upgrade holds no price and no limit', () => {
    expect(NOTICE_LINES.upgrade_required(null)).not.toMatch(/\d/);
  });

  it('an unknown notice, or none, shows nothing', () => {
    expect(noticeLine({ notice: '<script>' }, ZONE, 'free')).toBeNull();
    expect(noticeLine({ notice: '<script>' }, ZONE)).toBeNull();
    expect(noticeLine({ notice: 'toString' }, ZONE)).toBeNull();
    expect(noticeLine({}, ZONE)).toBeNull();
  });
});
