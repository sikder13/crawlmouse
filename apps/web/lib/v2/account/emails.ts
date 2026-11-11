/**
 * The three emails CC-27b needs, emitted as `email.requested` for CC-28's mailer (D9); nothing is
 * sent here. The event names only the account and the link rows: no address and no raw token goes
 * into Inngest's event history (CC-26b ruling Q8). The mailer reads each link once through
 * `take_account_link`, which also says where it goes.
 *
 * - `email_change_confirm`: the confirmation link, to the new address.
 * - `email_change_notice`: the old address is told, with the "this wasn't me" link.
 * - `account_delete`: the confirmation link and the restore link, to the sign-in address.
 */
export type AccountEmailTemplate =
  | 'email_change_confirm'
  | 'email_change_notice'
  | 'account_delete';

export interface AccountEmailEvent {
  /** Inngest's idempotency key. The token ids are in it, so a second request is not dropped as a duplicate. */
  id: string;
  name: 'email.requested';
  data: { accountId: string; template: AccountEmailTemplate; tokenIds: string[] };
}

export function accountEmail(
  accountId: string,
  template: AccountEmailTemplate,
  tokenIds: readonly string[],
): AccountEmailEvent {
  if (tokenIds.length === 0) throw new Error(`${template}: an email with no link`);
  return {
    id: `email.requested:${template}:${accountId}:${tokenIds.join(',')}`,
    name: 'email.requested',
    data: { accountId, template, tokenIds: [...tokenIds] },
  };
}

/** Where the events go: `inngest.send` in production, a recorder in tests. */
export type SendEmails = (events: readonly AccountEmailEvent[]) => Promise<void>;
