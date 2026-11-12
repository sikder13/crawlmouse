/**
 * The three emails CC-27b needs, emitted as `email.requested` for CC-28's mailer (D9); nothing is
 * sent here. The event names the account and one link row: no address and no token goes into
 * Inngest's event history (CC-26b ruling Q8), and the row holds no token until the mailer calls
 * `issue_account_link`, which mints it, stores its hash, and says where it goes (owner ruling Q5).
 *
 * - `email_change_confirm`: the confirmation link, to the new address.
 * - `email_change_notice`: the old address is told, with the "this wasn't me" link.
 * - `account_delete`: the confirmation link, and the restore link paired with it, to the sign-in
 *   address; `tokenId` is the confirmation link's row.
 */
export type AccountEmailTemplate =
  | 'email_change_confirm'
  | 'email_change_notice'
  | 'account_delete';

export interface AccountEmailEvent {
  /** Inngest's idempotency key. The token id is in it, so a second request is not dropped as a duplicate. */
  id: string;
  name: 'email.requested';
  data: { accountId: string; template: AccountEmailTemplate; tokenId: string };
}

export function accountEmail(
  accountId: string,
  template: AccountEmailTemplate,
  tokenId: string,
): AccountEmailEvent {
  return {
    id: `email.requested:${template}:${accountId}:${tokenId}`,
    name: 'email.requested',
    data: { accountId, template, tokenId },
  };
}

/** Where the events go: `inngest.send` in production, a recorder in tests. */
export type SendEmails = (events: readonly AccountEmailEvent[]) => Promise<void>;
