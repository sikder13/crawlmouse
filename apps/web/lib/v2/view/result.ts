/**
 * The Result (overview) screen as data, built from one check of a contract fixture: the numbers
 * and sentences about the site. The headings, the Pro pitch and the keep bar are the component's.
 * The values view/inventory.ts lists are checked against the fixture by
 * __tests__/v2/perturbation.test.tsx.
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
  verbFor,
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
  /** The pill's figure as a share of 100, in the pill's tone (result.test.ts checks both). */
  bar?: { percent: number; tone: 'bad' | 'warn' | 'neutral' };
  body: string;
  footer: string;
  /**
   * What the door's figures rest on: the pages tested, drawn as the coverage line, or, for a door
   * that reads no pages, a line saying what it read instead.
   */
  coverage: { pages: CoverageView } | { read: string };
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
    | {
        kind: 'all-clear';
        body: string;
        /** The way to start watching an audit nobody has kept; null once it is kept. */
        action: { label: string; href: string } | null;
      };
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

/**
 * FACTS: anonymous audits are visible for 24 hours. An unkept result whose check stores no expiry
 * (the bad site shown as it was before it was kept) expires this long after its finish.
 */
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

const BAR_TONE_OF_PILL: Record<PillState, NonNullable<DoorView['bar']>['tone']> = {
  ok: 'neutral',
  neutral: 'neutral',
  unverified: 'warn',
  warn: 'warn',
  bad: 'bad',
};

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
  // A crawler that could not be measured is neither let in nor kept out.
  const unmeasured = ai.filter((c) => c.verdict === 'not_measured').length;
  const kept = ai.length - allowed.length - unmeasured;
  const pill: DoorView['pill'] = edge
    ? { state: 'bad', label: EDGE_PILL }
    : kept === 0 && unmeasured === 0
      ? { state: 'ok', label: `${ai.length} of ${ai.length} allowed` }
      : {
          state: blocked ? 'bad' : 'unverified',
          label: [
            blocked ? `${blocked} blocked` : null,
            challenged ? `${challenged} challenged` : null,
            kept - blocked - challenged ? `${kept - blocked - challenged} kept out` : null,
            unmeasured ? `${unmeasured} not measured` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        };
  const searchLine = search.every((c) => c.verdict === 'allowed')
    ? `${listOf(search.map((c) => c.ua))} ${plural(search.length, 'is', 'are')} allowed by robots.txt.`
    : `${keptOutClauses(search).join('; ')}.`;
  // The edge is said once, not per crawler.
  const out = keptOutClauses(edge ? ai.filter((c) => c.verdict !== 'edge_blocks_automation') : ai);
  const othersIn =
    allowed.length === 0
      ? ''
      : allowed.length === 1
        ? ' The other AI crawler gets in;'
        : ` The other ${numberWord(allowed.length)} AI crawlers get in;`;
  const body = edge
    ? `${EDGE_SENTENCE} from our published IPs, tagged or not, so what the crawlers themselves get could not be measured.${out.length ? ` ${capitalise(out.join('; '))}.` : ''}`
    : out.length === 0
      ? `All ${numberWord(ai.length)} AI crawlers get in. ${searchLine}`
      : `${capitalise(out.join('; '))}.${othersIn} ${searchLine}`;
  return {
    title: 'Crawler access',
    pill,
    // The bar draws the pill's count, as the other doors' bars draw theirs: the crawlers kept out
    // or not measured, or, with none, the crawlers allowed.
    bar: {
      percent: Math.round(((kept + unmeasured || ai.length) / ai.length) * 100),
      tone: BAR_TONE_OF_PILL[pill.state],
    },
    body,
    footer: `${ai.length} AI crawlers (${ai.filter((c) => c.scored).length} scored), ${search.length} search engines by robots.txt · ${fixCount(fixes, SECTIONS.access!, isOpen)}`,
    coverage: { pages: coverage },
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
    footer: `Every page measured with Pro · ${fixCount(fixes, SECTIONS.withoutJs!, isOpen)}`,
    coverage: { pages: coverage },
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
      pages: {
        tested: crawled,
        total: check.coverage!.pages_discovered,
        groups: check.coverage!.templates.length,
      },
    },
    href: '#',
  };
}

type ContentRow = { template_key: string; passing: number; total: number };

/** A content check's rows with pages read, in the coverage's template order. */
function readRows(check: Check, found: { by_template: ContentRow[] } | undefined): ContentRow[] {
  const order = check.coverage!.templates.map((t) => t.template_key);
  return (found?.by_template ?? [])
    .filter((r) => r.total > 0)
    .sort((a, b) => order.indexOf(a.template_key) - order.indexOf(b.template_key));
}

/** A template answers, or has most headings as questions, from this share of its pages. */
const MOST = 0.75;
/** Below this share, it does not; between the two, it does on some pages. */
const SOME = 0.25;

const nounsOf = (check: Check, rows: readonly ContentRow[]) =>
  rows.map(
    (r) =>
      templateNoun(check.coverage!.templates.find((t) => t.template_key === r.template_key)!.label)
        .pages,
  );

/**
 * "The homepage and blog posts answer their titles in the first paragraph; collection pages do on
 * some pages; product pages don't." The first group present carries the whole predicate.
 */
function answerSentence(check: Check, rows: readonly ContentRow[]): string | null {
  if (!rows.length) return null;
  const share = (r: ContentRow) => r.passing / r.total;
  const answer = rows.filter((r) => share(r) >= MOST);
  if (answer.length === check.coverage!.templates.length) {
    return 'Every template answers its title in the first paragraph.';
  }
  const groups: [rows: ContentRow[], whole: [string, string], short: [string, string]][] = [
    [
      answer,
      ['answers its title in the first paragraph', 'answer their titles in the first paragraph'],
      ['answers its title in the first paragraph', 'answer their titles in the first paragraph'],
    ],
    [
      rows.filter((r) => share(r) < MOST && share(r) >= SOME),
      [
        'answers its title in the first paragraph on some pages',
        'answer their titles in the first paragraph on some pages',
      ],
      ['does on some pages', 'do on some pages'],
    ],
    [
      rows.filter((r) => share(r) < SOME),
      [
        "doesn't answer its title in the first paragraph",
        "don't answer their titles in the first paragraph",
      ],
      ["doesn't", "don't"],
    ],
  ];
  const clauses = groups
    .filter(([g]) => g.length)
    .map(([g, whole, short], i) => {
      const names = nounsOf(check, g);
      const [one, many] = i === 0 ? whole : short;
      return `${listOf(names)} ${verbFor(names, one, many)}`;
    });
  return `${capitalise(clauses.join('; '))}.`;
}

/** Few, some or most headings phrased as questions, over every page read; null with none read. */
function questionSentence(rows: readonly ContentRow[]): string | null {
  const total = rows.reduce((n, r) => n + r.total, 0);
  if (!total) return null;
  const share = rows.reduce((n, r) => n + r.passing, 0) / total;
  const word = share < SOME ? 'Few' : share < MOST ? 'Some' : 'Most';
  return `${word} headings are phrased as questions.`;
}

/** Where schema is on every page read, where on some, and where on none. */
function schemaSentence(check: Check, rows: readonly ContentRow[]): string | null {
  if (!rows.length) return null;
  const full = rows.filter((r) => r.passing === r.total);
  const part = rows.filter((r) => r.passing > 0 && r.passing < r.total);
  const none = rows.filter((r) => r.passing === 0);
  if (full.length === check.coverage!.templates.length)
    return 'Schema is present on every template.';
  if (!full.length && !part.length) return 'No page we checked has schema.';
  const where = [
    full.length ? `on ${listOf(nounsOf(check, full))}` : null,
    part.length ? `partly on ${listOf(nounsOf(check, part))}` : null,
  ]
    .filter(Boolean)
    .join(', and ');
  return `Schema is present ${where}${none.length ? `; not on ${listOf(nounsOf(check, none))}` : ''}.`;
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
      coverage: { pages: { tested: 0, total: check.coverage!.pages_discovered, groups: 0 } },
      href: '#',
    };
  }
  const templates = check.coverage!.templates;
  const rows = (name: string) =>
    readRows(
      check,
      content.checks.find((c) => c.check === name),
    );
  const body = [
    answerSentence(check, rows('direct_answer_150')),
    questionSentence(rows('question_headings')),
    schemaSentence(check, rows('schema_with_description')),
  ];

  // Pages the content checks evaluated: for each template, the largest total any check reports.
  const perTemplate = templates.map((t) =>
    Math.max(
      0,
      ...content.checks.map(
        (c) => c.by_template.find((r) => r.template_key === t.template_key)?.total ?? 0,
      ),
    ),
  );
  return {
    title: 'Content an answer engine can quote',
    pill: { state: content.score >= 80 ? 'ok' : 'warn', label: `${content.score} / 100` },
    bar: { percent: content.score, tone: content.score >= 80 ? 'neutral' : 'warn' },
    body: body.filter(Boolean).join(' '),
    footer,
    coverage: {
      pages: {
        tested: perTemplate.reduce((n, p) => n + p, 0),
        total: check.coverage!.pages_discovered,
        groups: perTemplate.filter((p) => p > 0).length,
      },
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
  // The pill counts what is known present. A signal the check could not determine, or did not
  // record, is not tested, and the coverage line says how many were.
  const label = `${present.length} of ${kinds.length} present`;
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
    coverage: { read: `Tested ${present.length + absent.length} of ${kinds.length} signals` },
    href: '#',
  };
}

/** The changes door shows a first audit only (it throws otherwise), so there is nothing before it. */
const FIRST_AUDIT = { read: 'No earlier audit of this site to compare with' };

function changesDoor(check: Check, kept: boolean, cadence: string | null): DoorView {
  if (check.previous_check_id !== null) throw new Error('Only a first audit is shown here');
  if (kept) {
    return {
      title: 'What changed since last time',
      pill: { state: 'neutral', label: 'first audit' },
      body: 'Each re-check shows its diff here: pages added or lost, crawlers newly blocked, templates that broke.',
      footer: cadence ? `Re-checked ${cadence}` : 'No re-check scheduled',
      coverage: FIRST_AUDIT,
      href: '#',
    };
  }
  return {
    title: 'What changed since last time',
    pill: { state: 'neutral', label: 'first audit' },
    body: 'Keep this audit and we re-run it monthly and show the diff here: pages added or lost, crawlers newly blocked, templates that broke.',
    footer: 'Keeping it takes one email',
    coverage: FIRST_AUDIT,
    href: '#keep',
    keep: true,
  };
}

/**
 * The third card when there is nothing to fix: what the AI crawlers' verdicts and the templates
 * show, what would change it, and how the site is watched.
 */
function allClear(
  check: Check,
  kept: boolean,
  cadence: string | null,
): Extract<ResultView['first'], { kind: 'all-clear' }> {
  const ai = check.crawlers.filter(isAi);
  const inside = ai.filter((c) => isAllowed(c.verdict));
  const out = keptOutClauses(ai);
  const access = !out.length
    ? `All ${numberWord(ai.length)} AI crawlers get in`
    : inside.length
      ? `${out.join('; ')}; the other ${numberWord(inside.length)} AI crawlers get in`
      : out.join('; ');
  const thin = thinTemplates(check, ai).map(
    (k) => templateNoun(check.coverage!.templates.find((t) => t.template_key === k)!.label).pages,
  );
  // What the crawlers that got in read; with none in, nothing was read to say it of.
  const text = !inside.length
    ? ''
    : thin.length
      ? `, and ${listOf(thin)} ${verbFor(thin, 'is', 'are')} empty without JavaScript`
      : ' and every template ships its text';
  const watch = !kept
    ? 'kept, this audit is re-run monthly and you hear when one lands.'
    : cadence
      ? `it is re-checked ${cadence}, and you hear when one lands.`
      : 'no re-check is scheduled.';
  return {
    kind: 'all-clear',
    body: `${capitalise(access)}${text}. What changes that is a deploy, a plugin or a new firewall rule; ${watch}`,
    action: kept ? null : { label: 'Watch this site', href: '#keep' },
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
      ? `about ${numberWord(f.effort.minutes)} ${plural(f.effort.minutes, 'minute', 'minutes')}`
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

/** Whether a title states the number `n` as a whole number, grouped ("1,120") or not. */
function statesCount(title: string, n: number): boolean {
  const numbers = title.match(/\d[\d,]*/g) ?? [];
  return numbers.some((x) => Number(x.replace(/,/g, '')) === n);
}

function fixRows(fixes: readonly Fix[]): FixRowView[] {
  const open = fixes.slice(0, FREE_FIXES);
  const named = fixes.slice(FREE_FIXES, FREE_FIXES + 2);
  const rest = fixes.slice(FREE_FIXES + 2);
  const row = (f: Fix, isOpen: boolean): FixRowView => ({
    key: f.id,
    title: f.title,
    // A fix to a whole template says how many pages it affects, unless its title already counts them.
    scope:
      f.template_key && !statesCount(f.title, f.affected_pages)
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

const GROUP_NAMES: Record<CrawlerResult['group'], string> = {
  search_engine: 'Search engine',
  ai_search: 'AI search',
  ai_training: 'AI training',
};

function crawlerRows(check: Check): CrawlerRowView[] {
  return check.crawlers.map((c) => ({
    ua: c.ua,
    group:
      c.group === 'search_engine'
        ? GROUP_NAMES[c.group]
        : `${GROUP_NAMES[c.group]}, ${c.scored ? 'scored' : 'not scored'}`,
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
  const cadence = site.schedule ? (CADENCE[site.schedule.cadence] ?? null) : null;
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
      : allClear(check, kept, cadence),
    doors: [
      accessDoor(check, fixes, isOpen, sampled),
      withoutJsDoor(check, fixes, isOpen, sampled),
      structureDoor(check, fixes, isOpen),
      contentDoor(check, fixes, isOpen),
      signalsDoor(check),
      changesDoor(check, kept, cadence),
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
