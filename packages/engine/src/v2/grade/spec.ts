/**
 * Renders docs/specs/v2/17-content-and-grade.md. The weights and thresholds are read from the modules
 * that use them, the letter scale from scoreToLetter, the label-set counts from the labelled fixture,
 * and the example sites from expected.json. The prose, the counterfactual descriptions and the
 * per-check rule descriptions are written here, and only review checks them against the code.
 * spec.test.ts fails when the file differs from this render.
 */
import { VerdictSchema, type FixType } from '@crawlmouse/types/v2';
import { scoreToLetter } from '../../grade.js';
import { MAX_HEALTHY_DEPTH, MIN_GRADEABLE_PAGES } from '../../constants.js';
import { SIGNAL_TABLE } from '../access/declarations.js';
import { CONTENT_CHECKS } from '../content/checks.js';
import { MIN_PASS_ACCURACY, MIN_PRECISION, tallies, validated } from '../content/label-set.js';
import * as T from '../content/thresholds.js';
import labels from '../../../fixtures/v2/content/labels.json' with { type: 'json' };
import { code, pct, table } from '../detectors/spec.js';
import { STRUCTURE_CLASS } from './outcomes.js';
import { CRAWLABILITY_DETECTORS } from './technical-seo.js';
import { WITHHELD_REASON_MEANINGS } from './withheld.js';
import expected from './expected.json' with { type: 'json' };
import {
  ACCESS_CELL_WEIGHT,
  AI_WEIGHTS,
  DECIMALS,
  GRADE_VERSION,
  MIN_ACCESS_PAGES,
  MIN_MEASURED_CRAWLERS,
  SEO_WEIGHTS,
  SIGNAL_POINTS,
} from './weights.js';

export const SPEC_URL = new URL(
  '../../../../../docs/specs/v2/17-content-and-grade.md',
  import.meta.url,
);

const list = (vs: readonly string[]) => vs.map(code).join(', ');

/** What fixing each type means to the grade inputs (effects.ts applyFix). */
export const COUNTERFACTUALS: Readonly<Record<FixType, string>> = {
  orphan_pages:
    'a link to the page from its `suggested_parent_url`, or from the homepage when it has none',
  deep_pages: `a link to the page from the deepest graded page within ${MAX_HEALTHY_DEPTH - 1} clicks of the homepage (the lowest URL among them), or from the homepage when none is`,
  generic_anchor_text: "the hub's outbound links get descriptive anchors",
  redirect_chain: 'the record becomes `not_detected`',
  canonical_mismatch: 'the record becomes `not_detected`',
  duplicate_pagination: 'the record becomes `not_detected`',
  hreflang_gap: 'the record becomes `not_detected`',
  edge_rule_blocks_crawler: "the crawler's `blocked_by_ua_rule` pages become `allowed`",
  robots_txt_blocks_crawler: 'none: respected intent opens no fix',
  quotable_opening: "the template's failing pages pass the check, when the check counts",
  missing_author_date: "the template's failing pages pass the check, when the check counts",
  specs_as_images: "the template's failing pages pass the check, when the check counts",
  client_rendered_template: 'none yet: the fix type needs rendered pages (CC-14)',
  js_only_navigation: 'none yet: the fix type needs rendered pages (CC-14)',
};

/** What each content check applies to and passes on, said with the constants it reads. */
const CHECK_RULES: Readonly<
  Record<keyof typeof CONTENT_CHECKS, { applies: string; passes: string; shell: string }>
> = {
  direct_answer_150: {
    applies: `a page of prose: an H1 with ${T.MIN_BODY_WORDS} words or more after it, and no \`Product\` JSON-LD`,
    passes: `within the first ${T.OPENING_WORDS} words after the H1, a block that is not a list item and has ${T.MIN_BLOCK_WORDS} words or more holds a sentence of ${T.ANSWER_SENTENCE_WORDS.min} to ${T.ANSWER_SENTENCE_WORDS.max} words ending in a full stop`,
    shell: 'unread',
  },
  question_headings: {
    applies: `a page of prose with ${T.MIN_HEADINGS} section headings or more: an h2 or h3 after the H1 followed by a ${list([...T.PROSE_BLOCKS])} block of ${T.MIN_BLOCK_WORDS} words or more`,
    passes:
      'an h2 or h3 after the H1 has a clause ending in a question mark (`?`, the Arabic `؟`, or the full-width form)',
    shell: 'unread',
  },
  schema_with_description: {
    applies: 'a page with a typed JSON-LD node',
    passes:
      'a node of a type about the page itself (`…Page`, `…Article`, `BlogPosting`, `Product`, `Service`, `Event`, `TouristTrip` and the others in checks.ts) has a non-empty `description`',
    shell: 'unread',
  },
  author_and_date: {
    applies:
      'a page whose JSON-LD has an Article-family node (`og:type=article` alone does not count)',
    passes:
      'an author (JSON-LD `author`, `meta[name=author]`, `rel=author`, `itemprop=author`) and a date (JSON-LD `datePublished` with a four-digit year, `article:published_time`, `itemprop=datePublished`, `time[datetime]`)',
    shell:
      'not applicable without an Article-family node; passes when the markup alone passes; otherwise unread',
  },
  specs_as_text: {
    applies: 'a page with `Product` JSON-LD',
    passes: `fails when an image whose alt text or file name names specifications, and is not a link to another page, is shown with no table or description list and fewer than ${T.MIN_SPEC_LINES} "Label: value" lines with a digit`,
    shell: 'not applicable without `Product` JSON-LD; otherwise unread',
  },
};

function letterScale(): string[][] {
  const rows: string[][] = [];
  let last = '';
  for (let i = 10_000; i >= 0; i--) {
    const letter = scoreToLetter(i / 100);
    if (letter !== last) rows.push([letter, '']);
    rows[rows.length - 1]![1] = (i / 100).toFixed(2);
    last = letter;
  }
  return rows.map(([letter, from]) => [code(letter!), `${from} or more`]);
}

const outOfDenominator = () => VerdictSchema.options.filter((v) => !(v in ACCESS_CELL_WEIGHT));

const share = (n: number, of: number, none: string) =>
  of === 0 ? none : `${pct(n / of)} (${n} of ${of})`;

function tallyTable(t: ReturnType<typeof tallies>): string {
  const rows = (Object.keys(t) as (keyof typeof CONTENT_CHECKS)[]).map((check) => {
    const x = t[check];
    return [
      code(check),
      CONTENT_CHECKS[check].scored ? 'yes' : 'no',
      String(x.labelled),
      String(x.failing),
      share(x.confirmed, x.fires, 'no firing'),
      share(x.passes_confirmed, x.passes, 'no pass'),
      x.failing === 0 ? 'no failing page labelled' : `${x.confirmed} of ${x.failing}`,
    ];
  });
  return table(
    ['Check', 'Counted', 'Labelled', 'Labelled fail', 'Precision', 'Pass accuracy', 'Recall'],
    rows,
  );
}

/** Which counted checks would clear the bar on the labels as first read, said from the tallies. */
function firstReadVerdict(): string {
  const first = tallies(true);
  const counted = (Object.keys(CONTENT_CHECKS) as (keyof typeof CONTENT_CHECKS)[]).filter(
    (c) => CONTENT_CHECKS[c].scored,
  );
  const failing = counted.filter((c) => !validated(first[c]));
  return failing.length === 0
    ? 'On the labels as first read, every counted check also clears the bar.'
    : `On the labels as first read, ${list(failing)} would not clear the bar: the corrections are what let ${failing.length === 1 ? 'it' : 'them'} count.`;
}

function labelSet(): string {
  const all = labels.pages.flatMap((p) => p.corrections);
  const causes = Object.entries(labels.causes).flatMap(([cause, meaning]) => {
    const cs = all.filter((c) => c.cause === cause);
    if (cs.length === 0) return [];
    const checks = [...new Set(cs.map((c) => c.check))].sort().map(code).join(', ');
    return [`- ${cs.length} on ${checks}: ${meaning}.`];
  });
  return [
    `${labels.pages.length} pages from the production audit corpus (\`packages/engine/fixtures/v2/content/labels.json\`).`,
    '',
    '**Who labelled them.** The session that implemented the checks, reading a machine-made text view of each',
    'saved page against the criteria below, not against the rules. The labels are not an independent',
    "person's, and the reviewer checks them against the excerpts. Each page carries its URL, fetch date, the",
    'features `readPage` read, the labels with their reasons, and the sha256 of the excerpt the labels were made',
    "from. The excerpts are other people's text and are not tracked: the set is reproducible from the URLs, as",
    '`fixtures/v2/content/fetch.ts` refetches the pages and `generate.ts` rebuilds the features. The file records',
    "the digest of the reader the features were read with, and labels.test.ts fails when it is not the reader's.",
    '',
    'The criteria, as labels.json carries them:',
    '',
    ...labels.criteria.map((l) => `> ${l}`.trimEnd()),
    '',
    `A check fires when it judges a page \`fail\`. Precision is the share of its firings labelled \`fail\`;`,
    'pass accuracy the share of the pages it judges `pass` that are labelled `pass`; pages labelled `unsure` are',
    `left out. A check counts in Quotable only if it fires, passes, and keeps precision at ${pct(MIN_PRECISION)}`,
    `or more and pass accuracy at ${pct(MIN_PASS_ACCURACY)} or more (labels.test.ts); the others are reported`,
    'and score nothing.',
    '',
    tallyTable(tallies()),
    '',
    `**Corrections.** ${all.length} labels were changed after the first reading, each recorded with its first`,
    'label, its reason and its cause. They were found by reading the pages where a check and a label',
    'disagreed, so they move the counts toward agreement. By cause:',
    '',
    ...causes,
    '',
    'The same counts with the labels as first read:',
    '',
    tallyTable(tallies(true)),
    '',
    firstReadVerdict(),
  ].join('\n');
}

function exampleSites(): string {
  const rows = Object.entries(expected.cases).map(([name, c]) => {
    const ai = c.ai_readability as {
      withheld: boolean;
      total: number | null;
      withheld_reasons: string[];
    };
    return [
      name,
      c.technical_seo.score === null
        ? 'refused'
        : `${c.technical_seo.score} ${c.technical_seo.grade}`,
      ai.withheld ? `withheld: ${list(ai.withheld_reasons)}` : String(ai.total),
      String(c.fixes.length),
      `${c.overview.technical_seo} / ${c.overview.ai_readability ?? 'waits'}`,
    ];
  });
  return table(['Site', 'Technical SEO', 'AI readability', 'Fixes', 'Fixes add (SEO / AI)'], rows);
}

export function renderGradeSpec(): string {
  const contentRows = Object.entries(CONTENT_CHECKS).map(([check, def]) => {
    const rule = CHECK_RULES[check as keyof typeof CONTENT_CHECKS];
    return [
      code(check),
      rule.applies,
      rule.passes,
      rule.shell,
      def.fix === null ? 'none in the contract' : `${code(def.fix)} (${code(`${def.key}:`)})`,
      def.scored ? 'yes' : 'no',
      `${code(def.recommendation_class)}, ${code(def.confidence)}`,
    ];
  });
  const counted = (Object.keys(CONTENT_CHECKS) as (keyof typeof CONTENT_CHECKS)[]).filter(
    (c) => CONTENT_CHECKS[c].scored,
  );
  const uncounted = (Object.keys(CONTENT_CHECKS) as (keyof typeof CONTENT_CHECKS)[]).filter(
    (c) => !CONTENT_CHECKS[c].scored,
  );
  return `${[
    '# SPEC 17 — Content checks, the two v2 grades, and fix effects',
    '',
    '> Generated from `packages/engine/src/v2/grade/spec.ts`; `spec.test.ts` fails when this file differs from',
    '> the render. Regenerate: `pnpm --filter @crawlmouse/engine exec tsx src/v2/grade/write-spec.ts`.',
    '',
    `Grade version: ${code(GRADE_VERSION)} (\`Check.grade_version\`). Grades and components are given to ${DECIMALS} decimal places.`,
    '',
    '## AI readability',
    '',
    table(
      ['Component', 'Max', 'From'],
      [
        [
          'Access',
          String(AI_WEIGHTS.access),
          "the scored crawlers' sampled pages (CC-15's matrix)",
        ],
        [
          'Readable',
          String(AI_WEIGHTS.readable),
          'the share of words served without JavaScript (CC-14)',
        ],
        ['Quotable', String(AI_WEIGHTS.quotable), `the counted content checks: ${list(counted)}`],
        ['Signals', String(AI_WEIGHTS.signals), 'schema.org markup and Content Signals'],
      ],
    ),
    '',
    "The scored crawlers are the registry's `ai_search` group; the `ai_training` group is shown and not scored.",
    '',
    '### Access',
    '',
    `share(c) = Σ weight(verdict) / pages with a weight, over crawler c's sampled pages; Access = ${AI_WEIGHTS.access} × mean of share(c) over the measured scored crawlers.`,
    '',
    table(
      ['Verdict', 'Weight'],
      Object.entries(ACCESS_CELL_WEIGHT).map(([v, w]) => [code(v), String(w)]),
    ),
    '',
    `Out of the denominator: ${list(outOfDenominator())}. Words served are compared with the browser control's words for the same static page, so a page that needs JavaScript reads the same for both and counts in Readable, once.`,
    '',
    `A scored crawler is measured with ${MIN_ACCESS_PAGES} pages or more in its denominator. One that robots.txt disallows on the pages whose rules were read (disallowed pages equal to pages read) is blocked by choice: left out of the mean, so a deliberate block lowers nothing. With fewer than ${MIN_MEASURED_CRAWLERS} measured, Access has no score: \`blocked_by_choice\` when the scored crawlers are blocked by choice and none is measured or unmeasured; otherwise \`too_few_crawlers_measured\`, with the range [${AI_WEIGHTS.access} × Σshare / (m + u), ${AI_WEIGHTS.access} × (Σshare + u) / (m + u)] for m measured and u unmeasured crawlers.`,
    '',
    '### Readable',
    '',
    `ratio(t) = median \`text_share\` of template t's rendered pages; Readable = ${AI_WEIGHTS.readable} × Σ pages(t) × ratio(t) / Σ pages(t) over the graded pages. A template with no rendered page makes it a range, its pages counted at 0 and at 1; no graded page, or none rendered, is [0, ${AI_WEIGHTS.readable}]. Until CC-14 renders pages, \`text_share\` is null, so Readable is unmeasured on a check.`,
    '',
    '### Quotable',
    '',
    `rate(k) = pages passing check k / pages k was decided on; Quotable = ${AI_WEIGHTS.quotable} × mean of rate(k) over the counted checks decided on a page. A check counts once the label set validates it (below); ${list(uncounted)} are reported and do not count. A counted check's graded pages that were not read for it make Quotable a range: rate(k) between passing / (decided + unread) and (passing + unread) / (decided + unread), over each check decided or unread on a page. Nothing decided and nothing unread is the range [0, ${AI_WEIGHTS.quotable}].`,
    '',
    '### Signals',
    '',
    table(
      ['Declaration', 'Points', 'Class'],
      Object.entries(SIGNAL_TABLE).map(([s, d]) => [
        code(s),
        String(SIGNAL_POINTS[s as keyof typeof SIGNAL_POINTS] ?? 0),
        code(d.recommendation_class),
      ]),
    ),
    '',
    'Content Signals: a `Content-Signal:` line in robots.txt naming `search`, `ai-input` or `ai-train` (as a key of its own: at the start of the value or after a space, comma or semicolon) with `yes` or `no`, as a directive or in the comment form Cloudflare writes; robots.txt not read is undecided. schema.org: a graded page carries a typed JSON-LD node; with none marked, it is undecided while a graded page was not fetched, or when there is no graded page. An undecided declaration makes Signals a range.',
    '',
    '### The grade and withholding',
    '',
    'The total is the sum of the four components, given when the four have a score; its letter is the engine scale (v1 `scoreToLetter`). Otherwise the grade is withheld, `withheld_reasons` names each component without a score, and each such component carries its range.',
    '',
    table(['Letter', 'From'], letterScale()),
    '',
    table(
      ['Reason', 'Means'],
      Object.entries(WITHHELD_REASON_MEANINGS).map(([r, m]) => [code(r), m]),
    ),
    '',
    '## Technical SEO',
    '',
    `score = ${SEO_WEIGHTS.structure / 100} × structure + ${SEO_WEIGHTS.crawlability} × crawlability. Structure is v1's grade (packages/engine/src/grade.ts, its components and weights unchanged) of the crawled link graph, 0 to 100, also \`site_structure_score\`. Crawlability is the mean, over the measures that apply, of: crawled URLs answering 200, and for ${list(CRAWLABILITY_DETECTORS)}, the records decided \`not_detected\` of those decided. Title and meta description facts join as one more measure once the crawl worker records them (CC-12d). The refusal is v1's \`decideRefusal\` (SPEC 5.1a), with ${MIN_GRADEABLE_PAGES} graded pages as its floor: a refused grade has no score.`,
    '',
    '## Content checks',
    '',
    `Site chrome (${code(T.CHROME)}) is set aside before a page is read. A page served for JavaScript to fill in is judged as the column "Client-rendered" says. "Counted" is whether the check counts in Quotable.`,
    '',
    table(
      [
        'Check',
        'Applies to',
        'Passes',
        'Client-rendered',
        'Fix (key)',
        'Counted',
        'Class, confidence',
      ],
      contentRows,
    ),
    '',
    `A template's content fix is detected when ${T.TEMPLATE_RULE.DETECT_MIN_PAGES} or more of its decided pages fail and they are ${pct(T.TEMPLATE_RULE.DETECT_SHARE)} or more of them; clear at ${pct(T.TEMPLATE_RULE.CLEAR_SHARE)} or less; indeterminate between (hysteresis), or when a page of the template was not read. An opened content fix is \`info\` (diff/severity.ts).`,
    '',
    '### The label set',
    '',
    labelSet(),
    '',
    '## Fix effects',
    '',
    "Each effect is a counterfactual recompute. Fixes are ranked by their effect applied alone (Technical SEO plus AI readability, larger first; ties by fingerprint). In that order each effect is the grade with it and the fixes above it applied, less the grade without it, so the effects add up to the projected grade less the current one. When two fixes' counterfactuals overlap, the higher-ranked takes the shared change and the lower-ranked shows what remains, which can be 0; no field says which fix took it.",
    '',
    "Technical SEO is 0 when the grade is refused before or after the fix: there is no score to move, and the contract's `Effect.technical_seo` cannot say \"not estimated\" (a reported gap). The AI effect is the change in the component the fix moves: Access for an edge-rule fix, Quotable for a content fix, none for a structure fix. It is null and waits on a reason when that component has no score before or after, when an edge fix's crawler has too few pages for a share (`crawler_too_few_pages`), or when a content fix's check does not count in Quotable (`check_not_scored`). The projected grades leave out fixes on checks that do not count. A link a counterfactual adds carries no anchor text, and anchor diversity leaves it out.",
    '',
    table(
      ['Fix', 'Counterfactual'],
      (Object.entries(COUNTERFACTUALS) as [FixType, string][]).map(([t, c]) => [code(t), c]),
    ),
    '',
    'A structure fix takes its recommendation class from its type; the structure detectors read our own crawl, so its confidence is `likely`:',
    '',
    table(
      ['Structure fix', 'Class'],
      Object.entries(STRUCTURE_CLASS).map(([t, c]) => [code(t), code(c!)]),
    ),
    '',
    '## Example sites (expected.json)',
    '',
    exampleSites(),
    '',
    '## Verify',
    '',
    '```bash',
    'pnpm --filter @crawlmouse/engine exec vitest run src/v2/grade src/v2/content src/v2/diff/severity.test.ts',
    '```',
  ].join('\n')}\n`;
}
