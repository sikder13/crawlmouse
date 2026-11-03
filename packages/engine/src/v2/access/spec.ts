/**
 * Renders docs/specs/v2/15-access-detectors.md. The rules come from the constants they name (matrix.ts,
 * edge.ts, record.ts, thresholds.ts, declarations.ts), the field tables are typed `Record`s over the
 * record types, and the fixture table is read from the fixtures' own `provenance`. spec.test.ts fails
 * when the file differs from this render.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { UNMEASURED_VERDICTS, type Verdict } from '@crawlmouse/types/v2';
import { LIFECYCLE } from '../diff/lifecycle.js';
import { code, pct, table } from '../detectors/spec.js';
import { DECLARATIONS, SIGNAL_TABLE } from './declarations.js';
import { EDGE_JUDGED } from './edge.js';
import { BLOCKED, SERVED, TIE_ORDER, UNCERTAIN } from './matrix.js';
import { ACCESS_KEY_PREFIX, RECOMMENDATION_CLASS, SIGNATURE_HEADERS } from './record.js';
import { EDGE_CLEAR_SHARE, EDGE_DETECT_SHARE, MIN_SCORED_MEASURED } from './thresholds.js';
import {
  ACCESS_INDETERMINATE_REASONS,
  type AccessDetection,
  type AccessFixType,
  type AccessIndeterminateReason,
  type CrawlerAccess,
} from './types.js';

export const SPEC_URL = new URL(
  '../../../../../docs/specs/v2/15-access-detectors.md',
  import.meta.url,
);
const FIXTURES = new URL('../../../fixtures/v2/access/', import.meta.url);

const list = (vs: readonly string[]) => vs.map(code).join(', ');

interface Rule {
  subject: string;
  detected: string;
  clear: string;
  indeterminate: string;
  measured: string;
  affected: string;
}

const RULES: Readonly<Record<AccessFixType, Rule>> = {
  edge_rule_blocks_crawler: {
    subject: 'a crawler the worker requests as',
    detected: `${code('blocked_by_ua_rule')} on ${pct(EDGE_DETECT_SHARE)} or more of the pages judged`,
    clear: `served (${list(SERVED)}) on ${pct(EDGE_CLEAR_SHARE)} or more of the pages judged`,
    indeterminate: `between the two; no page judged (see the reasons below)`,
    measured: `the share of the pages judged that are ${code('blocked_by_ua_rule')}`,
    affected: 'the blocked pages; when indeterminate, the pages not served',
  },
  robots_txt_blocks_crawler: {
    subject: 'any registry crawler',
    detected: `robots.txt disallows it on one or more of the pages its rules were read for: intent ${code('respected')}`,
    clear: 'robots.txt allows it on each page its rules were read for',
    indeterminate: `no page's rules were read for it (${code('robots_not_read')})`,
    measured: 'the share of those pages robots.txt disallows it on',
    affected: 'the disallowed pages',
  },
};

const REASONS: Readonly<Record<AccessIndeterminateReason, string>> = {
  not_measured:
    'edge: no page where the edge answered the crawler (only not measured, rate limited, paid or redirected cells)',
  edge_blocks_automation:
    'edge: the edge refused or challenged the untagged browser control too, so it treats all automation that way; the crawler was not requested',
  robots_disallows:
    'edge: robots.txt disallows the crawler wherever it was judged, so the edge was not tested',
  challenge_real_crawler_may_pass:
    'edge: neither threshold met, and challenges outnumber or equal unverified refusals: the real crawler, from its own addresses, may pass a challenge',
  refusal_unverified:
    'edge: neither threshold met, and unverified refusals outnumber challenges: the tagged Googlebot canary was refused too, so IP verification is not ruled out',
  hysteresis_band: 'edge: neither threshold met, with no challenge and no unverified refusal',
  robots_not_read: "robots: no page's robots.txt rules were read for the crawler",
};

const MATRIX_FIELDS: Readonly<Record<keyof CrawlerAccess, string>> = {
  ua: 'The registry token.',
  group: "The registry's group.",
  scored: "The registry's `scored`.",
  verdict: 'The site verdict (below).',
  evidence_class: '`declared` when every deciding cell rests on robots.txt, otherwise `simulated`.',
  status:
    'The status most deciding cells answered with, the lower on a tie; null for a declared verdict.',
  pages_measured: 'Cells with a measured verdict.',
  cause: 'The cause the deciding cells name, when they all name the same one (none counts as one).',
  confidence: 'Below.',
  by_template:
    'The same rules applied to each template’s cells; a URL that was not crawled has no template.',
  counts:
    'Engine only: cells per verdict, measured or not, so the extent ("blocked on 18 of 20") is kept.',
  supporting: 'Engine only: the deciding cells’ worker rows and pages.',
  intent: 'Engine only: `respected` when the site verdict is a robots.txt disallow.',
};

const DETECTION_FIELDS: Readonly<Record<keyof AccessDetection, string>> = {
  type: 'The fix type.',
  fingerprint:
    'The first 16 hex characters of the SHA-256 of `key` (`fingerprintOf`, shared with CC-16).',
  key: 'The prefix, a colon, and the crawler’s token in lower case.',
  crawler: 'The registry token.',
  group: "The registry's group.",
  scored: "The registry's `scored`.",
  state: '`detected`, `not_detected` or `indeterminate`.',
  reason: 'Set exactly when indeterminate.',
  measured: 'The value measured (per fix type, above); null when nothing was judged.',
  recommendation_class: 'Per fix type (above).',
  confidence: 'Below.',
  intent: '`respected` on a detected robots.txt record; null otherwise.',
  opens_fix: 'Detected and not respected intent. Engine only.',
  affected_urls: 'The pages the problem holds on (per fix type, above).',
  evidence:
    'The worker rows behind the record, their pages, the causes they name and the signatures their headers show.',
};

/**
 * The fields each module reads by name, pinned to its source by spec.test.ts. cells.ts reads the input
 * (an AccessTest, a page, a robots.txt reading); the others read the cells it makes.
 */
export const INPUTS_READ = {
  cells: [
    'id',
    'ua',
    'page_url',
    'template_key',
    'verdict',
    'cause',
    'raw_status',
    'evidence_class',
    'headers',
    'url',
    'robots_search',
  ],
  matrix: ['id', 'page_url', 'template_key', 'verdict', 'cause', 'status', 'evidence_class'],
  edge: ['verdict'],
  robots: ['verdict'],
  record: ['id', 'page_url', 'cause', 'headers'],
} as const;

const verdicts = (vs: readonly Verdict[]) => list(vs);

function fixtures(): string[][] {
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const { provenance } = JSON.parse(readFileSync(new URL(f, FIXTURES), 'utf8')) as {
        provenance: string;
      };
      return [code(f), provenance];
    });
}

export function renderAccessSpec(): string {
  const types = Object.keys(RULES) as AccessFixType[];
  return `# 15 — Crawler-access detectors

> Generated by \`packages/engine/src/v2/access/spec.ts\`; do not edit by hand. Regenerate with
> \`pnpm --filter @crawlmouse/engine exec tsx src/v2/access/write-spec.ts\`.

\`detectAccess\` is a pure function of one check (\`AccessInput\`): the rows of its access batches, the
crawled pages' robots.txt readings for the search engines (\`robots_search\`), and the URLs robots.txt kept
our crawler from (\`disallowed\`). It returns the crawler matrix, whether the access score is withheld, and one
record per crawler for each access fix type, sorted by fix type and then key. CC-17 turns a record into the
diff's outcome. The tests that pin each rule below:
\`pnpm --filter @crawlmouse/engine exec vitest run src/v2/access\`.

## What the worker decides, and where the engine takes over

The crawl worker (CC-12, \`packages/worker/src/verdict/table.ts\`, spec 12) decides each crawler's verdict
and cause on each sampled page, and the engine does not decide them again. In the worker's table a robots.txt
disallow is decided before any request, and a refusal, a block or a challenge only after the untagged browser
control was served on that page; a refusal is \`blocked_by_ua_rule\` only when the tagged Googlebot canary was
served on the same page. The engine reads each crawler row as the worker wrote it and decides what the rows
add up to.

## Inputs

\`cells.ts\` reads the input: from each worker row (\`AccessTest\`) with a crawler \`ua\`, its
\`id\`, \`ua\`, \`page_url\`, \`template_key\`, \`verdict\`, \`cause\`, \`raw_status\` (as the cell's \`status\`),
\`evidence_class\` and \`headers\`; from each crawled page its \`url\`, \`template_key\` and \`robots_search\`; from
each disallowed URL its \`url\` and \`robots_search\`. The control's and the canary's rows (\`ua\` null) are not
read. A row for a token the registry does not mark testable, two rows for one crawler on one page, a sampled
page without a row for a testable crawler, or a URL listed twice is refused. The other modules read the cells
(pinned to the source by \`spec.test.ts\`):

${table(
  ['Module', 'Reads'],
  Object.entries(INPUTS_READ).map(([m, fields]) => [code(`${m}.ts`), list(fields)]),
)}

## The matrix

A crawler's cells are its worker rows, one per sampled page, or, for a crawler the registry does not mark
testable, robots.txt's reading for it on each crawled or disallowed URL. Its site verdict:

1. No measured cell (not ${verdicts(UNMEASURED_VERDICTS as Verdict[])}): \`edge_blocks_automation\` when a
   cell carries it, otherwise \`not_measured\`.
2. Otherwise the verdict most measured cells carry. A tie goes to the earlier in this order, the weaker claim
   first: ${verdicts(TIE_ORDER)}.
3. A block (${verdicts(BLOCKED)}) is never the site verdict when a page served the crawler
   (${verdicts(SERVED)}): then it is rule 2 over the served cells.

The cells that carry the site verdict are its deciding cells.

${table(
  ['Field', 'Meaning'],
  (Object.keys(MATRIX_FIELDS) as (keyof CrawlerAccess)[]).map((f) => [code(f), MATRIX_FIELDS[f]]),
)}

Confidence: \`inconclusive\` for an unmeasured verdict; \`likely\` for ${verdicts(UNCERTAIN)}, whose real
crawler may get something else; otherwise \`confirmed\` when every measured cell carries the site verdict and
\`likely\` when some do not.

The access score is withheld when fewer than ${MIN_SCORED_MEASURED} scored crawlers have a measured site
verdict (\`scoredCrawlersMeasured\`, the contract's; FACTS I4). The contract counts \`challenged_ua\` and
\`refused_unverified\` as measured. \`text_share\` is not set here: it needs the rendered words (CC-14).

## Detectors

${table(
  [
    'Fix type',
    'Key',
    'Subject',
    'Detected',
    'Not detected',
    'Indeterminate',
    'Measured',
    'Affected',
    'Class',
  ],
  types.map((t) => {
    const r = RULES[t];
    return [
      code(t),
      code(`${ACCESS_KEY_PREFIX[t]}:`),
      r.subject,
      r.detected,
      r.clear,
      r.indeterminate,
      r.measured,
      r.affected,
      code(RECOMMENDATION_CLASS[t]),
    ];
  }),
)}

**Edge.** The pages judged are those where the edge answered the crawler: ${verdicts(EDGE_JUDGED)}. Only
\`blocked_by_ua_rule\` counts as blocked. A record names the edge, never robots.txt: a page robots.txt
disallows is not one the edge was tested on, and a row naming robots.txt as the cause of any other verdict is
refused as input. Confidence: \`confirmed\` when detected on every page judged or clear on every page judged,
\`likely\` otherwise, \`inconclusive\` when indeterminate.

**Robots.** A robots.txt disallow is the site's stated intent: until the site can state its own policy per
crawler, each one is \`respected\`. The record is detected, the fact the screen states, but it does not open a
fix on its own (\`opens_fix\` false) and does not count against the site. A worker row other than
\`not_measured\` shows robots.txt was read for the crawler on that page and allowed it, since the worker decides
a disallow first; a \`not_measured\` row may come before robots.txt was read, so it counts neither way.
Confidence: \`confirmed\` when decided, \`inconclusive\` otherwise.

### Indeterminate reasons

${table(
  ['Reason', 'Meaning'],
  ACCESS_INDETERMINATE_REASONS.map((r) => [code(r), REASONS[r]]),
)}

What the diff does with an indeterminate record, by the fix's status before the check
(\`LIFECYCLE.indeterminate\`):

${table(
  ['Fix before', 'Action'],
  Object.entries(LIFECYCLE.indeterminate).map(([before, action]) => [code(before), code(action)]),
)}

### Records

${table(
  ['Field', 'Meaning'],
  (Object.keys(DETECTION_FIELDS) as (keyof AccessDetection)[]).map((f) => [
    code(f),
    DETECTION_FIELDS[f],
  ]),
)}

Signatures quote these response headers, as recorded by the worker:

${table(
  ['Header', 'Quoted as'],
  Object.entries(SIGNATURE_HEADERS).map(([h, how]) => [
    code(h),
    how === 'value' ? `${code(`${h}: <value>`)}` : `${code(h)} (present)`,
  ]),
)}

## Thresholds

${table(
  ['Constant', 'Value', 'Used by'],
  [
    ['EDGE_DETECT_SHARE', pct(EDGE_DETECT_SHARE), 'edge_rule_blocks_crawler'],
    ['EDGE_CLEAR_SHARE', pct(EDGE_CLEAR_SHARE), 'edge_rule_blocks_crawler'],
    ['MIN_SCORED_MEASURED', String(MIN_SCORED_MEASURED), 'withholding the access score'],
  ].map(([c, v, u]) => [code(c!), v!, u!]),
)}

## Signals

Only the signals marked below count toward the AI readability grade. The others carry no weight, and no fix
type exists for them (\`FixTypeSchema\`), so none can be reported as a defect.

${table(
  ['Signal', 'Counts toward grade', 'Recommendation class'],
  Object.entries(SIGNAL_TABLE).map(([s, v]) => [
    code(s),
    v.counts_toward_grade ? 'yes' : 'no',
    code(v.recommendation_class),
  ]),
)}

\`declarationSignal\` judges what one GET of a declaration's path answered: 200 with a body of an expected media
type is \`detected\`; 404 or 410, an empty body or another media type is \`not_detected\`; no answer, no request
or another status is \`indeterminate\`. The worker does not request these paths yet.

${table(
  ['Signal', 'Path', 'Media types'],
  Object.entries(DECLARATIONS).map(([s, d]) => [code(s), code(d.path), list(d.media_types)]),
)}

## Fixtures

The JSON fixtures in \`packages/engine/fixtures/v2/access/\`, each with its provenance as the file states it.
The worker-run ones are written by \`generate.ts\` there.

${table(['File', 'Provenance'], fixtures())}
`;
}
