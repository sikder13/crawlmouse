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

const ABSENCE = 'the crawl cannot prove absence (below)';
const GONE = `the page answers ${GONE_STATUSES.join(' or ')} (\`page_gone\`)`;
const UNCRAWLED = 'a linked URL was not crawled (`not_crawled`)';

const RULES: Readonly<Record<StructureFixType, Rule>> = {
  orphan_pages: {
    subject: 'page URL',
    detected: 'a gradeable 200 page (not the homepage) has no link from another crawled 200 page',
    clear: 'it has at least one such link (proof on any crawl)',
    indeterminate: `no such link and ${ABSENCE}; ${GONE}; ${UNCRAWLED}`,
    measured: 'links to the page from crawled 200 pages',
    affected: 'the page',
    waits:
      'nothing beyond PageResult, LinkEdge, Coverage, `page_cap` and `check.status`, except `PageFacts.links_read` for a 200 page that recorded no links and `PageFacts.final_url` for a page that redirected',
  },
  deep_pages: {
    subject: 'page URL',
    detected: `a gradeable 200 page is more than ${MAX_HEALTHY_DEPTH} clicks from the homepage, or no path reaches it`,
    clear: `it is ${MAX_HEALTHY_DEPTH} clicks or fewer away (proof on any crawl: more pages only shorten paths)`,
    indeterminate: `the homepage was not crawled with a 200; the sample's overlap with the previous check is under ${pct(MIN_STRATA_OVERLAP)}; deeper than ${MAX_HEALTHY_DEPTH} and ${ABSENCE}; ${GONE}; ${UNCRAWLED}`,
    measured: 'clicks from the homepage (none when unreachable)',
    affected: 'the page',
    waits: "as orphan_pages, and the previous check's Coverage",
  },
  generic_anchor_text: {
    subject: 'hub URL',
    detected: `a hub (top ${pct(TOP_HUB_FRACTION)} of crawled 200 pages by PageRank share, at least one) with ${MIN_HUB_OUTLINKS} or more outbound links has more than ${pct(GENERIC_DETECT_ABOVE)} generic anchors`,
    clear: `the share is ${pct(GENERIC_CLEAR_AT_OR_BELOW)} or less`,
    indeterminate: `fewer than ${MIN_HUB_OUTLINKS} outbound links; a share above ${pct(GENERIC_CLEAR_AT_OR_BELOW)} and at most ${pct(GENERIC_DETECT_ABOVE)} (hysteresis: an open fix stays open, no new one opens); links found but not recorded that could move the share across a threshold`,
    measured:
      'generic share of the recorded outbound links; the worker records one link per target, with its first anchor',
    affected: 'the hub',
    waits:
      'nothing: it reads PageResult (`pagerank_share`, `links_out`) and LinkEdge (`is_generic_anchor`)',
  },
  redirect_chain: {
    subject: 'link target URL, as the link spells it',
    detected: `the target answers after ${REDIRECT_CHAIN_MIN_HOPS} or more redirects, or the redirects loop`,
    clear:
      'fewer redirects, from the recorded hop count; or the target is where another crawled request ended with a 200',
    indeterminate: `the hops were not recorded (a request that ended at its own URL may have looped back to it); ${GONE}; ${UNCRAWLED}`,
    measured: 'redirect hops',
    affected: 'the pages that link to the target',
    waits:
      '`PageFacts.redirect` (hops, loop): CC-12 keeps hops in memory and stores only `final_url`',
  },
  duplicate_pagination: {
    subject: 'template key',
    detected: `a later page of the list is within ${SIMHASH_HAMMING_K} bits of page 1 (content simhash), or declares page 1 as its canonical`,
    clear: `no later page is gone, each later page that was crawled and does not redirect was read at its own URL and is neither, and ${ABSENCE.replace('cannot', 'can')}`,
    indeterminate: `page 1 not crawled and read at its own URL; a later page not read (\`page_not_read\`); a content hash or the canonical not read; a later page gone (\`list_page_gone\`); no duplicate found and ${ABSENCE}`,
    measured: 'later pages that repeat page 1',
    affected: 'those later pages',
    waits:
      '`PageFacts.simhash` (main-content simhash), `PageFacts.canonical` and `PageFacts.final_url`',
  },
  canonical_mismatch: {
    subject: 'page URL',
    detected:
      'the canonical points to another host, a URL that redirects or is gone, or a page that declares a canonical elsewhere; or a crawled 200 page links to the page under this non-canonical URL',
    clear: `self-canonical or none declared; or a sound canonical, no link to the page, and ${ABSENCE.replace('cannot', 'can')}`,
    indeterminate: `where the request ended not recorded; the canonical, or the target's own, not read; the target not fetched, or not read (\`canonical_target_not_read\`); unlinked and ${ABSENCE}; ${GONE}; ${UNCRAWLED}. A page whose request landed elsewhere is not judged: it is a redirect`,
    measured: 'links to the page under its non-canonical URL',
    affected: 'the page',
    waits:
      '`PageFacts.canonical` with the declared href kept for any host and for the page itself, and `PageFacts.final_url`. The brief\'s "canonical to a robots-disallowed URL" clause also waits for a robots.txt verdict for search engines: the rules recorded today are our crawler\'s, which a site can single out, so a target they kept us from is `canonical_target_not_fetched`',
  },
  hreflang_gap: {
    subject: 'lowest URL in the cluster',
    detected:
      'a member read at its own URL lacks a self-reference, an `x-default` or a return annotation, or uses an invalid code; a member that redirects or is gone cannot annotate back',
    clear: `every member was read and none of those holds, and ${ABSENCE.replace('cannot', 'can')}`,
    indeterminate: `a member was not crawled, not read at its own URL, or not read (its annotations are unknown, not missing); no defect and ${ABSENCE}`,
    measured: 'members with a defect',
    affected: 'those members',
    waits:
      '`PageFacts.hreflang` and `PageFacts.final_url`: nothing extracts hreflang yet, so the detector reports no cluster',
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
  measured: 'The measured value for the subject, per fix type above; null when there is none.',
  conditions:
    'The problems proved, for the fix types with more than one kind; empty unless `detected`.',
  affected_urls: 'The pages the finding is about, sorted.',
  evidence:
    '`pages`: crawled pages whose results support the verdict; `edges`: the link edges that do, filed under requested URLs (see `final_url`). Both sorted.',
};

const FACT_FIELDS: Readonly<Record<keyof PageFacts, string>> = {
  url: 'The requested URL, as links spell it.',
  final_url:
    'The URL that answered without a redirect; null when not recorded or never reached. Links the worker records from or to a final URL that names one crawled page are filed under that page.',
  links_read:
    'The HTML was parsed and its links read; null when not recorded. Needed for a 200 page that recorded no links.',
  redirect: 'Hops and whether they looped; null when not recorded.',
  canonical:
    'Null when not read; `{ href: null }` when none is declared; the href is kept for any host.',
  simhash: 'The main-content simhash (`simhashForDedup`); null when not computed.',
  hreflang: 'The alternates, `{ lang, href }`; null when not read.',
};

const REASONS: Readonly<Record<IndeterminateReason, string>> = {
  crawl_truncated:
    'The crawl was cut short (below); pages not fetched may hold what would decide it.',
  urls_not_fetched:
    'The crawl discovered a URL it did not fetch (robots.txt rules for our crawler included); it may hold what would decide it.',
  links_not_fully_recorded:
    'A crawled page found more links than were recorded, recorded none and was not known to be read, or kept its content from us (`isUnread`).',
  not_crawled: 'A crawled page links to this URL; the URL itself was not crawled.',
  page_gone: 'The page answered 404 or 410: removed, not fixed.',
  homepage_not_crawled: 'Depth is clicks from the homepage, which was not crawled with a 200.',
  sample_changed: `The sample overlaps the previous check's under ${pct(MIN_STRATA_OVERLAP)}.`,
  too_few_links: `The hub has fewer than ${MIN_HUB_OUTLINKS} outbound links.`,
  hysteresis_band: `The generic share is above ${pct(GENERIC_CLEAR_AT_OR_BELOW)} and at most ${pct(GENERIC_DETECT_ABOVE)}.`,
  hops_not_recorded: 'The hop count of the request was not recorded.',
  first_page_not_crawled: 'Page 1 of the list was not crawled with a 200 and read at its own URL.',
  content_not_hashed: 'A content simhash was not computed.',
  list_page_gone:
    'A later page of the list answers 404 or 410: if it was the duplicate, it was removed, not fixed. It holds while the gone page is crawled, so a stale link to one keeps the template undecided.',
  page_not_read:
    'A later page of the list kept its content from us (`isUnread`), or where its request ended was not recorded.',
  canonical_not_read:
    "The page's canonical, or its target's, was not read at its own URL, or the href is not a URL.",
  canonical_target_not_fetched: 'The canonical target was not fetched.',
  canonical_target_not_read: 'The canonical target kept its content from us (`isUnread`).',
  member_not_crawled:
    'A cluster member was not crawled, its hreflang was not read at its own URL, or it kept its content from us.',
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
  canonical_target_redirects: [
    'canonical_mismatch',
    'The canonical target redirects: a 3xx the crawl stopped at, or a request that landed elsewhere.',
  ],
  canonical_target_gone: ['canonical_mismatch', 'The canonical target answers 404 or 410.'],
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
    'An alternate does not annotate back, or redirects or is gone.',
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
page cap, the homepage, the previous check's coverage, and \`PageFacts\`. It returns
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

## Proving absence

Some verdicts rest on something not being there: no link to a page, no shorter path, no other page of a
list that repeats page 1, no member of a cluster that breaks it, no link under a non-canonical URL. Those
records are decided only when none of the three conditions below holds (\`absenceUnproven\` in
\`scope.ts\`); otherwise they are \`indeterminate\`, with the first reason that holds:

1. \`crawl_truncated\`: the page cap was reached (\`pages_crawled >= page_cap\`), the check is \`partial\` (a
   budget was spent or the site stopped the crawl), the crawl fetched under ${pct(MIN_CRAWL_COVERAGE)} of the URLs it
   discovered, or the check has no coverage.
2. \`urls_not_fetched\`: Coverage counts a URL discovered and not fetched, or a crawled page links to a URL
   that was not crawled. A URL robots.txt kept our crawler from counts too: the rules can single out our
   crawler while search engines read the page.
3. \`links_not_fully_recorded\`: a crawled 200 page found more links than were recorded, or recorded none
   and is not known to have been read (\`links_read\`), or a crawled page answered a status that kept its
   content from us: anything but a 200, a redirect, a 404 or a 410 (\`isUnread\`). A 401, 403 or 429 can
   be a rule against our crawler alone, and a 5xx can pass on a retry.

${pct(MIN_CRAWL_COVERAGE)} is the brief's line for a truncated crawl; it does not make absence provable, so a crawl
between it and 100 % is \`urls_not_fetched\`. The brief's exemption, "unless the page's template was fully
crawled", is not implemented. Coverage counts each template's pages without saying how many were
discovered, and the pages that link to an orphan are often of another template (the ticket's archives
link its posts).

## Fingerprint stability

A fingerprint is the hash of its key, so a fix keeps its fingerprint only while its key stays the same.
Two keys can change between checks while the problem stays: \`pagination:{templateKey}\` when the page's
template key changes, and \`hreflang:{lowest URL}\` when the cluster gains a lower URL or two clusters
join. The old fingerprint then has no outcome (\`absent\`, which the lifecycle leaves untouched) and the
new one opens a new fix. The keys are ENGINE-GAP §5's; matching a moved key to its fix is not done here.

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
