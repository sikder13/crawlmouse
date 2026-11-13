/**
 * A seat's invitation (CC-31 D3, docs/specs/v2/31-agency.md §6): which account invites the reader and
 * as what, the one link to the invitation's page, how long the link works, and that ignoring it
 * changes nothing. The account and the role are worded as the invitation's page words them
 * (`INVITE_COPY`), so the mail and the page it opens agree.
 *
 * The account's name is a string its owner typed: made one line, bounded and escaped, and left out
 * when the account has none. The link is built from the raw token `issue_seat_invite` returned at
 * send time; anything that is not a token's shape is refused. No address is in the copy.
 */
import { INVITE_LINK_DAYS, type InvitedRole } from '../../agency/seats';
import { INVITE_COPY } from '../../copy/seats';
import { layout } from '../layout';
import { seatInviteUrl } from '../links';
import type { Template } from '../types';
import { accountNameText, linkPara, para, small } from './parts';

export interface SeatInviteInput {
  token: string;
  /** The inviting account's name as its owner wrote it, or null. */
  accountName: string | null;
  role: InvitedRole;
}

export const seatInvite: Template<SeatInviteInput> = ({ token, accountName, role }) => {
  const link = seatInviteUrl(token);
  // The subject and the first words are ours. The account's name is text its owner typed, mailed
  // to an address its owner chose: it is given after them, in quotation marks, as a name.
  const subject = `${INVITE_COPY.title} ${INVITE_COPY.to(null)}`;
  const name = accountNameText(accountName);
  const named = name === null ? '' : ` Its owner calls it “${name}”.`;
  const lead = `${subject}.${named} ${INVITE_COPY.role[role]}`;
  const how =
    'The page asks you to sign in with the address this email was sent to, and then to accept.';
  const life = `The link works for ${INVITE_LINK_DAYS} days.`;
  const ignore =
    "If you weren't expecting this, you can safely ignore this email: you join the account only when you accept on that page.";
  return {
    subject,
    text: [lead, '', `Open the invitation: ${link}`, '', how, life, ignore].join('\n'),
    html: layout({
      title: subject,
      body: [
        para(lead),
        linkPara(link, 'Open the invitation'),
        para(how),
        small(`${life} ${ignore}`),
      ].join(''),
      why: 'Sent because the owner of a Crawlmouse account invited this address.',
    }),
  };
};
