/**
 * `fix.email_developer_requested` (CC-26b D9): a member sent a fix to a developer. The message is the
 * fix's packet as text (`packetPrompt`, the same text the fix page copies), and says who asked by the
 * site's host only: the member's name and address are not in it. The developer may not be a member,
 * so nothing links into the account; the packet's own lines (URLs among them) are text, escaped.
 */
import { bounded, oneLine } from '../escape';
import { SUBJECT_MAX } from '../headers';
import { layout } from '../layout';
import type { Template } from '../types';
import { hostText, para, pre, small } from './parts';

export interface FixToDeveloperInput {
  host: string;
  fixTitle: string;
  /** The packet as text: `packetPrompt(fix, fix.packet)` (lib/v2/view/segment/fixes.ts). */
  packet: string;
}

/** Longest fix title in the subject. */
export const TITLE_MAX = 120;
/** Longest packet sent; a packet is a few hundred characters, so this bounds only a hostile one. */
export const PACKET_MAX = 20_000;

const IGNORE =
  "If you weren't expecting this, you can ignore it; nothing was set up for this address.";

export const fixToDeveloper: Template<FixToDeveloperInput> = ({ host, fixTitle, packet }) => {
  const site = hostText(host);
  const title = oneLine(fixTitle, TITLE_MAX);
  const body = bounded(packet, PACKET_MAX);
  const cut = [...packet].length > PACKET_MAX ? ['', 'The packet was cut at its end here.'] : [];
  const lead = `Someone working on ${site} asked Crawlmouse to send you this fix.`;
  const subject = oneLine(`A fix for ${site}: ${title}`, SUBJECT_MAX);
  return {
    subject,
    text: [lead, '', body, ...cut, '', IGNORE].join('\n'),
    html: layout({
      title: subject,
      body: [para(lead), pre(body), ...cut.filter(Boolean).map(para), small(IGNORE)].join(''),
      why: `Sent once, because a member of the Crawlmouse account for ${site} entered this address.`,
    }),
  };
};
