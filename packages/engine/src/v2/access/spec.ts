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
import { CAUSES, EVIDENCE } from './cells.js';
import { TIE_ORDER } from './matrix.js';
import { ACCESS_KEY_PREFIX, RECOMMENDATION_CLASS, SIGNATURE_HEADERS } from './record.js';
import {
  EDGE_CLEAR_SHARE,
  EDGE_DETECT_SHARE,
  EDGE_MIN_ANSWERED,
  MIN_SCORED_MEASURED,
  SITE_MAJORITY_SHARE,
} from './thresholds.js';
import {
  ACCESS_INDETERMINATE_REASONS,
  type AccessDetection,
  type AccessFixType,
  type AccessIndeterminateReason,
  type CrawlerAccess,
} from './types.js';
import { EDGE_ANSWERED, OTHER_ANSWERS, SERVED, UNCERTAIN } from './verdicts.js';

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
    detected: `${EDGE_MIN_ANSWERED} pages judged or more; ${code('blocked_by_ua_rule')} on ${pct(EDGE_DETECT_SHARE)} or more of them, and on more pages than ${list(UNCERTAIN)} together (\`uaBlockHolds\`)`,
    clear: `${EDGE_MIN_ANSWERED} pages judged or more, served (${list(SERVED)}) on ${pct(EDGE_CLEAR_SHARE)} or more of them`,
    indeterminate: `fewer than ${EDGE_MIN_ANSWERED} pages judged (${code('insufficient_sample')}); neither detected nor clear; no page judged (the reasons below)`,
    measured: `the share of the pages judged that are ${code('blocked_by_ua_rule')}`,
    affected: 'the blocked pages, when detected',
  },
  robots_txt_blocks_crawler: {
    subject: 'any registry crawler',
    detected: `robots.txt disallows it on one or more of the pages its rules were read for: intent ${code('respected')}`,
    clear: 'robots.txt allows it on each of those pages',
    indeterminate: `no page's rules were read for it (${code('robots_not_read')})`,
    measured: 'the share of those pages robots.txt disallows it on',
    affected: 'the disallowed pages, when detected',
  },
};

const REASONS: Readonly<Record<AccessIndeterminateReason, string>> = {
  not_measured:
    'edge: no page where the crawler’s own request got an answer, and none of the two below',
  edge_blocks_automation:
    'edge: the edge refused or challenged the untagged browser control too, so it treats all automation that way; the crawler was not requested',
  robots_disallows:
    'edge: no page where the crawler’s own request got an answer, and robots.txt disallows it on one or more pages, so the edge was not tested there',
  challenge_real_crawler_may_pass: `edge: neither detected nor clear; challenges and unverified refusals together are as many as the blocks and as the other answers (${list(OTHER_ANSWERS)}) or more, and challenges are as many as unverified refusals or more: the real crawler, from its own addresses, may pass a challenge`,
  refusal_unverified:
    'edge: as the reason above, but unverified refusals outnumber challenges: the tagged Googlebot canary was not served on those pages, so IP verification is not ruled out',
  edge_answered_otherwise: `edge: neither detected nor clear; the other answers (${list(OTHER_ANSWERS)}) are as many as the blocks or more, and outnumber the challenges and unverified refusals together`,
  insufficient_sample: `edge: fewer than ${EDGE_MIN_ANSWERED} pages where the crawler's own request got an answer; the evidence is those pages' rows`,
  hysteresis_band:
    'edge: neither detected nor clear; the blocks outnumber the challenges and unverified refusals together, and the other answers together',
  robots_not_read: "robots: no page's robots.txt rules were read for the crawler",
};

const MATRIX_FIELDS: Readonly<Record<keyof CrawlerAccess, string>> = {
  ua: 'The registry token.',
  group: "The registry's group.",
  scored: "The registry's `scored`.",
  verdict: 'The site verdict (below).',
  evidence_class:
    '`declared` when every deciding cell rests on robots.txt, otherwise `simulated`; with no cell, `declared` for a search engine.',
  status:
    'The status the crawler’s own request got on most deciding cells, the lower on a tie; a declared cell’s status is the robots.txt read’s and is not counted.',
  pages_measured: 'Cells with a measured verdict.',
  cause: 'The cause the deciding cells name, when they all name the same one (none counts as one).',
  confidence: 'Below.',
  by_template: 'The same rules applied to each template’s cells.',
  counts:
    'Engine only: cells per verdict, measured or not, so the extent ("blocked on 18 of 20") is kept.',
  supporting: 'Engine only: the deciding cells’ worker rows and pages.',
  intent: 'Engine only: `respected` when the site verdict is a robots.txt disallow.',
  extent:
    'Engine only: the counts the verdict was decided on, shown whatever it is: robots.txt disallows of the pages read; user-agent blocks and serves of the pages our own requests got an answer on (none for a search engine).',
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
  extent:
    '`measured` as counts, `matching` of `of` ("19 of 20 pages"); null when nothing was judged.',
  recommendation_class: 'Per fix type (above).',
  confidence: 'Below.',
  intent: '`respected` on a detected robots.txt record; null otherwise.',
  opens_fix: 'Detected and not respected intent. Engine only.',
  affected_urls:
    'The pages the problem holds on (per fix type, above); empty unless detected, which `record` enforces.',
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
  verdicts: ['verdict'],
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

\`detectAccess\` is a pure function of one check (\`AccessInput\`): the rows of its access batches and the
crawled pages' robots.txt readings for the search engines (\`robots_search\`). It returns the crawler matrix, whether the access score is withheld, and one
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
\`evidence_class\` and \`headers\`; from each crawled page its \`url\`, \`template_key\` and \`robots_search\`. URLs
robots.txt kept our crawler from are not read, so every crawler is judged on pages our crawler fetched and one
wildcard rule reads the same for each. The control's and the canary's rows (\`ua\` null) are not read.

Refused as input: a row for a token the registry does not mark testable; two rows for one crawler on one page;
a sampled page without a row for a testable crawler; a page listed twice; a robots.txt reading for a token that
is not a search engine in the registry; a registry entry that is neither testable nor a search engine; and a
row whose cause or evidence class the worker's table never gives its verdict:

${table(
  ['Verdict', 'Causes', 'Evidence class'],
  (Object.keys(CAUSES) as Verdict[]).map((v) => [
    code(v),
    CAUSES[v].map((c) => (c === null ? 'none' : code(c))).join(', '),
    list(EVIDENCE[v]),
  ]),
)}

The other modules read the cells (pinned to the source by \`spec.test.ts\`):

${table(
  ['Module', 'Reads'],
  Object.entries(INPUTS_READ).map(([m, fields]) => [code(`${m}.ts`), list(fields)]),
)}

## The matrix

A crawler's cells are its worker rows, one per sampled page, or, for a search engine, robots.txt's reading for
it on each crawled page. Its site verdict:

1. No measured cell (not ${verdicts(UNMEASURED_VERDICTS as Verdict[])}): \`edge_blocks_automation\` when a
   cell carries it, otherwise \`not_measured\`.
2. \`disallowed_by_robots\` when robots.txt disallows the crawler on ${pct(SITE_MAJORITY_SHARE)} or more of the
   pages whose rules were read for it (every cell but \`not_measured\`).
3. Otherwise the pages robots.txt allowed decide, judged on those the site answered the crawler on
   (${verdicts(EDGE_ANSWERED)}); with none, rule 1. An allow when served (${verdicts(SERVED)}) on
   ${pct(SITE_MAJORITY_SHARE)} or more of them: the more common of the two.
4. Otherwise \`blocked_by_ua_rule\` when the user-agent blocks hold (\`uaBlockHolds\`: ${pct(EDGE_DETECT_SHARE)} or more
   of those pages, and more than ${verdicts(UNCERTAIN)} together).
5. Otherwise the verdict most of the remaining answered pages carry. A tie goes to the earlier in this order, the
   weaker claim first: ${verdicts(TIE_ORDER)}.

So each of rules 2 to 4 needs at least half of the pages that decide it, and a crawler served on exactly half
the answered pages and blocked on the other half is allowed: the weaker claim, as in rule 5 (its edge record is
still detected). \`extent\` keeps the counts whatever the verdict. A \`disallowed_by_robots\` verdict comes with a
detected robots.txt record, and \`blocked_by_ua_rule\` with an edge record detected or \`insufficient_sample\`.
The site verdict has no minimum number of pages: one answered page decides it, and counts as measured for
withholding, while the edge record on that page is \`insufficient_sample\`; \`pages_measured\` and \`extent\` show
how few pages it rests on. The contract has no verdict for a crawler served on some pages and blocked on others:
such a crawler takes the verdict the rules above give, which with less than half for each is rule 5's, and its
counts are in \`extent\`.

The cells that carry the site verdict are its deciding cells.

${table(
  ['Field', 'Meaning'],
  (Object.keys(MATRIX_FIELDS) as (keyof CrawlerAccess)[]).map((f) => [code(f), MATRIX_FIELDS[f]]),
)}

Confidence: \`inconclusive\` for an unmeasured verdict. \`confirmed\` only for a declared verdict that every cell
carries, robots.txt read the same on every page. Otherwise \`likely\`: our requests do not come from the
operator's addresses and carry our tag, so a verified-bot allow rule could pass the real crawler where we were
refused, and a rule matching the exact user agent or the operator's addresses could refuse it where we were
served.

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

**Edge.** The pages judged are those where the crawler's own request got an answer: ${verdicts(EDGE_ANSWERED)}.
Only \`blocked_by_ua_rule\` counts as blocked, and fewer than ${EDGE_MIN_ANSWERED} pages judged decide nothing
(\`insufficient_sample\`, citing those pages' rows), so one page neither opens nor closes a fix. A record names
the edge, never robots.txt: a page robots.txt disallows is not one the edge was tested on, and robots.txt as the
cause of any other verdict is refused as input. A detected record's evidence is the blocked rows; a record with pages judged and not detected cites the
judged rows that were not served; a record with none judged cites the \`edge_blocks_automation\` rows, if any.
Confidence: \`likely\` when decided, since the evidence is our own requests; \`inconclusive\` when indeterminate.

**Robots.** A robots.txt disallow is the site's stated intent: until the site can state its own policy per
crawler, each one is \`respected\`. The record is detected on one disallowed page read or more, with the share
as \`measured\` and the counts as \`extent\`: the fact the screen states, with \`opens_fix\` false;
how a respected-intent record weighs in the grade is CC-17's to apply. For a worker row,
\`disallowed_by_robots\` is the reading, and any other verdict but \`not_measured\` was decided after robots.txt
allowed the crawler on the page, since the worker decides a disallow first; a \`not_measured\` row may come before
robots.txt was read, so it counts neither way. Confidence: \`confirmed\` when decided with every page's rules
read, \`likely\` when decided with some not read, \`inconclusive\` when indeterminate.

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
    ['EDGE_MIN_ANSWERED', String(EDGE_MIN_ANSWERED), 'edge_rule_blocks_crawler'],
    ['SITE_MAJORITY_SHARE', pct(SITE_MAJORITY_SHARE), 'the site verdict (robots.txt and allows)'],
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
type is \`detected\`; 404 or 410, an empty body or an HTML page is \`not_detected\`; another media type, no
answer, no request or another status is \`indeterminate\`. The worker does not request these paths yet.

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
