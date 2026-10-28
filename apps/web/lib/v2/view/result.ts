/**
 * The Result (overview) screen as data, built from one check of a contract fixture. Every number
 * and every sentence about the site comes from the fixture; the copy that is the same for every
 * site (headings, the Pro pitch, the keep bar) lives in the component.
 */
import {
  SignalKindSchema,
  instant,
  scoredCrawlersMeasured,
  type Check,
  type CrawlerResult,
  type Fix,
  type FixSection,
  type FixtureDataset,
  type SignalKind,
} from '@crawlmouse/types/v2';
import { findCheck, fixesAsOf, siteOf } from '../fixtures';
import { dateTimeUtc, dayTimeUtc, listOf, percent, templateNoun } from '../format';
import { toneOf } from '../letters';
import type { LayoutNode, Point } from '../map-layout';
import {
  EDGE_PILL,
  EDGE_SENTENCE,
  aiSummary,
  aiWithheldSummary,
  isAi,
  isAllowed,
  isBlocked,
  isChallenged,
  keptOutClauses,
  meetsEdge,
  seoSummary,
  thinTemplates,
} from '../sentences';
import { capitalise, count, numberWord, plural } from '../words';

export interface GradeView {
  label: string;
  letter: string | null;
  score: number | null;
  tone: 'default' | 'bad';
  withheld: boolean;
  summary: string;
}

export interface CoverageView {
  tested: number;
  total: number;
  groups: number;
}

/** A door's pill tone. The same names as the StatusPill states, so the screen passes it straight on. */
export type PillState = 'ok' | 'warn' | 'bad' | 'unverified' | 'neutral';

export interface DoorView {
  title: string;
  pill: { state: PillState; label: string };
  bar?: { percent: number; tone: 'bad' | 'warn' | 'neutral' };
  body: string;
  footer: string;
  /** Null for a door that measures the site, not its pages; the reason is in `coverageNote`. */
  coverage: CoverageView | null;
  href: string;
  keep?: boolean;
}

export interface FixRowView {
  key: string;
  title: string;
  scope: string | null;
  points: string;
  open: boolean;
  count: number;
  href: string;
}

export interface CrawlerRowView {
  ua: string;
  group: string;
  verdict: CrawlerResult['verdict'];
  evidence: CrawlerResult['evidence_class'];
  status: string;
  text: string;
}

export interface ResultView {
  state: 'result';
  variant: 'issues' | 'clean' | 'withheld';
  domain: string;
  crawledLine: string;
  crawledAt: string;
  /** When an unkept result expires, as a timestamp; null once kept. */
  keptUntil: string | null;
  grades: [GradeView, GradeView];
  /** The third card: the one fix to make today, or what keeps a clean site clean. */
  first:
    | { kind: 'fix'; title: string; body: string; href: string }
    | { kind: 'all-clear'; body: string };
  doors: DoorView[];
  fixes: { total: number; open: number; pro: number; rows: FixRowView[] } | null;
  crawlers: CrawlerRowView[] | null;
  map: {
    pages: number;
    links: number;
    orphans: number;
    nodes: LayoutNode[];
    positions: Record<string, Point>;
  };
}

export type ResultPageView =
  | ResultView
  | { state: 'loading' }
  | { state: 'empty'; domain: string; queuedAt: string }
  | { state: 'error'; domain: string; failedAt: string; reason: string }
  | { state: 'expired'; domain: string; expiredAt: string; crawledAt: string };

/** FACTS: anonymous audits are visible for 24 hours. Used only to show an audit as it was before it was kept. */
export const ANONYMOUS_VISIBLE_MS = 24 * 60 * 60 * 1000;

/** How many fixes the Free plan opens per audit (FACTS Tiers: "3 fixes per audit"). */
export const FREE_FIXES = 3;

const SECTIONS: Record<string, FixSection> = {
  access: 'crawler_access',
  withoutJs: 'without_js',
  structure: 'structure',
  content: 'content',
};

const SIGNAL_NAMES: Record<SignalKind, string> = {
  schema_org: 'Schema',
  content_signals: 'Content Signals',
  web_bot_auth: 'Web Bot Auth',
  llms_txt: 'llms.txt',
  mcp_server_card: 'MCP server card',
  markdown_negotiation: 'markdown negotiation',
  agent_skills_index: 'agent skills index',
};

function grade(
  check: Check,
  fixes: readonly Fix[],
  isOpen: (f: Fix) => boolean,
): [GradeView, GradeView] {
  const t = check.technical_seo!;
  const ai = check.ai_readability!;
  return [
    {
      label: 'Technical SEO',
      letter: t.grade,
      score: t.score,
      tone: t.grade ? toneOf(t.grade) : 'default',
      withheld: t.grade === null,
      summary: seoSummary(check, fixes, isOpen),
    },
    ai.withheld
      ? {
          label: 'AI readability',
          letter: null,
          score: null,
          tone: 'default',
          withheld: true,
          summary: aiWithheldSummary(check, scoredCrawlersMeasured(check.crawlers)),
        }
      : {
          label: 'AI readability',
          letter: ai.grade,
          score: ai.total,
          tone: toneOf(ai.grade),
          withheld: false,
          summary: aiSummary(check),
        },
  ];
}

/** "1 fix open · 7 on Pro", or "nothing to fix". */
function fixCount(fixes: readonly Fix[], section: FixSection, isOpen: (f: Fix) => boolean) {
  const here = fixes.filter((f) => f.section === section);
  if (!here.length) return 'nothing to fix';
  const open = here.filter(isOpen).length;
  const pro = here.length - open;
  return [
    open ? `${open} ${plural(open, 'fix', 'fixes')} open` : null,
    pro ? `${pro} on Pro` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function accessDoor(
  check: Check,
  fixes: readonly Fix[],
  isOpen: (f: Fix) => boolean,
  coverage: CoverageView,
): DoorView {
  const ai = check.crawlers.filter(isAi);
  const search = check.crawlers.filter((c) => !isAi(c));
  const allowed = ai.filter((c) => isAllowed(c.verdict));
  const edge = meetsEdge(check);
  const blocked = ai.filter((c) => isBlocked(c.verdict)).length;
  const challenged = ai.filter((c) => isChallenged(c.verdict)).length;
  const kept = ai.length - allowed.length;
  const pill: DoorView['pill'] = edge
    ? { state: 'bad', label: EDGE_PILL }
    : kept === 0
      ? { state: 'ok', label: `${ai.length} of ${ai.length} allowed` }
      : {
          state: blocked ? 'bad' : 'unverified',
          label: [
            blocked ? `${blocked} blocked` : null,
            challenged ? `${challenged} challenged` : null,
            kept - blocked - challenged ? `${kept - blocked - challenged} kept out` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        };
  const searchLine = search.every((c) => c.verdict === 'allowed')
    ? `${listOf(search.map((c) => c.ua))} ${plural(search.length, 'is', 'are')} allowed by robots.txt.`
    : `${keptOutClauses(search).join('; ')}.`;
  // The edge is said once, not per crawler.
  const out = keptOutClauses(edge ? ai.filter((c) => c.verdict !== 'edge_blocks_automation') : ai);
  const body = edge
    ? `${EDGE_SENTENCE} from our published IPs, tagged or not, so what the crawlers themselves get could not be measured.${out.length ? ` ${capitalise(out.join('; '))}.` : ''}`
    : kept === 0
      ? `All ${numberWord(ai.length)} AI crawlers get in. ${searchLine}`
      : `${capitalise(out.join('; '))}. The other ${numberWord(allowed.length)} AI crawlers get in; ${searchLine}`;
  return {
    title: 'Crawler access',
    pill,
    bar: { percent: Math.round((kept / ai.length) * 100), tone: 'bad' },
    body,
    footer: `${ai.length} AI crawlers (${ai.filter((c) => c.scored).length} scored), ${search.length} search engines by robots.txt · ${fixCount(fixes, SECTIONS.access!, isOpen)}`,
    coverage,
    href: '#',
  };
}

function withoutJsDoor(
  check: Check,
  fixes: readonly Fix[],
  isOpen: (f: Fix) => boolean,
  coverage: CoverageView,
): DoorView {
  const share = check.without_js!.site_text_share;
  const templates = check.coverage!.templates;
  const thin = thinTemplates(check, check.crawlers.filter(isAi));
  const edge = meetsEdge(check);
  const label = (key: string) => templates.find((t) => t.template_key === key)!.label;
  let body: string;
  if (edge) {
    body = `Measured with a rendering browser: ${percent(share)}% of the text is in the HTML before JavaScript runs.`;
  } else if (thin.length) {
    const thinPages = templates
      .filter((t) => thin.includes(t.template_key))
      .reduce((n, t) => n + t.pages, 0);
    const fine = templates
      .filter((t) => !thin.includes(t.template_key))
      .map((t) => templateNoun(t.label).inList);
    body = `The ${listOf(thin.map((k) => templateNoun(label(k)).adjective))} ${plural(thin.length, 'template renders', 'templates render')} client-side, so ${count(thinPages)} pages are near-empty to any bot that doesn't run scripts.${fine.length ? ` ${capitalise(listOf(fine))} ${fine.length === 1 ? 'is' : 'are'} fine.` : ''}`;
  } else {
    body = `Every template ships its text: ${percent(share)}% of what a browser shows is there without JavaScript.`;
  }
  return {
    title: 'Readable without JavaScript',
    pill: { state: share >= 0.9 ? 'ok' : 'warn', label: `${percent(share)}% of text` },
    bar: { percent: percent(share), tone: share >= 0.9 ? 'neutral' : 'warn' },
    body,
    footer: `Every page with Pro · ${fixCount(fixes, SECTIONS.withoutJs!, isOpen)}`,
    coverage,
    href: '#',
  };
}

function structureDoor(check: Check, fixes: readonly Fix[], isOpen: (f: Fix) => boolean): DoorView {
  const s = check.structure!;
  const raw = check.technical_seo!.site_structure_score;
  const score = raw === null ? null : Math.round(raw);
  const problems = [
    s.orphan_pages
      ? `${numberWord(s.orphan_pages)} orphan ${plural(s.orphan_pages, 'page', 'pages')}`
      : null,
    s.pages_deeper_than_3
      ? `${numberWord(s.pages_deeper_than_3)} ${plural(s.pages_deeper_than_3, 'page', 'pages')} deeper than three clicks`
      : null,
    s.generic_anchor_share >= 0.25 ? 'anchor text that repeats' : null,
  ].filter(Boolean) as string[];
  const lead = problems.length
    ? `${capitalise(problems.join(', '))}.`
    : 'No orphan pages, every page within three clicks, varied anchor text.';
  const hubs = `${capitalise(numberWord(s.hubs))} ${plural(s.hubs, 'hub carries', 'hubs carry')} ${percent(s.hub_pagerank_share)}% of the site's PageRank.`;
  const crawled = check.coverage!.pages_crawled;
  return {
    title: 'Site structure',
    pill: { state: 'neutral', label: score === null ? 'not graded' : `${score} / 100` },
    ...(score === null ? {} : { bar: { percent: score, tone: 'neutral' as const } }),
    body: `${lead} ${hubs}`,
    footer: `Link map, ${count(crawled)} nodes · ${fixCount(fixes, SECTIONS.structure!, isOpen)}`,
    coverage: {
      tested: crawled,
      total: check.coverage!.pages_discovered,
      groups: check.coverage!.templates.length,
    },
    href: '#',
  };
}

function contentDoor(check: Check, fixes: readonly Fix[], isOpen: (f: Fix) => boolean): DoorView {
  const footer = `Per-page structure score · ${fixCount(fixes, SECTIONS.content!, isOpen)}`;
  const content = check.content;
  if (!content) {
    return {
      title: 'Content an answer engine can quote',
      pill: { state: 'neutral', label: 'not measured' },
      body: meetsEdge(check)
        ? `${EDGE_SENTENCE}, so whether the pages open with a quotable answer could not be measured.`
        : 'Whether the pages open with a quotable answer was not measured in this audit.',
      footer,
      coverage: null,
      href: '#',
    };
  }
  const templates = check.coverage!.templates;
  const nounOf = (key: string) =>
    templateNoun(templates.find((t) => t.template_key === key)!.label).pages;
  const byCheck = (name: string) => content.checks.find((c) => c.check === name)?.by_template ?? [];
  const rate = (r: { passing: number; total: number }) => (r.total ? r.passing / r.total : 0);

  const answers = byCheck('direct_answer_150');
  const good = answers.filter((r) => rate(r) >= 0.75).map((r) => nounOf(r.template_key));
  const poor = answers.filter((r) => rate(r) < 0.25).map((r) => nounOf(r.template_key));
  const answerSentence = !answers.length
    ? null
    : !poor.length && good.length === answers.length
      ? 'Every template answers its title in the first paragraph.'
      : `${capitalise(listOf(good))} answer their titles in the first paragraph${poor.length ? `; ${listOf(poor)} don't` : ''}.`;

  const questions = byCheck('question_headings');
  const qRate = questions.length
    ? questions.reduce((n, r) => n + r.passing, 0) / questions.reduce((n, r) => n + r.total, 0)
    : null;
  const questionSentence =
    qRate === null
      ? null
      : qRate < 0.25
        ? 'Few headings are phrased as questions.'
        : qRate < 0.75
          ? 'Some headings are phrased as questions.'
          : 'Most headings are phrased as questions.';

  const schema = byCheck('schema_with_description');
  const schemaAll = schema.length && schema.every((r) => r.passing === r.total);
  const schemaSentence = !schema.length
    ? null
    : schemaAll
      ? 'Schema is present on every template.'
      : `Schema is present on ${listOf(schema.filter((r) => r.passing === r.total).map((r) => nounOf(r.template_key)))}.`;

  // Pages the content checks evaluated: for each template, the largest total any check reports.
  const measured = templates.reduce(
    (n, t) =>
      n +
      Math.max(
        0,
        ...content.checks.map(
          (c) => c.by_template.find((r) => r.template_key === t.template_key)?.total ?? 0,
        ),
      ),
    0,
  );
  return {
    title: 'Content an answer engine can quote',
    pill: { state: content.score >= 80 ? 'ok' : 'warn', label: `${content.score} / 100` },
    bar: { percent: content.score, tone: content.score >= 80 ? 'neutral' : 'warn' },
    body: [answerSentence, questionSentence, schemaSentence].filter(Boolean).join(' '),
    footer,
    coverage: {
      tested: measured,
      total: check.coverage!.pages_discovered,
      groups: templates.length,
    },
    href: '#',
  };
}

function signalsDoor(check: Check): DoorView {
  const kinds = SignalKindSchema.options;
  const by = (state: string) => check.signals.filter((s) => s.state === state);
  const present = by('detected');
  const absent = by('not_detected');
  const unknown = by('indeterminate');
  const unchecked = kinds.length - check.signals.length;
  // "2 of 7 present" counts what is known present; a kind the check did not record is said apart.
  const label =
    unchecked === 0
      ? `${present.length} of ${kinds.length} present`
      : `${present.length} present · ${unchecked} not checked`;
  const names = (xs: { signal: SignalKind }[]) => xs.map((s) => SIGNAL_NAMES[s.signal]);
  const counting = check.signals.filter((s) => s.counts_toward_grade);
  // What could not be tested is said in the check's own words, grouped where the words agree.
  const untested = new Map<string, string[]>();
  for (const s of unknown)
    untested.set(s.evidence, [...(untested.get(s.evidence) ?? []), SIGNAL_NAMES[s.signal]]);
  const body = [
    present.length
      ? `${listOf(names(present))} ${present.length === 1 ? 'is' : 'are'} there.`
      : null,
    absent.length
      ? `${capitalise(
          names(absent)
            .map((n) => `no ${n}`)
            .join(', '),
        )}.`
      : null,
    ...[...untested].map(([evidence, ns]) => `${listOf(ns)}: ${evidence}.`),
    counting.length
      ? `${listOf(names(counting))} count; the other ${numberWord(kinds.length - counting.length)} do not yet.`
      : null,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    title: 'Agent-readiness signals',
    pill: { state: 'neutral', label },
    bar: { percent: Math.round((present.length / kinds.length) * 100), tone: 'neutral' },
    body,
    footer: 'Checked by fetch · nothing urgent',
    coverage: null,
    href: '#',
  };
}

function changesDoor(check: Check, kept: boolean, cadence: string | null): DoorView {
  if (check.previous_check_id !== null) throw new Error('Only a first audit is shown here');
  if (kept) {
    return {
      title: 'What changed since last time',
      pill: { state: 'neutral', label: 'first audit' },
      body: 'Each re-check shows its diff here: pages added or lost, crawlers newly blocked, templates that broke.',
      footer: cadence ? `Re-checked ${cadence}` : 'No re-check scheduled',
      coverage: null,
      href: '#',
    };
  }
  return {
    title: 'What changed since last time',
    pill: { state: 'neutral', label: 'first audit' },
    body: 'Keep this audit and we re-run it monthly and show the diff here: pages added or lost, crawlers newly blocked, templates that broke.',
    footer: 'Keeping it takes one email',
    coverage: null,
    href: '#keep',
    keep: true,
  };
}

/** "+24 AI" when the fix moves AI readability, otherwise "+4 SEO". */
function points(f: Fix): string {
  return f.effect.ai_readability
    ? `+${f.effect.ai_readability} AI`
    : `+${f.effect.technical_seo} SEO`;
}

/** What changes, from the causes behind the fix's crawlers: "A firewall rule and one bot setting". */
const CHANGE_FOR_CAUSE: Partial<Record<NonNullable<CrawlerResult['cause']>, string>> = {
  cloudflare_1020: 'a firewall rule',
  bot_fight_mode: 'one bot setting',
  robots_txt_disallow: 'one robots.txt rule',
  automation_challenge: 'one edge setting',
  verified_bot_only: 'one edge setting',
};

function fixFirstBody(check: Check, f: Fix): string {
  const causes = [
    ...new Set(
      f.crawler_uas
        .map((ua) => check.crawlers.find((c) => c.ua === ua)?.cause)
        .map((c) => (c ? CHANGE_FOR_CAUSE[c] : undefined))
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  const effort = !f.effort
    ? null
    : f.effort.kind === 'minutes'
      ? `about ${numberWord(f.effort.minutes)} minutes`
      : `${numberWord(f.effort.templates)} ${plural(f.effort.templates, 'template', 'templates')}, ${numberWord(f.effort.deploys)} ${plural(f.effort.deploys, 'deploy', 'deploys')}`;
  const what = [causes.length ? listOf(causes) : null, effort].filter(Boolean).join(', ');
  const ai = check.ai_readability!;
  const seo = check.technical_seo!.score;
  const effect = f.effect.ai_readability
    ? ai.withheld
      ? `AI readability is graded once two scored crawlers can be measured.`
      : `AI readability ${ai.total} → ${Math.min(100, ai.total + f.effect.ai_readability)}, estimated.`
    : seo === null
      ? 'Technical SEO is not graded for this audit, so no change to it is estimated.'
      : `Technical SEO ${seo} → ${Math.min(100, seo + f.effect.technical_seo)}, estimated.`;
  return `${what ? `${capitalise(what)}. ` : ''}${effect} The steps and the evidence are open, free.`;
}

function fixRows(fixes: readonly Fix[]): FixRowView[] {
  const open = fixes.slice(0, FREE_FIXES);
  const named = fixes.slice(FREE_FIXES, FREE_FIXES + 2);
  const rest = fixes.slice(FREE_FIXES + 2);
  const row = (f: Fix, isOpen: boolean): FixRowView => ({
    key: f.id,
    title: f.title,
    // A fix to a whole template says how many pages share it, unless its title already counts them.
    scope:
      f.template_key && !/\d/.test(f.title)
        ? `${count(f.affected_pages)} ${plural(f.affected_pages, 'page', 'pages')}`
        : null,
    points: points(f),
    open: isOpen,
    count: 1,
    href: isOpen ? '#' : '#pro',
  });
  const rows = [...open.map((f) => row(f, true)), ...named.map((f) => row(f, false))];
  if (rest.length === 1) rows.push(row(rest[0]!, false));
  if (rest.length > 1) {
    rows.push({
      key: 'rest',
      title: `${capitalise(numberWord(rest.length))} more, grouped by type`,
      scope: null,
      points: `+${rest.reduce((n, f) => n + f.effect.technical_seo, 0)} SEO`,
      open: false,
      count: rest.length,
      href: '#pro',
    });
  }
  return rows;
}

function crawlerRows(check: Check): CrawlerRowView[] {
  return check.crawlers.map((c) => ({
    ua: c.ua,
    group:
      c.group === 'search_engine'
        ? 'Search engine'
        : c.scored
          ? 'AI search, scored'
          : 'AI training, not scored',
    verdict: c.verdict,
    evidence: c.evidence_class,
    status: c.status === null ? 'robots.txt' : String(c.status),
    text: c.text_share === null ? 'not measured' : `${percent(c.text_share)}%`,
  }));
}

/** "All 214 pages crawled", or "96 of 140 pages crawled" when the crawl stopped short. */
function crawledLine(check: Check) {
  const { pages_crawled: crawled, pages_discovered: found } = check.coverage!;
  return crawled === found
    ? `All ${count(found)} ${plural(found, 'page', 'pages')} crawled`
    : `${count(crawled)} of ${count(found)} pages crawled`;
}

export interface ResultOptions {
  /** The map's drawing: the layout of this check's crawl, made by the caller. */
  map: { nodes: LayoutNode[]; positions: Record<string, Point> };
  /**
   * Show a check that has since been kept as it was at its finish, before anyone kept it: the
   * locked Result screen is that moment of the bad-site audit. Its expiry is then the finish plus
   * the anonymous window, since the fixture no longer stores one.
   */
  asFirstSeen?: boolean;
}

const CADENCE: Record<string, string> = {
  weekly: 'weekly',
  monthly: 'monthly',
  on_deploy: 'on each deploy',
};

export function resultView(
  d: FixtureDataset,
  checkId: string,
  { map, asFirstSeen = false }: ResultOptions,
): ResultView {
  const check = findCheck(d, checkId);
  if (check.status !== 'finished' && check.status !== 'partial') {
    throw new Error(
      `Check ${check.id} is ${check.status}; the Result screen shows finished checks`,
    );
  }
  const site = siteOf(d, check);
  const fixes = fixesAsOf(d, check);
  const isOpen = (f: Fix) => fixes.indexOf(f) < FREE_FIXES;
  const grades = grade(check, fixes, isOpen);
  const coverage = check.coverage!;
  const sampled: CoverageView = {
    tested: coverage.pages_sampled,
    total: coverage.pages_discovered,
    groups: coverage.templates.length,
  };
  const withheld = check.ai_readability!.withheld;
  const clean = !withheld && fixes.length === 0;
  const kept = site.account_id !== null && !asFirstSeen;
  const keptUntil = kept
    ? null
    : (check.expires_at ??
      new Date(instant(check.finished_at!) + ANONYMOUS_VISIBLE_MS).toISOString());

  return {
    state: 'result',
    variant: withheld ? 'withheld' : clean ? 'clean' : 'issues',
    domain: site.host,
    crawledLine: crawledLine(check),
    crawledAt: dateTimeUtc(check.finished_at!),
    keptUntil: keptUntil ? dayTimeUtc(keptUntil) : null,
    grades,
    first: fixes[0]
      ? { kind: 'fix', title: fixes[0].title, body: fixFirstBody(check, fixes[0]), href: '#' }
      : {
          kind: 'all-clear',
          body: `Every tracked crawler got in and every template ships its text. What changes that is a deploy, a plugin or a new firewall rule; kept, this audit is re-run monthly and you hear when one lands.`,
        },
    doors: [
      accessDoor(check, fixes, isOpen, sampled),
      withoutJsDoor(check, fixes, isOpen, sampled),
      structureDoor(check, fixes, isOpen),
      contentDoor(check, fixes, isOpen),
      signalsDoor(check),
      changesDoor(check, kept, site.schedule ? (CADENCE[site.schedule.cadence] ?? null) : null),
    ],
    fixes: fixes.length
      ? {
          total: fixes.length,
          open: Math.min(FREE_FIXES, fixes.length),
          pro: Math.max(0, fixes.length - FREE_FIXES),
          rows: fixRows(fixes),
        }
      : null,
    crawlers: clean || withheld ? crawlerRows(check) : null,
    map: {
      pages: coverage.pages_crawled,
      links: check.structure!.internal_links,
      orphans: check.structure!.orphan_pages,
      nodes: map.nodes,
      positions: map.positions,
    },
  };
}

/** The states around a result: a check that has not run, one that failed, one that expired. */
export function resultStateView(d: FixtureDataset, checkId: string, now?: string): ResultPageView {
  const check = findCheck(d, checkId);
  const domain = siteOf(d, check).host;
  if (check.status === 'queued' || check.status === 'deferred') {
    return { state: 'empty', domain, queuedAt: dateTimeUtc(check.queued_at) };
  }
  if (check.status === 'failed') {
    return {
      state: 'error',
      domain,
      failedAt: dateTimeUtc(check.finished_at!),
      reason: check.failure_reason!,
    };
  }
  if (now && check.expires_at && instant(now) >= instant(check.expires_at)) {
    return {
      state: 'expired',
      domain,
      expiredAt: dateTimeUtc(check.expires_at),
      crawledAt: dateTimeUtc(check.finished_at!),
    };
  }
  throw new Error(
    `Check ${check.id} is ${check.status}, not a state the Result screen stands in for`,
  );
}

export { crawlerRows, fixCount };
export type { CrawlerResult };
