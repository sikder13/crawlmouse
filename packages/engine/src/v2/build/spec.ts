/**
 * Renders docs/specs/v2/20a-check-builder.md. The field tables are typed `Record`s over the contract
 * rows and the builder's own types, so tsc rejects a table that leaves a field out; the status table,
 * bounds and lineage values are read from the code; the fixture tables and the findings are computed
 * from the recorded fixture when the spec renders. spec.test.ts fails when the file differs.
 */
import type { BatchResult, Check, PageResult } from '@crawlmouse/types/v2';
import {
  CONTENT_FEATURES_BYTES,
  JSON_LD_TYPE_BYTES,
  MAX_JSON_LD_NODES,
  MAX_JSON_LD_TYPES,
} from '@crawlmouse/types/v2';
import * as site from '../../../fixtures/v2/build/site/site.js';
import {
  HOST,
  readRecorded,
  recordedBuild,
  recordedInput,
} from '../../../fixtures/v2/build/recorded.js';
import { code, table } from '../detectors/spec.js';
import { GRADE_VERSION } from '../grade/weights.js';
import { FREE_MAX_RENDERS } from '../render/sample.js';
import { SAMPLE_MAX_PAGES } from './assemble.js';
import { buildCheck } from './build.js';
import { DETECTORS_RUN } from './diff.js';
import {
  AWAITING_FIX_STATUSES,
  CRAWL_BATCH_URLS,
  STAGE1_CHALLENGED,
  STAGE1_MAX_PAGES,
  STAGE1_TEMPLATES,
  STAGE2_MAX_PAGES,
  STAGE2_PICKS,
} from './plan.js';
import { PARTIAL_RULE } from './status.js';
import { SUMMARY_BYTES } from './summaries.js';
import type { BuildInput, BuiltCheck } from './types.js';

export const SPEC_URL = new URL(
  '../../../../../docs/specs/v2/20a-check-builder.md',
  import.meta.url,
);

const INPUT: Record<keyof BuildInput, string> = {
  check:
    "The check as CC-20b created it: ids, trigger, timestamps, `expires_at`, `page_cap`, and `grade_version`, which must be this engine's.",
  site: 'The `Site` row. Its `account_id` decides whether a usage event is written.',
  homepage_url:
    "Where the crawl started, in the engine's canonical spelling (the root has no trailing slash).",
  seeds:
    "The crawl's seeds from discovery: the homepage and the sitemap's URLs with their `lastmod`.",
  batches: 'Every crawl and access batch result, parsed with `BatchResultSchema`.',
  render: "CC-14's `RenderOutcome` over `renderCandidates`; null when nothing rendered.",
  previous:
    "The site's last graded check as `diffCheck` reads it: its `Check` and its `diff_inputs`.",
  fixes: "The site's fixes before this check.",
  events: 'Every event of those fixes.',
  lineage:
    '`engine_sha`, and `worker_release`: a batch row that names a worker release must name this one.',
  now: 'When the lineage row is minted (its `created_at`).',
};

const OUTPUT: Record<keyof BuiltCheck, string> = {
  check: '`Check`, parsed with `CheckSchema`.',
  page_results: '`PageResult` per crawl row whose outcome is `fetched`, sorted by URL.',
  link_edges: '`LinkEdge` per distinct (`from_url`, `to_url`) the worker recorded.',
  access_tests: "The access batches' `AccessTest` rows, unchanged.",
  fixes: "CC-19's `DiffResult.fixes`, unchanged.",
  fix_events: "CC-19's `DiffResult.events`, unchanged.",
  changes: "CC-19's `DiffResult.changes`, unchanged.",
  lineages:
    'Two `MeasurementLineage` rows (below): `grading`, with no worker, which the check names, and `fetching`, with the worker release, which the page, link and access rows name.',
  usage_event:
    'One `UsageEvent`, or null for a site no account keeps (`UsageEventSchema` requires `account_id`).',
  diff_inputs:
    "`page_cap`, `robots_txt`, `detectors`, `indeterminate`: what the next check's diff needs of this one that `Check` does not carry. CC-20b must persist it (migration 008) and pass it back as the next `previous`.",
  grades: "CC-17's `Grades`, as `gradeCheck` returned them. Not a contract row.",
  summaries: `One small summary per check phase for Inngest, each under ${SUMMARY_BYTES} bytes as JSON. Not a contract row.`,
};

const PAGE_FIELDS: Record<keyof PageResult, string> = {
  check_id: 'the check',
  url: "the crawl row's URL (refused unless canonical)",
  template_key: 'v1 `templateKeyFor(url)`',
  kind: "v1 `classifyPages`, with the CMS overlay of the homepage's `stack_signals`, the row's `main_text_chars`, `content_simhash` and `noindex`. A page not read whole has no `main_text_chars`, so it is not thin (v1 keeps a page when the signal is absent); it is noindex only by its X-Robots-Tag header, which the worker reads whether or not it read the page",
  status_code: 'the row',
  depth:
    "v1 `computeDepth` from the homepage over every page and the links filed under the page they were found on (`filing.ts`, the detectors' rule); null for a page no link path reaches, and for every page when the homepage is not a page",
  links_in: 'distinct linking URLs among the filed links into the page',
  links_out:
    "the row's `links_out`: the distinct same-host links the worker found, recorded or not; 0 when the page was not read",
  pagerank_share:
    'v1 `computePageRank` over the pages answering 200 and the filed links (the graph the Technical SEO grade reads), over the sum; null for any other page',
  is_orphan: "CC-16's `orphan_pages` record for the page is `detected`",
  js_only: 'false: the worker reads links from static HTML only',
  found_via: '`sitemap` for a sitemap seed, else `link` (the enum has no value for the homepage)',
  sitemap_lastmod: "the sitemap seed's `lastmod`, else null",
  suggested_parent_url:
    "for an orphan, v1's top prescription (`enumerateFixes`, TF-IDF over titles, anchors and slugs); null when v1 has none",
  sampled: 'the page has an access test as a crawler',
  without_js: "the render outcome's measurement of the page, else null",
  crawlers_reached:
    'of the crawlers tested on the page, those served (`allowed`, `allowed_thin`); null when not sampled, or when a crawler test on it measured nothing (`not_measured`)',
  crawlers_reading_text:
    'of those, the ones whose verdict is `allowed`; null as for `crawlers_reached`',
  content_failures: "CC-17's `Grades.content_failures`",
  final_url: 'the row',
  redirect: 'the row',
  canonical_declared: 'the row',
  hreflang: 'the row',
  content_simhash: 'the row',
  is_html: 'the row',
  links_read: 'the row',
  robots_search: 'the row',
  title: 'the row',
  meta_description: 'the row',
};

const CHECK_FIELDS: Record<keyof Check, string> = {
  id: 'input',
  site_id: 'input',
  previous_check_id: 'input',
  status: '`finished`, or `partial` by the status table below',
  trigger: 'input',
  grade_version: "CC-17's `GRADE_VERSION`, which the input must name",
  queued_at: 'input',
  started_at: 'input',
  finished_at: 'input',
  tested_at: 'the latest `finished_at` of the access batches; null with none',
  expires_at: 'input',
  deferred_until: 'null',
  failure_reason: 'null',
  result_email: 'null (CC-20b sends it)',
  coverage:
    'assembly: discovered and crawled counts, the sample, templates (label = template key), v1 `computeCoverageAccounting` over the pages answering 200, and `excludedByRobots`',
  technical_seo: '`gradeCheck`',
  ai_readability: '`gradeCheck`',
  structure:
    "counts over the pages, and v1's graph analysis of the pages answering 200 (hubs: v1's top 5 % by PageRank)",
  without_js: "CC-14's `siteEstimate` over the graded pages; null when no graded page was rendered",
  content: '`gradeCheck`',
  signals:
    "`gradeCheck`'s schema_org and content_signals, then `declarationSignal` for each declaration, from the first crawl batch that requested it",
  crawlers:
    "the access matrix (`detectAccess`), with `text_share` null: no step measures a crawler's share yet",
  stack:
    "`frontend` null (CC-17b); `backend` from the homepage row's `stack_signals`, null when the homepage was not read or `detectCms` recognised no CMS (it answers `custom` then); `edge` Cloudflare when a crawler test (not a browser control) carries the `cloudflare_1020` cause, else null",
  competitors: '`[]`',
  progress: 'null: the contract keeps progress for a running check only (`check_progress`)',
};

const ARCH_DIFFERENCES = [
  'ARCH-2 §4.2 names `crawl_batches` and a `check.batch.done` event. The merged worker returns a batch result and holds no database credential; the builder reads results, whatever carried them.',
  "ARCH-2 stores the sample in `page_results.in_sample` and `sample_stage`. The contract has `PageResult.sampled` only; the stage is the planner's (`sample`), recomputed from the rows.",
  'ARCH-2 names per-crawler verdict columns on `page_results`. The merged contract keeps verdicts on `AccessTest` rows and the site verdict on `Check.crawlers`.',
  "ARCH-2's `discover` step reads robots.txt and sitemaps for the pipeline. The merged worker reads robots.txt itself for each batch (cached across batches) and requests `/sitemap.xml` for its status and size only; sitemap URLs reach the builder as `seeds`.",
  "ENGINE-GAP §8.4 counts stage 1 as the homepage, 24 templates and 2 challenged pages, at most 25. Here the homepage's and the challenged pages' templates count toward the 24, and the 25-page bound is checked before each template page: challenged pages can share the homepage's template, since a template key leaves the query out.",
];

const BRIEF_DIFFERENCES = [
  '`BuiltCheck.withheld` is not returned: the builder returns every record it is given, so there is no subset to state.',
  '`Check.progress` is null, not every phase `done`: the contract refuses progress on a check that is not running.',
  'The builder calls five engine entry points; the sixth, `effectsOf`, is called by `detectorOutcomes`. The once-per-check test counts all six.',
  'A usage event for a site no account keeps is null as a row, since `UsageEventSchema` requires `account_id`.',
  "The worker writes `main_text_chars` and `noindex` on each crawl row and keeps robots.txt whole (`RobotsEvidence.body`, `body_complete`), beyond D2's two fields, by owner ruling.",
  'Links are emitted as the worker recorded them. A link from a redirected page names where it landed; the detectors file it back themselves, and the graph the grade, depth, PageRank and inbound counts read files it by the same rule (`filing.ts`). The properties tested are that every link is filed under a crawled page or the final URL one landed on, that `links_out` is at least the links recorded from the page, and that depth equals a breadth-first walk over the filed links.',
];

const pageOf = (b: BuiltCheck, path: string) =>
  b.page_results.find((p) => p.url === (path === '/' ? HOST : `${HOST}${path}`));
const recordOf = (b: BuiltCheck, type: string, path: string) =>
  b.grades.inputs.seo.detections.find((d) => d.type === type && d.key.endsWith(`:${HOST}${path}`));

function defects(b: BuiltCheck): string[][] {
  const fixes = (type: string) => b.fixes.filter((f) => f.type === type).length;
  const crawler = (ua: string) => b.check.crawlers.find((c) => c.ua === ua)!;
  return [
    [
      'orphan',
      code(site.ORPHAN),
      `${code('orphan_pages')} ${recordOf(b, 'orphan_pages', site.ORPHAN)!.state}; fixes ${fixes('orphan_pages')}`,
    ],
    [
      'depth 4',
      code(site.DEEP),
      `depth ${pageOf(b, site.DEEP)!.depth}; ${code('deep_pages')} ${recordOf(b, 'deep_pages', site.DEEP)!.state}`,
    ],
    [
      'redirect chain',
      code(site.REDIRECT_FROM),
      `${pageOf(b, site.REDIRECT_FROM)!.redirect!.hops.length} hops; ${code('redirect_chain')} ${recordOf(b, 'redirect_chain', site.REDIRECT_FROM)!.state}`,
    ],
    [
      'canonical mismatch',
      code(site.CANONICAL_PAGE),
      `${code('canonical_mismatch')} ${recordOf(b, 'canonical_mismatch', site.CANONICAL_PAGE)!.state}`,
    ],
    [
      'hreflang gap',
      code(site.HREFLANG_PAGE),
      `${code('hreflang_gap')} ${recordOf(b, 'hreflang_gap', site.HREFLANG_PAGE)!.state}`,
    ],
    [
      'duplicate pagination',
      code(site.PAGINATION_SECOND),
      `kind ${code(pageOf(b, site.PAGINATION_SECOND)!.kind)}; fixes ${fixes('duplicate_pagination')}`,
    ],
    [
      'client-rendered template',
      code('/guides/{slug}'),
      `kinds ${site.CLIENT_RENDERED.map((p) => code(pageOf(b, p)!.kind)).join(', ')}; rendered ${site.CLIENT_RENDERED.filter((p) => pageOf(b, p)!.without_js !== null).length}; fixes ${fixes('client_rendered_template')} (see below)`,
    ],
    [
      'blocked by robots.txt',
      code(site.ROBOTS_BLOCKED),
      `verdict ${code(crawler(site.ROBOTS_BLOCKED).verdict)}; fixes ${fixes('robots_txt_blocks_crawler')} (the site's stated intent)`,
    ],
    [
      'refused, with a witness',
      code(site.EDGE_REFUSED),
      `verdict ${code(crawler(site.EDGE_REFUSED).verdict)}; fixes ${fixes('edge_rule_blocks_crawler')}`,
    ],
    ['thin page', code(site.THIN), `kind ${code(pageOf(b, site.THIN)!.kind)}`],
  ];
}

/** The recorded crawl with its homepage redirecting to /home, its links recorded from there. */
function homepageRedirects(batches: readonly BatchResult[]): BatchResult[] {
  const moved = structuredClone(batches) as BatchResult[];
  for (const b of moved) {
    if (b.kind !== 'crawl') continue;
    for (const p of b.pages) if (p.url === HOST) p.final_url = `${HOST}/home`;
    for (const e of b.link_edges) if (e.from_url === HOST) e.from_url = `${HOST}/home`;
  }
  return moved;
}

export function renderBuildSpec(): string {
  const golden = buildCheck(recordedBuild());
  const crawlOnlyOf = (batches: readonly BatchResult[]) =>
    buildCheck({
      ...recordedInput(),
      batches: batches.filter((x) => x.kind === 'crawl'),
      render: null,
    });
  const plain = crawlOnlyOf(readRecorded('batches'));
  const redirected = crawlOnlyOf(homepageRedirects(readRecorded('batches')));
  const grade = (b: BuiltCheck) =>
    `${b.check.technical_seo!.grade} ${b.check.technical_seo!.score}`;
  const undepthed = (b: BuiltCheck) => b.page_results.filter((p) => p.depth === null).length;
  const crawlOnly = (dir: string) =>
    buildCheck({
      ...recordedInput(),
      batches: readRecorded(dir).filter((x) => x.kind === 'crawl'),
      render: null,
    });
  const before = crawlOnly('batches');
  const after = crawlOnly('variant');
  const states = (b: BuiltCheck) =>
    [site.ORPHAN, site.DEEP].map((p) => {
      const r = recordOf(b, p === site.ORPHAN ? 'orphan_pages' : 'deep_pages', p)!;
      // Grades keeps each record as the grade reads it, which leaves `reason` out of the type.
      const reason = 'reason' in r && typeof r.reason === 'string' ? r.reason : null;
      return `${code(p)} ${r.state}${reason ? ` (${code(reason)})` : ''}`;
    });
  const rule = Object.entries(PARTIAL_RULE).map(([reason, r]) => [
    code(reason),
    r.partial ? 'partial' : 'finished',
    r.crawl ? 'yes' : 'no',
    r.why,
  ]);
  return `${[
    '# 20a — The check builder (CC-20a)',
    '> Generated by `pnpm --filter @crawlmouse/engine exec tsx src/v2/build/write-spec.ts` from `packages/engine/src/v2/build/spec.ts`. Do not edit by hand: `src/v2/build/spec.test.ts` fails when this file differs.',
    '`buildCheck` (`packages/engine/src/v2/build`) turns what the crawl worker returned and what the database holds into the rows a finished check writes. It is pure and synchronous: no network, clock, randomness or environment, and the same input gives the same bytes (`serialiseBuilt`). CC-20b runs the worker, the render and the database; it calls `nextCrawlBatch`, `sample` and `renderCandidates` to know what to fetch, and `buildCheck` once the rows are in.',
    '## Input',
    table(
      ['Field', 'What it is'],
      Object.entries(INPUT).map(([k, v]) => [code(k), v]),
    ),
    '## Output',
    table(
      ['Field', 'What it is'],
      Object.entries(OUTPUT).map(([k, v]) => [code(k), v]),
    ),
    'Each contract row is parsed with its schema before it is returned; a row that does not parse throws with the collection, the row and the field.',
    '## Order',
    [
      '1. `readBatches`: parse each batch; keep a batch that arrived twice once, refuse two different results for one batch id, a URL crawled in two batches, a non-canonical URL, and a row from another worker build than `lineage.worker_release`.',
      '2. `assemble`: crawl rows to pages by `outcome`, links, classification, depth, PageRank, coverage and the refusal evidence.',
      '3. Refuse an access test or a render of a page the planners would not have sampled.',
      '4. `detectAccess`, then `detectStructure`, then orphans and their parents onto the pages, then `gradeCheck`, then `detectorOutcomes` (which runs `effectsOf`).',
      "5. The `Check` record, then `diffCheck` with this check's side.",
      '6. Lineage and usage, then validation.',
    ].join('\n'),
    '## Status',
    'A check is `partial` when a batch carries a reason marked partial below, when the crawl planner still has URLs to fetch (`nextCrawlBatch` is not null: the crawl was stopped, or a batch was lost), or when a page the sample planned has no crawler test. The structure detectors read `partial` as "the crawl was cut short" (`detectors/scope.ts` `isTruncated`), so they are told `partial` only for a reason marked as cutting the crawl on a crawl batch, or for a crawl the planner would go on with.',
    table(['Reason', 'Check', 'Cuts the crawl', 'Why'], rule),
    '## The planners',
    table(
      ['Bound', 'Value'],
      [
        ['URLs per crawl batch', `${CRAWL_BATCH_URLS}`],
        [
          'Stage 1',
          `the homepage, up to ${STAGE1_CHALLENGED} challenged pages, then one page per template largest first, to ${STAGE1_TEMPLATES} templates in all; at most ${STAGE1_MAX_PAGES} pages`,
        ],
        [
          'Stage 2',
          `when a scored crawler's verdict on a stage-1 page differs from the homepage's, or a browser control was not served: top ${STAGE2_PICKS.hubs} hubs, ${STAGE2_PICKS.deepest} deepest, ${STAGE2_PICKS.newest} newest by lastmod, then templates round-robin, to ${STAGE2_MAX_PAGES} pages`,
        ],
        ['Coverage `sample_strategy.max_pages`', `${SAMPLE_MAX_PAGES}`],
        [
          'Render candidates',
          `the sampled pages; ${code('maxRenders')} ${FREE_MAX_RENDERS}; open fix templates from client-rendered fixes in ${AWAITING_FIX_STATUSES.map(code).join(', ')}`,
        ],
      ],
    ),
    '## Where the fields come from',
    '### PageResult',
    table(
      ['Field', 'Source'],
      Object.entries(PAGE_FIELDS).map(([k, v]) => [code(k), v]),
    ),
    '### Check',
    table(
      ['Field', 'Source'],
      Object.entries(CHECK_FIELDS).map(([k, v]) => [code(k), v]),
    ),
    '## Lineage and usage',
    table(
      ['Value', 'From'],
      [
        ['`detector_ruleset_version`', `${code(GRADE_VERSION)}, CC-17's ${code('GRADE_VERSION')}`],
        [
          '`crawler_registry_version`',
          `sha256 of ${code('serialiseRegistry(CRAWLER_REGISTRY_V2)')}, synchronously; ${code(golden.lineages.grading.crawler_registry_version)} today`,
        ],
        [
          '`worker_release`',
          "`grading`: null, since no worker grades; `fetching`: the input's `worker_release`",
        ],
        ['`population_version`', "null: SPEC 5.1a's population is not versioned (06b §1)"],
        ['`id`', 'derived from the five values the table keeps unique'],
        ['usage `result`', '`delivered` when either grade has a score, else `withheld`'],
        ['usage `billable`', '`result` is `delivered` (owner ruling)'],
        ['usage `compute_seconds`', "the batches' durations and the render's browser time"],
        ['usage `request_count`', "the batches' requests"],
        ['usage `occurred_at`', "the check's `finished_at`"],
      ],
    ),
    `The detectors that run on a built check, which \`diff_inputs.detectors\` lists: ${DETECTORS_RUN.map(code).join(', ')}.`,
    '## Bounds on the new crawl-row fields',
    `Content features: ${CONTENT_FEATURES_BYTES / 1024} KiB as JSON, ${MAX_JSON_LD_NODES} JSON-LD nodes of ${MAX_JSON_LD_TYPES} types, a type of ${JSON_LD_TYPE_BYTES} UTF-8 bytes as written; past any, the row keeps none and its limitations say so. They count toward the batch's 8 MiB with its text and links. robots.txt is kept whole up to the engine's 500 KiB parse limit, as written; otherwise \`body\` is null and \`body_complete\` false, and the builder reads no robots.txt.`,
    '## Differences from ARCH-2 and ENGINE-GAP',
    ARCH_DIFFERENCES.map((d) => `- ${d}`).join('\n'),
    '## Differences from the brief',
    BRIEF_DIFFERENCES.map((d) => `- ${d}`).join('\n'),
    '## The built-site fixture',
    `${golden.page_results.length} pages crawled in ${readRecorded('batches').filter((x) => x.kind === 'crawl').length} crawl batches, ${golden.check.coverage!.pages_sampled} sampled in ${readRecorded('batches').filter((x) => x.kind === 'access').length} access batches, ${golden.fixes.length} fixes. Recorded from the worker by \`fixtures/v2/build/generate.ts\`.`,
    table(['Planted', 'Where', 'What the built check holds'], defects(golden)),
    '## Signed-off grade changes',
    `Two corrections to what the builder feeds the grade, signed off by the owner (2026-11-06) as input corrections inside \`packages/engine/src/v2/build\`, not a re-curving: v1's \`grade.ts\` and \`graph.ts\`, the v2 grade and the detectors are unchanged.`,
    [
      `- **A redirected page's links count** (\`filing.ts\`). Measured on \`3a39263a\`, the commit before the change: the golden check graded B+ 81.7, and the crawl with its homepage redirecting to \`/home\` graded C+ 69.39 with 59 of 60 pages at no depth. Now, rendered from this code: the golden check grades ${grade(golden)}; the crawl alone grades ${grade(plain)} as recorded and ${grade(redirected)} with the homepage redirecting, with ${undepthed(plain)} and ${undepthed(redirected)} of ${plain.page_results.length} pages at no depth.`,
      "- **Coverage and crawl health** count a stopped redirect's target as unread, leave sitemap seeds of another host out, count a failed request as attempted and leave robots-excluded URLs out. They move a grade only where those cases occur; the recorded fixture has none of them.",
    ].join('\n'),
    '## Found by the built fixture',
    `- **A redirect that lands on a crawled page hides absences.** \`detectors/scope.ts\` files a redirected row's links under the requested URL only when no other row has the final URL; \`grade/effects.ts\` \`linkedStraight\` describes them as filed there anyway. On the fixture's variant (one more link, to ${code(site.REDIRECT_TO)}, so it is crawled as its own page): without it, ${states(before).join(', ')}; with it, ${states(after).join(', ')}. Technical SEO ${before.check.technical_seo!.score} without, ${after.check.technical_seo!.score} with. In the variant both URLs answer 200 with the same content, so v1's duplicate rule keeps the one that sorts first: ${code(site.REDIRECT_FROM)} is ${code(pageOf(after, site.REDIRECT_FROM)!.kind)}, ${code(site.REDIRECT_TO)} is ${code(pageOf(after, site.REDIRECT_TO)!.kind)}. Not settled here.`,
    `- **A client-rendered template leaves the graded population before it can be rendered.** v1's thin-content rule classifies the app-shell pages ${site.CLIENT_RENDERED.map((p) => `${code(p)} as ${code(pageOf(golden, p)!.kind)}`).join(', ')}; CC-14's \`renderable\` (\`packages/engine/src/v2/render/sample.ts:62\`) bars a render candidate that is not a content page, and the thin rule is v1's (\`packages/engine/src/analysis/classify-pages.ts:98\`), so none of them is rendered; the builder's planner offers them (build.test.ts). For CC-20b. No detector opens a ${code('client_rendered_template')} fix yet: ${code('grep -rln client_rendered_template packages/engine/src/v2 --include=*.ts | grep -v test')} lists the planner, the diff's subject table and two specs, and no detector.`,
  ].join('\n\n')}\n`;
}
