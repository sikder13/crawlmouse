/**
 * Renders docs/specs/v2/16-structure-detectors.md. Thresholds come from thresholds.ts, the reasons and
 * conditions from the lists in types.ts, and the field tables are typed `Record`s over the record
 * types, so the compiler rejects a table that names a field the type lacks or omits one it has.
 * spec.test.ts fails when the file differs from this render.
 */
import { LIFECYCLE, PRIORS } from '../diff/lifecycle.js';
import { DETECTORS } from './index.js';
import { KEY_PREFIX, type StructureFixType } from './fingerprint.js';
import { SEARCH_ENGINES } from './scope.js';
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
  },
  deep_pages: {
    subject: 'page URL',
    detected: `a gradeable 200 page is more than ${MAX_HEALTHY_DEPTH} clicks from the homepage, or no path reaches it`,
    clear: `it is ${MAX_HEALTHY_DEPTH} clicks or fewer away (proof on any crawl: more pages only shorten paths)`,
    indeterminate: `the homepage was not crawled with a 200; the sample's overlap with the previous check is under ${pct(MIN_STRATA_OVERLAP)}; deeper than ${MAX_HEALTHY_DEPTH} and ${ABSENCE}; ${GONE}; ${UNCRAWLED}`,
    measured: 'clicks from the homepage (none when unreachable)',
    affected: 'the page',
  },
  generic_anchor_text: {
    subject: 'hub URL',
    detected: `a hub (top ${pct(TOP_HUB_FRACTION)} of crawled 200 pages by PageRank share, at least one) with ${MIN_HUB_OUTLINKS} or more outbound links has more than ${pct(GENERIC_DETECT_ABOVE)} generic anchors`,
    clear: `the share is ${pct(GENERIC_CLEAR_AT_OR_BELOW)} or less`,
    indeterminate: `fewer than ${MIN_HUB_OUTLINKS} outbound links; a share above ${pct(GENERIC_CLEAR_AT_OR_BELOW)} and at most ${pct(GENERIC_DETECT_ABOVE)} (hysteresis: an open fix stays open, no new one opens); links found but not recorded that could move the share across a threshold`,
    measured:
      'generic share of the recorded outbound links; the worker records one link per target, with its first anchor',
    affected: 'the hub',
  },
  redirect_chain: {
    subject: 'link target URL, as the link spells it',
    detected: `the target answers after ${REDIRECT_CHAIN_MIN_HOPS} or more redirects, or the redirects loop`,
    clear:
      'fewer redirects, from the recorded hop count; or the target is where another crawled request ended with a 200',
    indeterminate: `the hops were not recorded (a request that ended at its own URL may have looped back to it); ${GONE}; ${UNCRAWLED}`,
    measured: 'redirect hops',
    affected: 'the pages that link to the target',
  },
  duplicate_pagination: {
    subject: 'template key',
    detected: `a later page of the list is within ${SIMHASH_HAMMING_K} bits of page 1 (content simhash), or declares page 1 as its canonical`,
    clear: `no later page is gone, each later page that was crawled and does not redirect was read at its own URL and is neither, and ${ABSENCE.replace('cannot', 'can')}`,
    indeterminate: `page 1 not crawled and read at its own URL; a later page not read (\`page_not_read\`); a content hash or the canonical not read; a later page gone (\`list_page_gone\`); no duplicate found and ${ABSENCE}`,
    measured: 'later pages that repeat page 1',
    affected: 'those later pages',
  },
  canonical_mismatch: {
    subject: 'page URL',
    detected:
      'the canonical points to another host, a URL that redirects or is gone, or a page that declares a canonical elsewhere; or a crawled 200 page links to the page under this non-canonical URL',
    clear: `self-canonical or none declared; or a sound canonical, no link to the page, and ${ABSENCE.replace('cannot', 'can')}`,
    indeterminate: `where the request ended not recorded; the canonical, or the target's own, not read; the target not fetched, or not read (\`canonical_target_not_read\`); unlinked and ${ABSENCE}; ${GONE}; ${UNCRAWLED}. A page whose request landed elsewhere is not judged: it is a redirect`,
    measured: 'links to the page under its non-canonical URL',
    affected: 'the page',
  },
  hreflang_gap: {
    subject: 'lowest URL in the cluster',
    detected:
      'a member read at its own URL lacks a self-reference, an `x-default` or a return annotation, or uses an invalid code; a member that redirects or is gone cannot annotate back',
    clear: `every member was read and none of those holds, and ${ABSENCE.replace('cannot', 'can')}`,
    indeterminate: `a member was not crawled, not read at its own URL, or not read (its annotations are unknown, not missing); no defect and ${ABSENCE}`,
    measured: 'members with a defect',
    affected: 'those members',
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

/** What each `PageFacts` field is read from on `PageResult` (`pageFacts`, facts.ts), and what it means. */
const FACT_FIELDS: Readonly<Record<keyof PageFacts, [string, string]>> = {
  url: ['url', 'The requested URL, as links spell it.'],
  final_url: [
    'final_url',
    'The URL that answered without a redirect; null when never reached. Links the worker records from or to a final URL that names one crawled page are filed under that page.',
  ],
  links_read: [
    'links_read',
    'Every link on the page was read; false for a page read in part (a cut body, the tag or nesting limit, links past the read limit) or not at all.',
  ],
  redirect: ['redirect', 'The hop count and whether the chain looped; null when not recorded.'],
  canonical: [
    'canonical_declared',
    'Null when not read; `{ href: null }` when none is declared; otherwise the resolved URL, or the href as written when it does not resolve, kept for any host.',
  ],
  simhash: [
    'content_simhash',
    'The main-content simhash (`simhashForDedup`); null when not computed or the content is too short.',
  ],
  hreflang: [
    'hreflang',
    'The alternates, `{ lang, href }`; null when not read, or when the list is incomplete (`complete: false`).',
  ],
};

/**
 * The page facts, and the other inputs, each module reads by name: the detector's own module, and
 * scope.ts, which every detector judges through. spec.test.ts reads the modules' source and fails
 * when this table and the source disagree.
 */
export const INPUTS_READ: Readonly<Record<StructureFixType | 'scope', readonly string[]>> = {
  scope: ['canonical', 'disallowed', 'final_url', 'hreflang', 'links_read', 'robots_search'],
  orphan_pages: [],
  deep_pages: [],
  generic_anchor_text: [],
  redirect_chain: ['redirect'],
  duplicate_pagination: ['canonical', 'final_url', 'simhash'],
  canonical_mismatch: ['canonical', 'disallowed', 'final_url', 'robots_search'],
  hreflang_gap: ['final_url', 'hreflang'],
};

const REASONS: Readonly<Record<IndeterminateReason, string>> = {
  crawl_truncated:
    'The crawl was cut short (below); pages not fetched may hold what would decide it.',
  urls_not_fetched:
    'The crawl discovered a URL it did not fetch and robots.txt does not exclude for every crawler; it may hold what would decide it.',
  links_not_fully_recorded:
    'A crawled page found more links than were recorded, did not have all its links read, or kept its content from us (`isUnread`).',
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
  canonical_target_not_fetched:
    'The canonical target was not fetched, and robots.txt does not disallow it for every search engine.',
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
  canonical_target_disallowed: [
    'canonical_mismatch',
    `robots.txt disallows the target for every search engine (${SEARCH_ENGINES.join(', ')}), so none can read the page it names.`,
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
page cap, the homepage, the previous check's coverage, and the URLs robots.txt kept our crawler from
(\`disallowed\`). It returns
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
   discovered and robots.txt does not exclude (\`excluded_by_robots\`, below), or the check has no coverage.
2. \`urls_not_fetched\`: Coverage counts a URL discovered and neither fetched nor excluded by robots.txt,
   or a crawled page links to a URL that was neither crawled nor excluded.
3. \`links_not_fully_recorded\`: a crawled 200 page found more links than were recorded, or did not have
   all its links read (\`links_read\` false), or a crawled page answered a status that kept its content
   from us: anything but a 200, a redirect, a 404 or a 410 (\`isUnread\`). A 401, 403 or 429 can be a
   rule against our crawler alone, and a 5xx can pass on a retry.

**Excluded by robots.txt.** A URL robots.txt disallows for our crawler and for every search engine
(${SEARCH_ENGINES.map(code).join(', ')}) is not part of the crawlable site: it is neither unfetched
nor a page that can link, links to it are left out of the graph, and \`coverage.excluded_by_robots\`
counts it; the truncation share is taken over the URLs discovered less those. A URL disallowed for our
crawler and not for every search engine stays unfetched: the rules can single out our crawler while
search engines read the page. The detectors refuse an input whose count and list of excluded URLs
disagree.

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

## URL spelling

Every URL in \`PageFacts\` is canonicalised (\`canonicalizeUrl\`) before it is compared, as links and pages
are. So a declared canonical or hreflang href that differs from a page's URL only in what that function
normalises names the same page: a trailing slash, a fragment or the order of query parameters, for
example (the full list is in \`url-canonical.ts\`). A canonical to \`/p/\` on \`/p\` is self-consistent,
even if \`/p/\` itself would redirect or 404.

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

## Inputs

\`PageFacts\` is the detectors' view of what one request showed, read from \`PageResult\` (\`pageFacts\`,
\`facts.ts\`); the crawl worker records each field (SPEC 12). A null fact was not read, and a detector that
needs it reports \`indeterminate\`.

${table(
  ['Fact', 'From PageResult', 'Meaning'],
  (Object.keys(FACT_FIELDS) as (keyof PageFacts)[]).map((f) => [
    code(f),
    code(FACT_FIELDS[f][0]),
    FACT_FIELDS[f][1],
  ]),
)}

\`robots_search\` (robots.txt's verdict for each search engine) is read from \`PageResult\` itself, and
\`disallowed\` from \`DetectorInput\`. Every detector judges through \`scope.ts\`, which reads
${INPUTS_READ.scope.map(code).join(', ')}. What each detector's own module reads besides (pinned to the
source by \`spec.test.ts\`):

${table(
  ['Fix type', 'Reads'],
  types.map((t) => [
    code(t),
    INPUTS_READ[t].length ? INPUTS_READ[t].map(code).join(', ') : 'nothing more',
  ]),
)}
`;
}
