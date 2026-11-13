/**
 * The proof page's previews (CC-31 D6b): three stored documents and the view of each.
 *
 * These documents are stand-ins written here, in the open: the generator that makes a report's
 * document from a check's records is workstream B's and is not on this branch. Their grades, scores
 * and dates are the bad-site and clean-site fixtures' (checks c…0005 and c…0006 of
 * example-outfitter.com; check c…0065 of trailhead.example), written in the fixture account's zone;
 * the fix's two states are a stand-in, since no fixture holds a verified fix.
 */
import type { ReportDoc } from '../../../../lib/v2/reports/generate';
import { proofView, type ProofView } from '../../../../lib/v2/view/proof';

const HOME = 'https://crawlmouse.com/';

const COMPARE: ReportDoc = {
  title: 'Before and after',
  lines: ['example-outfitter.com', 'Checked Thu 29 Oct 08:42 and Fri 30 Oct 06:02'],
  sections: [
    {
      heading: 'Grades',
      blocks: [
        {
          type: 'pair',
          title: 'Technical SEO',
          before: {
            label: 'Before',
            date: 'Thu 29 Oct 08:42',
            value: 'B+ · 80 of 100',
            evidence: ['Internal linking, depth, anchors and structure, from the pages crawled.'],
          },
          after: {
            label: 'After',
            date: 'Fri 30 Oct 06:02',
            value: 'B · 79 of 100',
            evidence: ['Internal linking, depth, anchors and structure, from the pages crawled.'],
          },
        },
        {
          type: 'pair',
          title: 'AI readability',
          before: {
            label: 'Before',
            date: 'Thu 29 Oct 08:42',
            value: 'D · 41 of 100',
            evidence: ['Access: 12 of 40.'],
          },
          after: {
            label: 'After',
            date: 'Fri 30 Oct 06:02',
            value: 'F · 22 of 100',
            evidence: ['Access: 3 of 40.'],
          },
        },
      ],
    },
  ],
  notMeasured: ['JavaScript was not run: the check reads the HTML a crawler receives.'],
  footer: { text: 'Checked with Crawlmouse · Fri 30 Oct', href: HOME },
};

const FIX: ReportDoc = {
  title: 'Fix verified',
  lines: ['example-outfitter.com', 'Checked Thu 29 Oct 08:42 and Fri 30 Oct 06:02'],
  sections: [
    {
      heading: 'Remove the Claude-SearchBot block from robots.txt',
      blocks: [
        {
          type: 'pair',
          title: 'robots.txt',
          before: {
            label: 'Before',
            date: 'Thu 29 Oct 08:42',
            value: 'Open',
            evidence: ['User-agent: Claude-SearchBot', 'Disallow: /'],
          },
          after: {
            label: 'After',
            date: 'Fri 30 Oct 06:02',
            value: 'Verified',
            evidence: ['No group names Claude-SearchBot.'],
          },
        },
        {
          type: 'facts',
          rows: [
            { label: 'Where', value: '/robots.txt' },
            { label: 'Effect on the grades', value: 'AI readability +19, estimated' },
          ],
        },
      ],
    },
  ],
  notMeasured: [],
  footer: { text: 'Checked with Crawlmouse · Fri 30 Oct', href: HOME },
};

const BASELINE: ReportDoc = {
  title: 'Baseline',
  lines: ['trailhead.example', 'Checked Tue 27 Oct 11:31'],
  sections: [
    {
      heading: 'Grades',
      blocks: [
        {
          type: 'table',
          caption: 'Letter and score',
          columns: ['Grade', 'Letter', 'Score of 100'],
          rows: [
            ['Technical SEO', 'A', '94'],
            ['AI readability', 'A', '97'],
          ],
        },
        { type: 'text', text: 'Nothing found blocks this site from being crawled or read.' },
      ],
    },
  ],
  notMeasured: [
    'JavaScript was not run: the check reads the HTML a crawler receives.',
    'Pages behind a sign-in were not crawled.',
  ],
  footer: { text: 'Checked with Crawlmouse · Tue 27 Oct', href: HOME },
};

export const PROOF_PREVIEWS = {
  /** A compare of two checks: both grades moved. */
  '/v2-preview/screens/proof': COMPARE,
  /** One fix, open at the earlier check and verified at the later. */
  '/v2-preview/screens/proof/fix': FIX,
  /** One check with nothing blocking: what was checked, and what was not measured. */
  '/v2-preview/screens/proof/baseline': BASELINE,
} as const satisfies Record<string, ReportDoc>;

export type ProofPreview = keyof typeof PROOF_PREVIEWS;

export const proofPreview = (path: ProofPreview): ProofView => proofView(PROOF_PREVIEWS[path]);
