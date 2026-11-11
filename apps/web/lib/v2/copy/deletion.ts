/**
 * What the deletion's two link pages say (D4): `/account/delete`, which the confirmation link opens,
 * and `/account/restore`, which the restore link opens. The money sentences follow the published
 * refund policy (owner ruling Q7) and quote it from its one published source, the Terms
 * (`apps/web/app/terms/page.tsx`, "Billing"), and say no more than it does.
 */

/** The Terms' refund sentence, as the Terms page publishes it. */
export const REFUND_POLICY = 'We don’t refund partial periods except where the law requires it.';

/** The window a restore link has, in days (confirm_account_deletion's `purge_after`). */
export const RESTORE_DAYS = 7;

const MONEY_ENDS =
  'A plan, or a trial with a card, is set to end when its current period ends, and nothing more is charged. If that comes after the seven days, it is cancelled when the account is erased.';

export const DELETE_COPY = {
  title: 'Delete your account',
  lead: 'Pressing the button deletes these accounts and everything in them:',
  what: [
    'Signing in stops at once, on every device.',
    `For ${RESTORE_DAYS} days the restore link in the same email undoes it. After that the accounts, their sites, checks and reports, and your sign-in are erased.`,
    'A few things are kept: one-way fingerprints that stop a second free trial, any takedown request of yours that is still open, and public reports you published, which no longer name you.',
  ],
  /**
   * A plan the confirm sets to end (`active`, or `trialing` with a card): true of a trial, which has
   * paid for nothing yet, as of a paid period.
   */
  moneyEnds: MONEY_ENDS,
  /** The confirmation page's lines when it does not know the subscription's state. */
  money: [MONEY_ENDS, REFUND_POLICY],
  /**
   * A plan the confirm does not set to end, which the purge cancels at once (C3b): `past_due` and
   * `unpaid` (overdue) and `paused` (on hold), so the sentence names no failure a pause has not had.
   */
  moneyNotCollected:
    'A plan whose payments are overdue or on hold is not set to end when you confirm. It is cancelled when the account is erased, after the seven days.',
  button: 'Delete these accounts',
  /** The account named by its sign-in address has no site. */
  noSite: 'no site yet',
} as const;

/**
 * What happens to the money, by the subscription mirror's `status` (owner ruling Q7, C3b): the one
 * mapping every page that speaks of a deletion reads. `active` and `trialing` are set to end at the
 * confirm; `past_due`, `unpaid` and `paused` are not, and the purge cancels them at once. Each is
 * followed by the published refund policy. Null for any other state, or for no subscription.
 */
export function deletionMoney(status: string | null): readonly [string, string] | null {
  if (status === null || !Object.hasOwn(MONEY_BY_STATUS, status)) return null;
  return [MONEY_BY_STATUS[status]!, REFUND_POLICY];
}

const MONEY_BY_STATUS: Readonly<Record<string, string>> = {
  active: MONEY_ENDS,
  trialing: MONEY_ENDS,
  past_due: DELETE_COPY.moneyNotCollected,
  unpaid: DELETE_COPY.moneyNotCollected,
  paused: DELETE_COPY.moneyNotCollected,
};

export const RESTORE_COPY = {
  title: 'Restore your account',
  lead: 'Pressing the button undoes the deletion of these accounts:',
  until: (date: string) => `The restore link works until ${date}.`,
  money:
    'A plan the deletion set to end carries on as before. A plan that had already ended is not started again; you can choose one in Settings › Plan.',
  button: 'Restore these accounts',
} as const;

/** What either page says when it has no usable link, and after its button was pressed. */
export const LINK_STATES: Readonly<Record<string, { title: string; body: string }>> = {
  invalid_link: {
    title: 'This link no longer works',
    body: 'It has been used, it has expired, or a newer email replaced it. Use the link in the latest email.',
  },
  already_confirmed: {
    title: 'Your account is already deleted',
    body: 'An earlier link deleted every account you hold, this one with it. The restore link in that email undoes it.',
  },
  email_change_pending: {
    title: 'An email change is in progress',
    body: 'Finish or cancel the change of your sign-in address first, then press this link again.',
  },
  not_confirmed: {
    title: 'Nothing to restore yet',
    body: 'The deletion has not been confirmed, so the account is still there. You can ignore the email.',
  },
  window_closed: {
    title: 'The restore window has ended',
    body: `The ${RESTORE_DAYS} days have passed, so the account is being erased and cannot be restored.`,
  },
  others_seated: {
    title: 'Other people are on this account',
    body: 'An account with other members cannot be deleted. Remove them first, then ask for a new link from Settings.',
  },
  v1_subscription: {
    title: 'Your plan is still running',
    body: 'Cancel the plan from the billing portal first, then ask for a new link from Settings.',
  },
  deleted: {
    title: 'Your account is deleted',
    body: `Signing in has stopped. For ${RESTORE_DAYS} days the restore link in the same email undoes it.`,
  },
  restored: {
    title: 'Your account is back',
    body: 'Sign in again with your email address to use it.',
  },
};
