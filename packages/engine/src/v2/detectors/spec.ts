/**
 * Renders docs/specs/v2/16-structure-detectors.md. Thresholds come from thresholds.ts, the reasons and
 * conditions from the lists in types.ts, and the field tables are typed `Record`s over the record
 * types, so the compiler rejects a table that names a field the type lacks or omits one it has.
 * spec.test.ts fails when the file differs from this render.
 */
import { LIFECYCLE, PRIORS } from '../diff/lifecycle.js';
import { DETECTORS } from './index.js';
import { KEY_PREFIX, type StructureFixType } from './fingerprint.js';
import {
  GENERIC_CLEAR_AT_OR_BELOW,
  GENERIC_DETECT_ABOVE,
  GONE_STATUSES,
  MAX_HEALTHY_DEPTH,
  MIN_CRAWL_COVERAGE,
  MIN_HUB_OUTLINKS,
  MIN_STRATA_OVERLAP,
  REDIRECT_CHAIN_MIN_HOPS,
  SIMHASH_HAMMING_K,
  TOP_HUB_FRACTION,
} from './thresholds.js';
import {
  CONDITIONS,
  INDETERMINATE_REASONS,
  type Condition,
  type Detection,
  type IndeterminateReason,
  type PageFacts,
} from './types.js';

export const SPEC_URL = new URL(
  '../../../../../docs/specs/v2/16-structure-detectors.md',
  import.meta.url,
);

const code = (s: string) => `\`${s}\``;
const pct = (x: number) => `${Math.round(x * 100)} %`;

function table(head: string[], rows: string[][]): string {
  const width = head.map((h, k) => Math.max(h.length, ...rows.map((r) => r[k]!.length)));
  const line = (cells: string[]) => `| ${cells.map((c, k) => c.padEnd(width[k]!)).join(' | ')} |`;
  return [line(head), line(width.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

interface Rule {
  subject: string;
  detected: string;
  clear: string;
  indeterminate: string;
  measured: string;
  affected: string;
  waits: string;
}

const RULES: Readonly<Record<StructureFixType, Rule>> = {
  orphan_pages: {
    subject: 'page URL',
    detected: 'a gradeable 200 page (not the homepage) has no link from another crawled 200 page',
    clear: 'it has at least one such link',
    indeterminate: `the crawl is truncated, or links were not all seen (a page found more than were recorded, or a crawled page answered 429 or 5xx); the page answers ${GONE_STATUSES.join(' or ')} (\`page_gone\`); a linked URL was not crawled`,
    measured: 'links to the page from crawled 200 pages',
    affected: 'the page',
    waits: 'nothing: it reads PageResult and LinkEdge only',
  },
  deep_pages: {
    subject: 'page URL',
    detected: `a gradeable 200 page is more than ${MAX_HEALTHY_DEPTH} clicks from the homepage, or no path reaches it`,
    clear: `it is ${MAX_HEALTHY_DEPTH} clicks or fewer away (proven on any crawl: more pages only shorten paths)`,
    indeterminate: `the homepage was not crawled; the sample's overlap with the previous check is under ${pct(MIN_STRATA_OVERLAP)}; a deep page on a truncated crawl, or with links not all recorded; a gone page; a linked URL not crawled`,
    measured: 'clicks from the homepage (none when unreachable)',
    affected: 'the page',
    waits: 'nothing: it reads PageResult, LinkEdge and Coverage only',
  },
  generic_anchor_text: {
    subject: 'hub URL',
    detected: `a hub (top ${pct(TOP_HUB_FRACTION)} of crawled 200 pages by PageRank share, at least one) with ${MIN_HUB_OUTLINKS} or more outbound links has more than ${pct(GENERIC_DETECT_ABOVE)} generic anchors`,
    clear: `the share is ${pct(GENERIC_CLEAR_AT_OR_BELOW)} or less`,
    indeterminate: `fewer than ${MIN_HUB_OUTLINKS} outbound links; a share above ${pct(GENERIC_CLEAR_AT_OR_BELOW)} and at most ${pct(GENERIC_DETECT_ABOVE)} (hysteresis: an open fix stays open, no new one opens); unrecorded links that could move the share across a threshold`,
    measured: 'generic share of the recorded outbound links',
    affected: 'the hub',
    waits:
      'nothing: it reads PageResult (`pagerank_share`, `links_out`) and LinkEdge (`is_generic_anchor`)',
  },
  redirect_chain: {
    subject: 'link target URL',
    detected: `the target answers after ${REDIRECT_CHAIN_MIN_HOPS} or more redirects, or the redirects loop`,
    clear: 'fewer redirects; or no hop count but the request ended at its own URL',
    indeterminate:
      'the request ended elsewhere and its hops were not recorded; the target was not crawled',
    measured: 'redirect hops',
    affected: 'the pages that link to the target',
    waits:
      '`PageFacts.redirect` (hops, loop) and `final_url`: CC-12 keeps hops in memory and stores only `final_url`',
  },
  duplicate_pagination: {
    subject: 'template key',
    detected: `a later page of the list is within ${SIMHASH_HAMMING_K} bits of page 1 (content simhash), or declares page 1 as its canonical`,
    clear: 'every crawled later page is neither, on a complete crawl',
    indeterminate:
      'page 1 not crawled with a 200; a content hash or the canonical not read; a clear template on a truncated crawl',
    measured: 'later pages that repeat page 1',
    affected: 'those later pages',
    waits: '`PageFacts.simhash` (main-content simhash) and `PageFacts.canonical`',
  },
  canonical_mismatch: {
    subject: 'page URL',
    detected:
      'the canonical points to another host, a robots-disallowed URL, a page answering a redirect or a 4xx, or a page that declares a canonical elsewhere; or a crawled 200 page links to the page under this non-canonical URL',
    clear:
      'self-canonical or none declared; or a sound canonical and no link to the page, on a complete crawl',
    indeterminate:
      "the canonical, or the target's own, not read; the target not fetched or answering 429 or 5xx; unlinked on a truncated crawl; a gone page; a linked URL not crawled",
    measured: 'links to the page under its non-canonical URL',
    affected: 'the page',
    waits: '`PageFacts.canonical` with the declared href kept for any host and for the page itself',
  },
  hreflang_gap: {
    subject: 'lowest URL in the cluster',
    detected:
      'a read member lacks a self-reference, an `x-default` or a return annotation, or uses an invalid code',
    clear: 'every member was read and none of those holds, on a complete crawl',
    indeterminate:
      'a member was not crawled, not read, or answered 429 or 5xx (its annotations are unknown, not missing); a clear cluster on a truncated crawl',
    measured: 'members with a defect',
    affected: 'those members',
    waits:
      '`PageFacts.hreflang`: nothing extracts hreflang yet, so the detector reports no cluster',
  },
};

const THRESHOLDS: [string, string, string][] = [
  ['MIN_CRAWL_COVERAGE', pct(MIN_CRAWL_COVERAGE), 'truncation'],
  ['MAX_HEALTHY_DEPTH', String(MAX_HEALTHY_DEPTH), 'deep_pages (v1 `constants.ts`)'],
  ['MIN_STRATA_OVERLAP', pct(MIN_STRATA_OVERLAP), 'deep_pages'],
  ['TOP_HUB_FRACTION', pct(TOP_HUB_FRACTION), 'generic_anchor_text (v1 `analysis/structure.ts`)'],
  ['MIN_HUB_OUTLINKS', String(MIN_HUB_OUTLINKS), 'generic_anchor_text'],
  ['GENERIC_DETECT_ABOVE', pct(GENERIC_DETECT_ABOVE), 'generic_anchor_text'],
  ['GENERIC_CLEAR_AT_OR_BELOW', pct(GENERIC_CLEAR_AT_OR_BELOW), 'generic_anchor_text'],
  ['REDIRECT_CHAIN_MIN_HOPS', String(REDIRECT_CHAIN_MIN_HOPS), 'redirect_chain'],
  [
    'SIMHASH_HAMMING_K',
    String(SIMHASH_HAMMING_K),
    'duplicate_pagination (v1 `analysis/simhash.ts`)',
  ],
  ['GONE_STATUSES', GONE_STATUSES.join(', '), '`page_gone`'],
];

const DETECTION_FIELDS: Readonly<Record<keyof Detection, string>> = {
  type: 'The fix type (`FixTypeSchema`).',
  fingerprint: 'First 16 hex characters of the SHA-256 of `key` (`FingerprintSchema`).',
  key: 'The ENGINE-GAP §5 key, `{prefix}:{subject}`.',
  state: '`detected`, `not_detected` or `indeterminate`.',
  reason: 'Why it is `indeterminate`; null otherwise.',
  page_gone:
    'The 404 or 410 the subject page answered; null otherwise. The contract has no "removed" state yet.',
  measured: 'The number the verdict was decided on (per fix type, above); null when there is none.',
  conditions:
    'The problems proved, for the fix types with more than one kind; empty unless `detected`.',
  affected_urls: 'The pages the finding is about, sorted.',
  evidence:
    '`pages`: crawled pages whose results support the verdict; `edges`: the link edges that do. Both sorted.',
};

const FACT_FIELDS: Readonly<Record<keyof PageFacts, string>> = {
  url: 'The requested URL, as links spell it.',
  final_url: 'The URL that answered without a redirect; null when not recorded or never reached.',
  redirect: 'Hops and whether they looped; null when not recorded.',
  canonical:
    'Null when not read; `{ href: null }` when none is declared; the href is kept for any host.',
  simhash: 'The main-content simhash (`simhashForDedup`); null when not computed.',
  hreflang: 'The alternates, `{ lang, href }`; null when not read.',
};

const REASONS: Readonly<Record<IndeterminateReason, string>> = {
  crawl_truncated: 'The crawl was cut short; pages not fetched may hold what would decide it.',
  links_not_fully_recorded:
    'A crawled page found more links than were recorded, or a crawled page answered 429 or 5xx and its links were not seen.',
  not_crawled: 'A crawled page links to this URL; the URL itself was not crawled.',
  page_gone: 'The page answered 404 or 410: removed, not fixed.',
  homepage_not_crawled: 'Depth is clicks from the homepage, which was not crawled with a 200.',
  sample_changed: `The sample overlaps the previous check's under ${pct(MIN_STRATA_OVERLAP)}.`,
  too_few_links: `The hub has fewer than ${MIN_HUB_OUTLINKS} outbound links.`,
  hysteresis_band: `The generic share is above ${pct(GENERIC_CLEAR_AT_OR_BELOW)} and at most ${pct(GENERIC_DETECT_ABOVE)}.`,
  hops_not_recorded: 'The request was redirected and the hop count was not recorded.',
  first_page_not_crawled: 'Page 1 of the list was not crawled with a 200.',
  content_not_hashed: 'A content simhash was not computed.',
  canonical_not_read: "The page's canonical, or its target's, was not read.",
  canonical_target_not_fetched: 'The canonical target was not fetched.',
  canonical_target_errored: 'The canonical target answered 429 or 5xx.',
  member_not_crawled: 'A cluster member was not crawled, or its hreflang was not read.',
};

const CONDITION_TEXT: Readonly<Record<Condition, [StructureFixType, string]>> = {
  redirect_loop: ['redirect_chain', 'The redirects loop.'],
  pagination_near_duplicate: [
    'duplicate_pagination',
    `Within ${SIMHASH_HAMMING_K} bits of page 1.`,
  ],
  pagination_canonical_to_first: ['duplicate_pagination', 'Declares page 1 as its canonical.'],
  canonical_cross_host: [
    'canonical_mismatch',
    'The canonical is on another host (a www sibling is the same host).',
  ],
  canonical_target_not_200: [
    'canonical_mismatch',
    'The canonical target answers a redirect or a 4xx.',
  ],
  canonical_target_disallowed: ['canonical_mismatch', 'robots.txt disallows the canonical target.'],
  canonical_target_not_canonical: [
    'canonical_mismatch',
    'The target declares a canonical elsewhere.',
  ],
  linked_under_non_canonical: [
    'canonical_mismatch',
    'A crawled 200 page links to the non-canonical URL.',
  ],
  hreflang_missing_self: [
    'hreflang_gap',
    'No annotation names the page itself in a language (an `x-default` to itself does not count).',
  ],
  hreflang_missing_return: [
    'hreflang_gap',
    'An alternate does not annotate back, or answers a redirect or a 4xx.',
  ],
  hreflang_missing_x_default: ['hreflang_gap', 'No `x-default` annotation.'],
  hreflang_invalid_code: [
    'hreflang_gap',
    'A code outside ISO 639-1 (+ optional script + ISO 3166-1 alpha-2 region).',
  ],
};

export function renderStructureSpec(): string {
  const types = DETECTORS.map((d) => d.type);
  return `# 16 — Structure detectors

> Generated by \`packages/engine/src/v2/detectors/spec.ts\`; do not edit by hand. Regenerate with
> \`pnpm --filter @crawlmouse/engine exec tsx src/v2/detectors/write-spec.ts\`.

Each detector is a pure function of one check (\`DetectorInput\`): page results, link edges, coverage, the
page cap, the homepage, the previous check's coverage, robots-disallowed URLs, and \`PageFacts\`. It returns
one \`Detection\` per fingerprint, sorted by fix type and then key. \`detectStructure\` runs them all. A
detected record is not a \`FixDraft\`: CC-17 adds the effect and the packet and turns records into the
diff's \`DetectorOutcome\`s.

## The rule

When the evidence cannot support a verdict the record is \`indeterminate\`. What the diff does with it, by
the fix's status before the check (\`LIFECYCLE.indeterminate\` in \`diff/lifecycle.ts\`):

${table(
  ['Fix before', 'Action'],
  PRIORS.map((p) => [code(p), code(LIFECYCLE.indeterminate[p])]),
)}

The tests that pin each rule below:
\`pnpm --filter @crawlmouse/engine exec vitest run src/v2/detectors\`.

## Detectors

${table(
  ['Fix type', 'Key', 'Subject', 'Detected', 'Not detected', 'Indeterminate'],
  types.map((t) => [
    code(t),
    code(`${KEY_PREFIX[t]}:`),
    RULES[t].subject,
    RULES[t].detected,
    RULES[t].clear,
    RULES[t].indeterminate,
  ]),
)}

${table(
  ['Fix type', 'Measured', 'Affected pages'],
  types.map((t) => [code(t), RULES[t].measured, RULES[t].affected]),
)}

## A truncated crawl

The page cap was reached (\`pages_crawled >= page_cap\`), the check is \`partial\` (a budget was spent or the
site stopped the crawl), the crawl fetched under ${pct(MIN_CRAWL_COVERAGE)} of the URLs it discovered, or the
check has no coverage. A truncated crawl detects no orphan and no deep page: pages it did not fetch may
link to them.

The brief's exemption, "unless the page's template was fully crawled", is not implemented. Coverage
counts each template's pages without saying how many were discovered, and the pages that link to an
orphan are often of another template (the ticket's archives link its posts).

## Thresholds

${table(['Constant', 'Value', 'Used by'], THRESHOLDS)}

## The detection record

${table(
  ['Field', 'Meaning'],
  (Object.keys(DETECTION_FIELDS) as (keyof Detection)[]).map((f) => [code(f), DETECTION_FIELDS[f]]),
)}

### Why a record is indeterminate

${table(
  ['Reason', 'Meaning'],
  INDETERMINATE_REASONS.map((r) => [code(r), REASONS[r]]),
)}

### Conditions

${table(
  ['Condition', 'Fix type', 'Meaning'],
  CONDITIONS.map((c) => [code(c), code(CONDITION_TEXT[c][0]), CONDITION_TEXT[c][1]]),
)}

## Inputs the contract does not store yet

\`PageFacts\` carries what one request showed beyond \`PageResult\`. Null means "not read", and a detector
that needs a null fact reports \`indeterminate\`.

${table(
  ['Field', 'Meaning'],
  (Object.keys(FACT_FIELDS) as (keyof PageFacts)[]).map((f) => [code(f), FACT_FIELDS[f]]),
)}

What each detector waits for before it can decide on a production check:

${table(
  ['Fix type', 'Waits for'],
  types.map((t) => [code(t), RULES[t].waits]),
)}
`;
}
