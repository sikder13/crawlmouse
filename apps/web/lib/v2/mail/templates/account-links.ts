/**
 * The three account emails CC-27b emits (`email.requested` with a `tokenId`): the email change's
 * confirmation to the new address, its notice to the old one, and the deletion's confirmation with
 * its restore link. Each link is built from the raw token `issue_account_link` returned at send time
 * (questions Q10); the template refuses anything that is not a token's shape. No address is in the
 * copy. Account mail: no unsubscribe (D7).
 */
import { EMAIL_CHANGE_LINK_MINUTES, EMAIL_UNDO_DAYS } from '../../account/email-change-page';
import { RESTORE_DAYS } from '../../copy/deletion';
import { layout } from '../layout';
import { accountLinkUrl } from '../links';
import type { Template } from '../types';
import { linkPara, para, small } from './parts';

const WHY = 'Sent because of a request made on your Crawlmouse account.';

export const emailChangeConfirm: Template<{ token: string }> = ({ token }) => {
  const link = accountLinkUrl('email_change', token);
  const subject = 'Confirm your new Crawlmouse sign-in address';
  const lead =
    'Someone asked to make this address the sign-in address of a Crawlmouse account. Open the link to confirm it; nothing changes until you press Confirm on that page.';
  const life = `The link works once, for ${EMAIL_CHANGE_LINK_MINUTES} minutes.`;
  const ignore = "If you didn't ask for this, ignore this email.";
  return {
    subject,
    text: [lead, '', `Confirm the change: ${link}`, '', life, ignore].join('\n'),
    html: layout({
      title: subject,
      body: [para(lead), linkPara(link, 'Confirm the change'), small(`${life} ${ignore}`)].join(
        '',
      ),
      why: WHY,
    }),
  };
};

export const emailChangeNotice: Template<{ token: string }> = ({ token }) => {
  const link = accountLinkUrl('email_change_undo', token);
  const subject = 'Your Crawlmouse sign-in address is being changed';
  const lead =
    'Someone asked to move the sign-in of your Crawlmouse account to another address. If that was you, there is nothing to do.';
  const undo = `If it wasn't you, open this link: it stops the change, or, once it has happened, undoes it for ${EMAIL_UNDO_DAYS} days.`;
  return {
    subject,
    text: [lead, '', undo, `Stop or undo the change: ${link}`].join('\n'),
    html: layout({
      title: subject,
      body: [para(lead), para(undo), linkPara(link, 'Stop or undo the change')].join(''),
      why: WHY,
    }),
  };
};

export const accountDelete: Template<{ confirmToken: string; restoreToken: string }> = ({
  confirmToken,
  restoreToken,
}) => {
  const confirm = accountLinkUrl('delete_confirm', confirmToken);
  const restore = accountLinkUrl('delete_restore', restoreToken);
  const subject = 'Confirm deleting your Crawlmouse account';
  const lead =
    'Someone asked to delete your Crawlmouse account. Nothing is deleted until you open the first link and press the button on that page.';
  const after = `Once you confirm, signing in stops at once. For ${RESTORE_DAYS} days the second link restores the account; after that it is erased.`;
  const ignore = "If you didn't ask for this, ignore this email; your account stays as it is.";
  return {
    subject,
    text: [
      lead,
      '',
      `Confirm the deletion: ${confirm}`,
      '',
      after,
      `Restore the account: ${restore}`,
      '',
      ignore,
    ].join('\n'),
    html: layout({
      title: subject,
      body: [
        para(lead),
        linkPara(confirm, 'Confirm the deletion'),
        para(after),
        linkPara(restore, 'Restore the account'),
        small(ignore),
      ].join(''),
      why: WHY,
    }),
  };
};
