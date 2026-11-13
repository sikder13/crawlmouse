/**
 * The mailer's shared types (CC-28 D1, D2). Every v2 email is one of `MAIL_KINDS`; the list is the
 * `email_sends.kind` check as migration 20261114000001 leaves it (CC-29 adds `agency_plus_contact`)
 * with the kinds migration 20261114000002's section C adds after it. send.test.ts ("the kinds")
 * reads both files, and __tests__/v2-031-m-mail-kinds.test.ts reads the list from a migrated
 * database.
 */

export const MAIL_KINDS = [
  'check_notify',
  'fix_to_developer',
  'trial_reminder',
  'email_change_confirm',
  'email_change_notice',
  'account_delete',
  'alert',
  'weekly_summary',
  'agency_plus_contact',
  // CC-31: a seat's invitation, and the two mails of a client report schedule.
  'seat_invite',
  'report_confirm',
  'client_report',
] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

/**
 * Account mail (D7): about the person's own account, so it carries no unsubscribe and a suppression
 * does not stop it. The others are what `email_kind_suppressible` in the migration answers true for.
 * CC-31 adds two that a suppression does not stop either: a seat's invitation, which is the one way
 * into the seat, and the confirmation asked of a client's contact before any report is sent to it.
 */
export const ACCOUNT_KINDS: ReadonlySet<MailKind> = new Set<MailKind>([
  'trial_reminder',
  'email_change_confirm',
  'email_change_notice',
  'account_delete',
  'seat_invite',
  'report_confirm',
]);

/**
 * Mail to our own inbox (CC-29: an Agency Plus request, to the sales inbox). Like account mail it
 * carries no unsubscribe and a suppression does not stop it: `email_kind_suppressible` answers false
 * for it, so a bounce recorded against that inbox cannot silence the requests sent to it.
 */
export const OWN_INBOX_KINDS: ReadonlySet<MailKind> = new Set<MailKind>(['agency_plus_contact']);

/**
 * The kinds whose List-Unsubscribe is a seat's signed link (D7), and what the link turns off. A
 * client report carries List-Unsubscribe as well: its target is the schedule's pause link, which the
 * report's handler builds (handlers.ts).
 */
export const UNSUBSCRIBE_KIND = {
  alert: 'alerts',
  weekly_summary: 'summary',
} as const satisfies Partial<Record<MailKind, string>>;
export type UnsubscribeKind = (typeof UNSUBSCRIBE_KIND)[keyof typeof UNSUBSCRIBE_KIND];

/** What a template renders: a pure function of its input (D2). */
export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

export type Template<I> = (input: I) => RenderedMail;

/** A message as the transport sends it: headers already validated (headers.ts). */
export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, each name and value validated. */
  headers: Readonly<Record<string, string>>;
  /** The ledger key, sent to the provider as its idempotency key. */
  idempotencyKey: string;
}
