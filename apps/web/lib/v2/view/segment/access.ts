/**
 * The Crawler access segment (Final-Segment) as data: what each crawler got back, section by
 * section, and the raw request and response behind each cell the check kept. Groups follow FACTS
 * I6. A cell carries its verdict; the screen words it from the verdict vocabulary
 * (components/v2/verdicts.ts), which says "blocked" only of the two verdicts that block.
 */
import type {
  AccessCause,
  AccessTest,
  Check,
  CrawlerGroup,
  CrawlerResult,
  EvidenceClass,
  Verdict,
} from '@crawlmouse/types/v2';
import { findCheck } from '../../fixtures';
import { listOf, percent, templateNoun, testedAt, timeOfDay } from '../../format';
import {
  EDGE_METHOD,
  EDGE_SENTENCE,
  isAi,
  isAllowed,
  isBlocked,
  isChallenged,
  keptOutClauses,
  servedAll,
  servedExtent,
  servedOthers,
  meetsEdge,
  clientRenderedTemplates,
} from '../../sentences';
import { capitalise, count, numberWord, plural } from '../../words';
import { accessPill, sampledCoverage, type CoverageView, type DoorView } from '../result';
import { sectionFixes, type SectionFixesView } from './fixes';
import { segmentFrame, type SegmentFrame, type SegmentOptions } from './frame';
import type { ViewDataset } from '../../fixtures';

export interface MatrixCell {
  /** Unique on the page: the crawler and the section ("*" for a cell spanning every section). */
  id: string;
  /** The section's name, for the cell's accessible name. */
  section: string;
  span: number;
  verdict: Verdict;
  evidence: EvidenceClass;
  /**
   * Words the screen puts after the verdict vocabulary's own label (components/v2/verdicts.ts),
   * saying how the verdict is known: "by robots.txt" for a declared allow (FACTS B2).
   */
  qualifier: string | null;
  /** The HTTP status that decided it; null when it rests on robots.txt. */
  status: string | null;
  /** The evidence entry this cell opens; null when the check kept no response for it. */
  evidenceId: string | null;
}

export interface MatrixRow {
  ua: string;
  /** The crawler's verdict over the whole sample. */
  verdict: Verdict;
  /** How sure that verdict is: `likely` at most for one that rests on our own requests (F-156). */
  confidence: CrawlerResult['confidence'];
  cells: MatrixCell[];
  /** "31%", "100%*" (a search engine's own rendering), or "not measured". */
  text: string;
  cause: string;
}

export interface MatrixGroup {
  group: CrawlerGroup;
  title: string;
  note: string;
  rows: MatrixRow[];
}

export interface EvidenceView {
  id: string;
  title: string;
  /** What the response means, said once, from the cause the engine found. */
  caption: string | null;
  request: string;
  response: string;
  /** What this evidence cannot show (the contract's `limitations`). */
  limitations: string[];
}

export interface AccessView {
  frame: SegmentFrame;
  headline: { title: string; pill: DoorView['pill']; body: string };
  tiles: { label: string; value: string; note: string | null }[];
  method: string;
  columns: { key: string; label: string }[];
  groups: MatrixGroup[];
  footnote: string | null;
  evidence: EvidenceView[];
  /** The cell open when the page loads. */
  initial: string | null;
  /** Said where the evidence would be, when the check kept none. */
  noEvidence: string | null;
  /** Said for a selected cell whose response is not in this record. */
  cellWithoutEvidence: string;
  coverage: CoverageView;
  fixes: SectionFixesView;
  keep: { title: string; sub: string } | null;
}

/** FACTS D1: the tag our requests carry after the crawler's own user agent. */
export const OUR_TAG = 'Crawlmouse/2.0 (+https://crawlmouse.com/bot)';

const GROUPS: { group: CrawlerGroup; title: string; note: string }[] = [
  { group: 'search_engine', title: 'Search engines', note: 'by robots.txt, not fetched' },
  { group: 'ai_search', title: 'AI search and answers', note: 'counts towards AI readability' },
  {
    group: 'ai_training',
    title: 'AI training',
    note: 'not scored; blocking these is your choice',
  },
];

/** The matrix's cause column: what the engine found in the way. */
export const CAUSE_SHORT: Record<AccessCause, string> = {
  cloudflare_1020: 'Cloudflare firewall rule (error 1020)',
  bot_fight_mode: 'Bot Fight Mode challenge',
  client_rendered_template: 'client-rendered template',
  robots_txt_disallow: 'Disallow in robots.txt',
  automation_challenge: 'edge challenge on all automation',
  rate_limit_429: 'rate limit (429)',
  pay_per_crawl_402: 'pay per crawl (402)',
  cross_host_redirect: 'redirect to another host',
  verified_bot_only: 'verified IPs only',
};

/** The evidence caption: what the response shows, in the locked screen's form. */
const CAUSE_MEANS: Record<AccessCause, string> = {
  cloudflare_1020: 'error 1020 means a firewall rule on this site blocked the request',
  bot_fight_mode: 'a challenge page in place of the content is what Bot Fight Mode serves',
  client_rendered_template: 'the HTML arrives without its text; a browser draws it with JavaScript',
  robots_txt_disallow: 'robots.txt has a Disallow rule for this crawler',
  automation_challenge: 'the edge challenged our request, with or without a crawler user agent',
  rate_limit_429: '429 means the site limited how fast this crawler may fetch',
  pay_per_crawl_402: '402 means the site asks this crawler to pay to crawl',
  cross_host_redirect: 'the site sent this crawler to another host',
  verified_bot_only: 'nothing we sent claiming to be a crawler was served',
};

/**
 * `automation_challenge` is the worker's cause for two verdicts: an edge that challenges every
 * automated request (`edge_blocks_automation`), and a challenge of one crawler's requests
 * (`challenged_ua`), where the same page asked for with a browser identity may have been served.
 * The two tables above word the first. These word the second from the rows themselves.
 */
const CHALLENGED_UA_SHORT = 'edge challenge of this crawler';

const challengedAsCrawler = (r: { verdict: Verdict; cause: AccessCause | null }) =>
  r.verdict === 'challenged_ua' && r.cause === 'automation_challenge';

/**
 * What a challenged crawler's response shows, with the control fetch of the same page beside it
 * when the record holds one that was served. Of a control row that was not served the caption says
 * nothing: its verdict does not say what the browser identity got back.
 */
function challengedCaption(control: AccessTest | undefined): string {
  const challenged = 'the edge challenged the request made as this crawler';
  if (!control || !isAllowed(control.verdict)) return challenged;
  const status = control.raw_status === null ? '' : ` (status ${control.raw_status})`;
  return `${challenged}; the same page asked for with a browser identity, untagged, was served${status}`;
}

const SEARCH_ENGINE_CAUSE = 'verified-bot response not testable from outside';

const FOOTNOTE =
  '* Google and Bing render JavaScript; the text share is what a browser renders. Connect Search Console to see Google’s own fetches.';

/** FACTS B2: a crawler allowed by robots.txt alone is said to be, not merely "allowed". */
/**
 * A refusal verdict whose status was a 404 or 410 says that status (F-152). Display only: the verdict
 * and its weight are unchanged until PR 7's panel.
 */
const answeredGone = (verdict: Verdict, status: number | null | undefined) =>
  (verdict === 'blocked_by_ua_rule' || verdict === 'refused_unverified') &&
  (status === 404 || status === 410)
    ? `(answered ${status} to our request)`
    : null;

const qualifierOf = (verdict: Verdict, evidence: EvidenceClass) =>
  verdict === 'allowed' && evidence === 'declared' ? 'by robots.txt' : null;

function evidenceView(
  t: AccessTest,
  section: string,
  control: AccessTest | undefined,
): EvidenceView {
  const who = t.ua ?? 'Browser identity';
  const status = t.raw_status === null ? 'No response' : `Status ${t.raw_status}`;
  const moved = t.final_url && t.final_url !== t.page_url ? [`Final URL: ${t.final_url}`] : [];
  return {
    id: t.id,
    title: `Evidence · ${who} · ${section} · ${timeOfDay(t.tested_at)}`,
    caption: challengedAsCrawler(t)
      ? challengedCaption(control)
      : t.cause
        ? CAUSE_MEANS[t.cause]
        : null,
    request: [t.page_url, ...t.request_headers.map((h) => `${h.name}: ${h.value}`)].join('\n'),
    response: [
      status,
      ...moved,
      ...t.headers.map((h) => `${h.name}: ${h.value}`),
      ...(t.body_excerpt ? ['', t.body_excerpt] : []),
    ].join('\n'),
    limitations: t.limitations,
  };
}

/** "Requests as one of six AI crawlers were refused by user agent, and one was challenged." */
function headlineTitle(check: Check): string {
  const ai = check.crawlers.filter(isAi);
  if (meetsEdge(check)) return `${EDGE_SENTENCE}.`;
  const n = (keep: (v: Verdict) => boolean) => ai.filter((c) => keep(c.verdict)).length;
  const unmeasured = (v: Verdict) => v === 'not_measured';
  const is = (x: Verdict) => (v: Verdict) => v === x;
  // `request`: the fact is about a request we sent, so a first clause says so. A robots.txt rule is
  // what the site declares, and an unmeasured crawler got no answer to report.
  const kinds: [n: number, one: string, many: string, request: boolean][] = [
    [n(is('disallowed_by_robots')), 'is blocked by robots.txt', 'are blocked by robots.txt', false],
    [n(is('blocked_by_ua_rule')), 'was refused by user agent', 'were refused by user agent', true],
    [
      n(is('refused_unverified')),
      'was refused on pages where no other crawler name was served',
      'were refused on pages where no other crawler name was served',
      true,
    ],
    [n(is('challenged_ua')), 'was challenged', 'were challenged', true],
    [
      n((v) => !isAllowed(v) && !isBlocked(v) && !isChallenged(v) && !unmeasured(v)),
      'was not served',
      'were not served',
      true,
    ],
    [n(unmeasured), 'was not measured', 'were not measured', false],
  ];
  const present = kinds.filter(([n]) => n > 0);
  if (!present.length) return `${servedAll(ai.length, 'AI')}${servedExtent(check)}.`;
  const clauses = present.map(([n, one, many, request], i) =>
    i === 0
      ? request
        ? `Requests as ${numberWord(n)} of ${numberWord(ai.length)} AI crawlers ${many}`
        : `${capitalise(numberWord(n))} of ${numberWord(ai.length)} AI crawlers ${n === 1 ? one : many}`
      : request && !present[0]![3]
        ? `requests as ${numberWord(n)} ${many}`
        : `${numberWord(n)} ${n === 1 ? one : many}`,
  );
  return clauses.length === 1
    ? `${clauses[0]}.`
    : `${clauses.slice(0, -1).join(', ')}, and ${clauses.at(-1)}.`;
}

function headlineBody(check: Check): string {
  const ai = check.crawlers.filter(isAi);
  const search = check.crawlers.filter((c) => !isAi(c));
  const allowed = ai.filter((c) => isAllowed(c.verdict));
  const edge = meetsEdge(check);
  const out = keptOutClauses(edge ? ai.filter((c) => c.verdict !== 'edge_blocks_automation') : ai);
  const thin = (clientRenderedTemplates(check) ?? []).map(
    (k) => templateNoun(check.coverage!.templates.find((t) => t.template_key === k)!.label).pages,
  );
  const readers = allowed.filter((c) => c.verdict === 'allowed_thin').map((c) => c.ua);
  const parts: string[] = [];
  if (edge) {
    parts.push(EDGE_METHOD);
  }
  if (out.length) parts.push(`${capitalise(out.join('; '))}.`);
  if (allowed.length) {
    const who = `${allowed.length === ai.length ? servedAll(ai.length, 'AI') : servedOthers(allowed.length)}${servedExtent(check)}`;
    parts.push(
      thin.length && readers.length
        ? `${who}; ${listOf(readers)} then read ${listOf(thin)} empty without JavaScript, covered in the next section.`
        : `${who}.`,
    );
  }
  if (search.length)
    parts.push(
      search.every((c) => c.verdict === 'allowed')
        ? `${listOf(search.map((c) => c.ua))} ${plural(search.length, 'is', 'are')} allowed by robots.txt.`
        : `${capitalise(keptOutClauses(search).join('; '))}.`,
    );
  if (check.tested_at) parts.push(`Tested ${testedAt(check.tested_at)}.`);
  return parts.join(' ');
}

/** Every crawler's verdict says the edge stopped or nothing measured it: no crawler request counted. */
const noCrawlerRequest = (ai: readonly CrawlerResult[]): boolean =>
  ai.some((c) => c.verdict === 'edge_blocks_automation') &&
  ai.every((c) => c.verdict === 'edge_blocks_automation' || c.verdict === 'not_measured');

/** FACTS D1, with the L5 correction; the exact-string variant when the evidence carries no tag. */
function methodSentence(tests: readonly AccessTest[], rendered: boolean): string {
  const crawlerTests = tests.filter((t) => t.ua !== null && t.source_ip_class === 'fly_egress');
  const exact =
    crawlerTests.length > 0 && crawlerTests.every((t) => !t.identity_sent.includes(OUR_TAG));
  const stated = exact
    ? 'We request a sampled page with the crawler’s exact user agent from Crawlmouse’s address, not the operator’s, only where our browser-identity control gets a normal answer and robots.txt allows that crawler.'
    : `We request a sampled page with the crawler’s own user agent, tagged “${OUR_TAG}”, from Crawlmouse’s own address, not the operator’s, only where our browser-identity control gets a normal answer and robots.txt allows that crawler. A rule matching the exact string will not fire on it, and a site that verifies crawler addresses may refuse it while serving the real crawler.`;
  const render = rendered ? ' Rendering requests come from Cloudflare Browser Rendering.' : '';
  return `${stated}${render} One untagged browser-identity control fetch per sampled page is part of the method. Select a cell to see the raw request and response.`;
}

function rowOf(
  c: CrawlerResult,
  columns: { key: string; label: string }[],
  sectionName: (key: string) => string,
  testFor: (ua: string, key: string) => AccessTest | undefined,
): MatrixRow {
  const search = c.group === 'search_engine';
  const cells: MatrixCell[] = search
    ? [
        {
          id: `${c.ua}|*`,
          section: 'every section',
          span: columns.length,
          verdict: c.verdict,
          evidence: c.evidence_class,
          qualifier: qualifierOf(c.verdict, c.evidence_class),
          status: null,
          evidenceId: testFor(c.ua, '/robots.txt')?.id ?? null,
        },
      ]
    : columns.map((col) => {
        const t = c.by_template.find((x) => x.template_key === col.key);
        const verdict = t?.verdict ?? 'not_measured';
        return {
          id: `${c.ua}|${col.key}`,
          section: sectionName(col.key),
          span: 1,
          verdict,
          evidence: c.evidence_class,
          qualifier: answeredGone(verdict, t?.status) ?? qualifierOf(verdict, c.evidence_class),
          status: t?.status == null ? null : String(t.status),
          evidenceId: testFor(c.ua, col.key)?.id ?? null,
        };
      });
  const footnoted = search && c.verdict === 'allowed';
  return {
    ua: c.ua,
    verdict: c.verdict,
    confidence: c.confidence,
    cells,
    text:
      c.text_share === null ? 'not measured' : `${percent(c.text_share)}%${footnoted ? '*' : ''}`,
    cause: footnoted
      ? SEARCH_ENGINE_CAUSE
      : challengedAsCrawler(c)
        ? CHALLENGED_UA_SHORT
        : c.cause
          ? CAUSE_SHORT[c.cause]
          : '—',
  };
}

export function accessView(
  d: ViewDataset,
  checkId: string,
  options: SegmentOptions = {},
): AccessView {
  const check = findCheck(d, checkId);
  const coverage = check.coverage;
  if (!coverage)
    throw new Error(`Check ${check.id} has no coverage; the segments show graded checks`);
  const frame = segmentFrame(d, checkId, 'access', options);
  const templates = coverage.templates;
  const columns = templates.map((t) => ({
    key: t.template_key,
    label: t.template_key === '/' ? t.label : `${t.label} · ${count(t.pages)}`,
  }));
  const sectionName = (key: string) =>
    key === '/robots.txt'
      ? 'robots.txt'
      : templateNoun(templates.find((t) => t.template_key === key)!.label).inList;
  const tests = d.access_tests.filter((t) => t.check_id === check.id);
  const testFor = (ua: string, key: string) =>
    tests.find((t) => t.ua === ua && t.template_key === key);
  const groups = GROUPS.map((g) => ({
    ...g,
    rows: check.crawlers
      .filter((c) => c.group === g.group)
      .map((c) => rowOf(c, columns, sectionName, testFor)),
  })).filter((g) => g.rows.length > 0);
  const cells = groups.flatMap((g) => g.rows.flatMap((r) => r.cells));
  const shown = new Set(cells.map((c) => c.evidenceId).filter(Boolean));
  const evidence = tests
    .filter((t) => shown.has(t.id))
    .map((t) =>
      evidenceView(
        t,
        sectionName(t.template_key),
        tests.find((x) => x.identity_role === 'control' && x.page_url === t.page_url),
      ),
    );
  const blocked = cells.find(
    (c) =>
      c.evidenceId && (c.verdict === 'disallowed_by_robots' || c.verdict === 'blocked_by_ua_rule'),
  );
  const initial = (blocked ?? cells.find((c) => c.evidenceId))?.id ?? null;
  const withheld = d.withheld.find(
    (w) => w.check_id === check.id && w.collection === 'access_tests',
  );
  const ai = check.crawlers.filter(isAi);
  const fixes = sectionFixes(d, check, 'crawler_access', options.plan);
  return {
    frame,
    headline: { title: headlineTitle(check), pill: accessPill(check), body: headlineBody(check) },
    tiles: [
      {
        label: 'AI crawlers tested',
        value: String(ai.length),
        note: `${ai.filter((c) => c.scored).length} scored`,
      },
      {
        label: 'Pages sampled per crawler',
        value: `${count(coverage.pages_sampled)} of ${count(coverage.pages_discovered)}`,
        note: noCrawlerRequest(ai)
          ? 'no crawler request was measured'
          : coverage.sample_strategy.method === 'census'
            ? coverage.pages_sampled === coverage.pages_discovered
              ? 'every page'
              : 'every page crawled'
            : `at most ${coverage.sample_strategy.max_pages}, across every template`,
      },
      {
        label: 'Responses kept as evidence',
        value: count(withheld?.total ?? tests.length),
        note: null,
      },
    ],
    method: methodSentence(tests, check.without_js !== null),
    columns,
    groups,
    footnote: groups.some((g) => g.rows.some((r) => r.text.endsWith('*'))) ? FOOTNOTE : null,
    evidence,
    initial,
    noEvidence: evidence.length ? null : 'This audit kept no raw responses to show.',
    cellWithoutEvidence: withheld
      ? `This record holds ${count(withheld.included)} of the ${count(withheld.total)} responses the audit kept, and this cell’s is not one of them.`
      : 'The audit kept no response for this cell.',
    coverage: sampledCoverage(d, check),
    fixes,
    keep: frame.keptUntil
      ? {
          title: `Keep this audit: an email when access changes for any of these ${numberWord(ai.length)} AI crawlers, and every fix for 14 days.`,
          sub: `One email creates a free account that re-checks monthly, with 14 days of Pro to start, including CSV and PDF export. Otherwise this page expires ${frame.keptUntil}.`,
        }
      : null,
  };
}
