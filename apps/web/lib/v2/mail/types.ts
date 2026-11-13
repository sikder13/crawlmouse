/**
 * The mailer's shared types (CC-28 D1, D2). Every v2 email is one of `MAIL_KINDS`; the list is the
 * `email_sends.kind` check, set by the last migration that rewrites it (CC-29 adds
 * `agency_plus_contact`; CC-33's `founder_event` and `founder_digest` are in 20261115000001's section
 * K), and send.test.ts's "the kinds" reads it from there.
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
  'founder_event',
  'founder_digest',
] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

/**
 * Account mail (D7): about the person's own account, so it carries no unsubscribe and a suppression
 * does not stop it. The others are what `email_kind_suppressible` in the migration answers true for.
 * CC-33's founder notices and digest are in this class too (questions Q1): the founder sender
 * (lib/v2/ops/founder.ts) mails them to FOUNDER_NOTIFY_TO and to no other address.
 */
export const ACCOUNT_KINDS: ReadonlySet<MailKind> = new Set<MailKind>([
  'trial_reminder',
  'email_change_confirm',
  'email_change_notice',
  'account_delete',
  'founder_event',
  'founder_digest',
]);

/**
 * Mail to our own inbox (CC-29: an Agency Plus request, to the sales inbox). Like account mail it
 * carries no unsubscribe and a suppression does not stop it: `email_kind_suppressible` answers false
 * for it, so a bounce recorded against that inbox cannot silence the requests sent to it.
 */
export const OWN_INBOX_KINDS: ReadonlySet<MailKind> = new Set<MailKind>(['agency_plus_contact']);

/** The kinds that carry List-Unsubscribe (D7), and what the link turns off. */
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
