/**
 * The proof page's previews (CC-31 D6b): three stored documents and the view of each.
 *
 * The comparison and the baseline are the generator's own documents (`compareDoc`, `baselineDoc`,
 * lib/v2/reports/generate-doc.ts), made here from the contract fixtures as `POST /api/reports`
 * makes them from a check's records: bad-site's checks c…0005 and c…0006 of example-outfitter.com,
 * and clean-site's check c…0065. A check read without its account writes its times in UTC.
 *
 * The fix's proof is a document written by hand, not one `fixProofDoc` made: no fixture holds a fix
 * a check verified, and that builder refuses any other. It shows the page's layout of a pair with
 * facts under it; its sentences and values are a stand-in.
 */
import { fixture } from '../../../../lib/v2/fixtures';
import type { ReportDoc } from '../../../../lib/v2/reports/generate';
import { baselineDoc, compareDoc } from '../../../../lib/v2/reports/generate-doc';
import { proofView, type ProofView } from '../../../../lib/v2/view/proof';

const HOME = 'https://crawlmouse.com/';

const BAD_FIFTH = 'c0000000-0000-4000-8000-000000000005';
const BAD_SIXTH = 'c0000000-0000-4000-8000-000000000006';
const CLEAN_CHECK = 'c0000000-0000-4000-8000-000000000065';

const compare = (): ReportDoc => {
  const dataset = fixture('bad-site');
  return compareDoc(
    { dataset, checkId: BAD_FIFTH },
    { dataset, checkId: BAD_SIXTH },
    { home: HOME },
  );
};

const baseline = (): ReportDoc =>
  baselineDoc({ dataset: fixture('clean-site'), checkId: CLEAN_CHECK }, { home: HOME });

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

export const PROOF_PREVIEWS = {
  /** A compare of two checks: both grades moved, and what the later check found changed. */
  '/v2-preview/screens/proof': compare(),
  /** One fix, open at the earlier check and verified at the later. */
  '/v2-preview/screens/proof/fix': FIX,
  /** One check of a site with nothing in a crawler's way. */
  '/v2-preview/screens/proof/baseline': baseline(),
} as const satisfies Record<string, ReportDoc>;

export type ProofPreview = keyof typeof PROOF_PREVIEWS;

export const proofPreview = (path: ProofPreview): ProofView => proofView(PROOF_PREVIEWS[path]);
