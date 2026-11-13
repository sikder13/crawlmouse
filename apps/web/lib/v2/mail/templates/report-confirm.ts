/**
 * The confirmation asked of a client's contact before any report is sent to them (CC-31 D8,
 * docs/specs/v2/31-agency.md §10): which agency asks, about which site, and the one link to the page
 * where they confirm. The reader has no account and needs none.
 *
 * The agency's name and the site's host are outside strings: each made one line, bounded and
 * escaped, the host shown as text and never linked. The link is built from the raw token minted at
 * send time; anything that is not a token's shape is refused. No address is in the copy.
 */
import { layout } from '../layout';
import { reportConfirmUrl } from '../links';
import type { Template } from '../types';
import { accountNameText, hostText, linkPara, para, small } from './parts';

export interface ReportConfirmInput {
  token: string;
  /** The agency's name as its owner wrote it, or null. */
  agencyName: string | null;
  /** The client site's host, as stored. */
  host: string;
}

export const reportConfirm: Template<ReportConfirmInput> = ({ token, agencyName, host }) => {
  const link = reportConfirmUrl(token);
  // The subject and the first words are ours, and within the mailer's 200 characters whatever
  // the host (`hostText` bounds it): a longer subject is refused after the link was issued. The
  // agency's name is text its owner typed, mailed to an address its owner chose: it is given after
  // them, in quotation marks, as a name.
  const subject = `An agency asks to send you reports about ${hostText(host)}`;
  const name = accountNameText(agencyName);
  const named = name === null ? '' : ` The agency’s account is called “${name}”.`;
  const lead = `${subject}.${named} Open the link and confirm on that page if you want them.`;
  const rule = 'No report is sent unless you confirm. You need no account.';
  const ignore = "If you weren't expecting this, you can safely ignore this email.";
  return {
    subject,
    text: [lead, '', `Confirm the reports: ${link}`, '', rule, ignore].join('\n'),
    html: layout({
      title: subject,
      body: [para(lead), linkPara(link, 'Confirm the reports'), small(`${rule} ${ignore}`)].join(
        '',
      ),
      why: 'Sent because an agency that uses Crawlmouse gave this address as a client’s contact.',
    }),
  };
};
