/**
 * `check.notify_requested` (CC-22b D9): a visitor left an address on the crawl screen to be told when
 * the check ends. v1's rules for mail to an address a stranger typed (`inngest/notify.ts`): neutral
 * content, the site's host and the link to the check's own page, no grade or score (the result lives
 * behind the link), and the "didn't request this" line. The address is the recipient only.
 */
import { layout } from '../layout';
import { checkUrl } from '../links';
import type { Template } from '../types';
import { hostText, linkPara, para, small } from './parts';

export interface CheckNotifyInput {
  /** The checked site's host, as stored. */
  host: string;
  checkId: string;
  /** `finished` covers a partial check too: it has a result to open. */
  outcome: 'finished' | 'failed';
}

const IGNORE =
  "If you didn't request this email, you can safely ignore it: someone entered this address while checking a site at crawlmouse.com.";

export const checkNotify: Template<CheckNotifyInput> = ({ host, checkId, outcome }) => {
  const site = hostText(host);
  const link = checkUrl(checkId);
  const done = outcome === 'finished';
  const subject = done
    ? `Your Crawlmouse check of ${site} is ready`
    : `Your Crawlmouse check of ${site} has ended`;
  const lead = done
    ? `The check of ${site} you asked about has finished.`
    : `The check of ${site} you asked about did not complete. Open it to see what happened and run it again.`;
  const label = done ? 'Open the result' : 'See what happened';
  return {
    subject,
    text: [lead, '', `${label}: ${link}`, '', IGNORE].join('\n'),
    html: layout({
      title: subject,
      body: [para(lead), linkPara(link, label), small(IGNORE)].join(''),
      why: 'Sent once, because this address was left on a check at crawlmouse.com.',
    }),
  };
};
