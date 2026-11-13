/**
 * A scheduled client report's mail (CC-31 D8, docs/specs/v2/31-agency.md §10), to a contact who
 * confirmed their address: the report's headline and the lines under it, the one link to the report,
 * the report's closing line, and the link that pauses the schedule.
 *
 * The headline, the lines and the closing line are the report document's own strings
 * (`ReportDoc.title`, `.lines` and `.footer.text`, lib/v2/reports/generate.ts), shown as given. This
 * template writes no sentence about what a check found.
 *
 * Every string from outside this file is made one line, bounded and escaped; the host is text, never
 * a link. The two links are built from tokens minted at send time, each refused unless it has its
 * token's shape. The pause link is the one the message's List-Unsubscribe header carries
 * (handlers.ts). No address is in the copy.
 */
import { oneLine } from '../escape';
import { layout } from '../layout';
import { reportPauseUrl, sharedReportUrl } from '../links';
import type { Template } from '../types';
import { accountNameText, hostText, linkPara, para, small, smallLink } from './parts';

/** Bounds, in code points, on the document's strings a message shows. */
export const REPORT_BOUNDS = { headline: 200, line: 300 } as const;

export interface ClientReportInput {
  /** The agency's name as its owner wrote it, or null. */
  agencyName: string | null;
  /** The client site's host, as stored. */
  host: string;
  /** The report document's title. */
  headline: string;
  /** The lines under the title, in the document's order. */
  lines: readonly string[];
  /** The document's closing line. */
  footer: string;
  shareToken: string;
  pauseToken: string;
}

const PAUSE_LABEL = 'Pause these reports';

export const clientReport: Template<ClientReportInput> = (input) => {
  const report = sharedReportUrl(input.shareToken);
  const pause = reportPauseUrl(input.pauseToken);
  const site = hostText(input.host);
  const agency = accountNameText(input.agencyName);
  const subject = agency === null ? `Report for ${site}` : `Report for ${site} from ${agency}`;
  const headline = oneLine(input.headline, REPORT_BOUNDS.headline);
  const lines = input.lines.map((line) => oneLine(line, REPORT_BOUNDS.line));
  const footer = oneLine(input.footer, REPORT_BOUNDS.line);
  return {
    subject,
    text: [
      headline,
      ...lines,
      '',
      `Open the report: ${report}`,
      '',
      footer,
      `${PAUSE_LABEL}: ${pause}`,
    ].join('\n'),
    html: layout({
      title: headline,
      body: [
        ...lines.map(para),
        linkPara(report, 'Open the report'),
        small(footer),
        smallLink(pause, PAUSE_LABEL),
      ].join(''),
      why:
        agency === null
          ? `Sent to the address confirmed for reports about ${site}.`
          : `Sent by ${agency} to the address confirmed for reports about ${site}.`,
    }),
  };
};
