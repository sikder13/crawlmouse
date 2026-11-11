/**
 * What /settings and /settings/delete say when a form sends the reader back (CC-27b review, item 6):
 * `?saved=1` or `?email=sent` on Settings, `?sent=1` on the delete step, and `?error=<code>` on both,
 * with a sentence for each code the routes behind them answer (settings-notices.test.ts reads the
 * codes from the routes' sources). A code with no sentence here gets the generic one.
 */

export const SETTINGS_NOTICES = {
  saved: 'Saved.',
  emailSent:
    'We sent a confirmation link to the new address. The change takes effect when you open it, and the old address gets a notice with a link to undo it.',
  deleteSent:
    'The confirmation link is on its way to your sign-in address. Nothing is deleted until you confirm on the page it opens.',
  unknown:
    'That did not go through. Try again; if it keeps happening, write to support@crawlmouse.com.',
} as const;

export const REFUSAL_SENTENCES: Readonly<Record<string, string>> = {
  // Who may act
  auth_required: 'Your session has ended. Sign in again, then try once more.',
  no_account: 'This sign-in has no account to change.',
  account_ambiguous:
    'You sit on more than one account; open the one you mean from the dashboard first.',
  not_found: 'That is not part of this account.',
  role_refused: 'Only the account’s owner or an account manager can change these settings.',
  not_owner: 'Only the account’s owner can delete it.',
  email_change_owner_only: 'Only the account’s owner can change the sign-in address.',
  upgrade_required: 'Slack alerts need Pro or Agency.',
  // What was sent
  invalid: 'Something in the form was not accepted. Check it and save again.',
  method_not_allowed: 'That form could not be sent that way. Reload the page and try again.',
  invalid_email: 'That is not an email address we can send to.',
  same_address: 'That is already the sign-in address.',
  hostname_mismatch: 'The hostname you typed does not match. Type it exactly as shown.',
  // The state of the account
  rate_limited: 'Too many tries today. Try again tomorrow.',
  email_change_pending:
    'An email change is waiting on its confirmation link. Confirm it or let it expire, then try again.',
  deletion_pending:
    'The account’s deletion is under way, so the sign-in address cannot change. Use the restore link in the deletion email to stop it.',
  account_deleting: 'This account is being deleted, so it cannot be changed.',
  address_taken: 'That address already signs in to another account.',
  try_again: 'Something changed while that was saved. Try again.',
  auth_failed: 'The sign-in service did not answer. Try again in a few minutes.',
  // Seats are managed in a later step (CC-31), so the sentence does not send the reader to a page.
  others_seated:
    'Other people are seated on this account, so it cannot be deleted while they are. Write to support@crawlmouse.com to remove their seats.',
  // erase_person_refusals' code; deletion_refusal leaves it out today, since the confirm ends the plan.
  live_subscription:
    'The account’s subscription is still running. Confirming the deletion sets it to end.',
  v1_subscription:
    'A subscription from the earlier plan is still running. Cancel it in the billing portal first.',
  // An emailed link
  invalid_link: 'That link has been used, has expired, or was replaced by a newer one.',
  link_unusable: 'That link has been used, has expired, or was replaced by a newer one.',
  not_confirmed: 'That restore link belongs to a deletion that was never confirmed.',
  already_confirmed:
    'This deletion is already confirmed. The restore link in the deletion email undoes it for seven days.',
  window_closed: 'The seven days to restore the account have passed.',
};

export interface Notice {
  tone: 'ok' | 'error';
  text: string;
}

type Query = Readonly<Record<string, string | string[] | undefined>>;

/** The line a page shows for its query, or null. An error code is read ahead of a success line. */
export function settingsNotice(query: Query, page: 'settings' | 'delete'): Notice | null {
  const error = query.error;
  if (error !== undefined) {
    const known = typeof error === 'string' && Object.hasOwn(REFUSAL_SENTENCES, error);
    return { tone: 'error', text: known ? REFUSAL_SENTENCES[error]! : SETTINGS_NOTICES.unknown };
  }
  if (page === 'settings') {
    if (query.email === 'sent') return { tone: 'ok', text: SETTINGS_NOTICES.emailSent };
    if (query.saved === '1') return { tone: 'ok', text: SETTINGS_NOTICES.saved };
    return null;
  }
  return query.sent === '1' ? { tone: 'ok', text: SETTINGS_NOTICES.deleteSent } : null;
}
