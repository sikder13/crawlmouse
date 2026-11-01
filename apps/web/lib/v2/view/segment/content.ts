/**
 * Content an answer engine can quote (Final-Seg-Content) as data: the five quotability checks by
 * section, the pages in the record that fail each, and the first words a crawler reads of one of
 * them. Sentences about the checks are built from their counts.
 */
import type { Check, ContentCheck, FixtureDataset } from '@crawlmouse/types/v2';
import { ContentCheckSchema } from '@crawlmouse/types/v2';
import { findCheck, fixesAsOf } from '../../fixtures';
import { listOf, templateNoun, testedAt } from '../../format';
import { EDGE_SENTENCE, isAi, isAllowed, meetsEdge, thinTemplates } from '../../sentences';
import { capitalise, count, numberWord, plural } from '../../words';
import { FREE_FIXES, type CoverageView, type DoorView } from '../result';
import { sectionFixes, type SectionFixesView } from './fixes';
import { segmentFrame, type SegmentFrame, type SegmentOptions } from './frame';

export interface ContentCell {
  id: string;
  /** The section's name, for the cell's accessible name. */
  section: string;
  /** "9 of 42", or "yes" / "no" for a one-page section. */
  text: string;
  state: 'ok' | 'warn' | 'bad';
  /** Paths of the pages in this record that fail the check, in this section. */
  failing: string[];
  /** The first words a crawler reads of the first failing page the check kept a render of. */
  evidence: { title: string; text: string } | null;
}

export interface ContentRow {
  check: ContentCheck;
  label: string;
  why: string;
  /** One per section, in the coverage's order; null where the check does not apply. */
  cells: (ContentCell | null)[];
}

export interface ContentView {
  frame: SegmentFrame;
  headline: { title: string; pill: DoorView['pill']; body: string };
  tiles: { label: string; value: string; note: string | null }[];
  grid: {
    /** Named by how many checks the contract defines, whether or not this audit recorded each. */
    title: string;
    columns: { key: string; label: string }[];
    rows: ContentRow[];
    /** The checks this audit did not record, said rather than left out silently. */
    notChecked: string | null;
  } | null;
  initial: string | null;
  /** Said for a selected cell with no failing page in the record. */
  noFailing: string;
  coverage: { pages: CoverageView } | { read: string };
  fixes: SectionFixesView;
  fixesNote: string | null;
  keep: { title: string; sub: string } | null;
}

/** The five checks as the locked page names them, and why each matters to an answer engine. */
export const CONTENT_CHECKS: Record<ContentCheck, { label: string; why: string }> = {
  direct_answer_150: {
    label: 'A direct answer in the first 150 words',
    why: 'The sentence that gets quoted',
  },
  question_headings: {
    label: 'Headings phrased as the question',
    why: 'How the engine matches a query to a passage',
  },
  schema_with_description: {
    label: 'Product or Article schema with a description',
    why: 'Price, availability and author as structured facts',
  },
  author_and_date: {
    label: 'Author and date visible',
    why: 'Engines prefer dated, attributed sources',
  },
  specs_as_text: {
    label: 'Specifications as a table or list, not an image',
    why: 'Numbers in images cannot be quoted',
  },
};

/** The locked legend: ● 80% or more, ■ under 5%, ▲ between. */
const PASS = 0.8;
const FAIL = 0.05;
/** A section answers from this share of its pages, and does not below the second (the Result door's). */
const MOST = 0.75;
const SOME = 0.25;
/** The score from which the pill reads as fine (the Result door's). */
const GOOD_SCORE = 80;
/** How many words of a rendered page the evidence shows. */
const FIRST_WORDS = 150;

type Row = { template_key: string; passing: number; total: number };

const stateOf = (r: Row): ContentCell['state'] => {
  const share = r.passing / r.total;
  return share >= PASS ? 'ok' : share < FAIL ? 'bad' : 'warn';
};

/** The first `n` words of a text, its line breaks kept. */
function firstWords(text: string, n: number): string {
  const words = [...text.matchAll(/\S+/g)];
  return words.length <= n ? text : text.slice(0, words[n - 1]!.index! + words[n - 1]![0].length);
}

const lower = (s: string) => s.replace(/^./u, (c) => c.toLowerCase());

function headline(check: Check, rows: readonly Row[]): string {
  const multi = rows.filter((r) => r.total > 1);
  const nameOf = (r: Row) =>
    templateNoun(check.coverage!.templates.find((t) => t.template_key === r.template_key)!.label)
      .inList;
  const best = multi.filter((r) => r.passing / r.total >= MOST);
  const worst = multi.filter((r) => r.passing / r.total < SOME);
  if (!multi.length) return 'Whether pages open with a direct answer was not checked.';
  if (best.length === multi.length) return 'Answer engines can quote every section.';
  if (!best.length) return `Few pages open with an answer an engine can quote.`;
  return worst.length
    ? `Answer engines can quote your ${listOf(best.map(nameOf))}. Not your ${listOf(worst.map(nameOf))}.`
    : `Answer engines can quote your ${listOf(best.map(nameOf))}; the rest only on some pages.`;
}

function body(check: Check, rows: readonly Row[]): string {
  const nounOf = (r: Row) =>
    templateNoun(check.coverage!.templates.find((t) => t.template_key === r.template_key)!.label)
      .pages;
  const parts = [
    'An answer engine quotes a page when it finds a direct, self-contained statement near the top, under a heading that matches the question.',
  ];
  if (rows.length) {
    const each = rows.map((r) =>
      r.total === 1
        ? r.passing
          ? nounOf(r)
          : `not ${nounOf(r)}`
        : `${count(r.passing)} of ${count(r.total)} ${nounOf(r)}`,
    );
    const pass = rows.reduce((n, r) => n + r.passing, 0);
    const total = rows.reduce((n, r) => n + r.total, 0);
    parts.push(
      `Of the pages read, these do: ${listOf(each)}; ${count(pass)} of ${count(total)} in all.`,
    );
  }
  const thin = meetsEdge(check)
    ? []
    : thinTemplates(
        check,
        check.crawlers.filter((c) => isAi(c) && isAllowed(c.verdict)),
      );
  if (thin.length) {
    const names = thin.map(
      (k) =>
        templateNoun(check.coverage!.templates.find((t) => t.template_key === k)!.label).adjective,
    );
    parts.push(
      `This is measured on the rendered page, so it is separate from the JavaScript problem; fixing that first makes the ${listOf(names)} numbers matter.`,
    );
  }
  if (check.tested_at) parts.push(`Measured ${testedAt(check.tested_at)}.`);
  return parts.join(' ');
}

/** The note above the fixes when none here is free: the free ones, Pro, and what waits on them. */
function fixesNote(
  d: FixtureDataset,
  check: Check,
  fixes: SectionFixesView,
  unkept: boolean,
): string | null {
  if (fixes.open.length || !fixes.proCount) return null;
  const free = fixes.openElsewhere;
  const n = numberWord(free.length);
  const parts = [
    `The ${n} free ${plural(free.length, 'fix', 'fixes')} of this audit ${plural(free.length, 'is', 'are')} the ${free.length === 1 ? 'one' : n} with the largest estimated effect: ${listOf(free.map((f) => lower(f.title)))}.`,
    `The ${numberWord(fixes.proCount)} below ${plural(fixes.proCount, 'is', 'are')} on Pro${unkept ? ', which starts free for 14 days with the email below' : ''}.`,
  ];
  const all = fixesAsOf(d, check);
  const pro = all.filter((f, i) => f.section === 'content' && i >= FREE_FIXES);
  const pending = pro.filter(
    (f) => f.effect.ai_readability === null && f.effect.ai_readability_pending_on.length,
  );
  if (pending.length) {
    const waits = [
      ...new Set(
        pending.flatMap((f) =>
          f.effect.ai_readability_pending_on.map(
            (fp) => d.fixes.find((x) => x.fingerprint === fp)?.number,
          ),
        ),
      ),
    ]
      .filter((x): x is number => x !== undefined)
      .sort((a, b) => a - b);
    const who =
      pending.length === pro.length
        ? 'Their effect on AI readability is'
        : `The effect on AI readability of ${numberWord(pending.length)} of them is`;
    parts.push(
      `${who} not estimated yet: the crawlers that would quote these pages cannot read them until ${plural(waits.length, 'fix', 'fixes')} ${listOf(waits.map(String))} land, so each carries only its Technical SEO point for now.`,
    );
  }
  return parts.join(' ');
}

export function contentView(
  d: FixtureDataset,
  checkId: string,
  options: SegmentOptions = {},
): ContentView {
  const check = findCheck(d, checkId);
  const coverage = check.coverage;
  if (!coverage)
    throw new Error(`Check ${check.id} has no coverage; the segments show graded checks`);
  const frame = segmentFrame(d, checkId, 'content', options);
  const fixes = sectionFixes(d, check, 'content');
  const templates = coverage.templates;
  const here = fixes.open.length + fixes.proCount;
  const keepFor = (what: string) =>
    frame.keptUntil
      ? {
          title: `Keep this audit: an email when ${what} gains or loses its quotable opening, and ${here > 1 ? `all ${numberWord(here)} fixes` : here === 1 ? 'its fix' : 'every fix'} for 14 days.`,
          sub: `One email creates a free account that re-checks monthly, with 14 days of Pro to start. Otherwise this page expires ${frame.keptUntil}.`,
        }
      : null;
  const content = check.content;
  if (!content) {
    return {
      frame,
      headline: {
        title: 'Whether pages open with a quotable answer was not measured.',
        pill: { state: 'neutral', label: 'not measured' },
        body: meetsEdge(check)
          ? `${EDGE_SENTENCE}, so whether the pages open with a quotable answer could not be measured.`
          : 'Whether the pages open with a quotable answer was not measured in this audit.',
      },
      tiles: [],
      grid: null,
      initial: null,
      noFailing: '',
      coverage: { read: 'No page was read for these checks.' },
      fixes,
      fixesNote: null,
      keep: keepFor('a page'),
    };
  }
  const order = (k: string) => templates.findIndex((t) => t.template_key === k);
  const rowsOf = (c: ContentCheck): Row[] =>
    (content.checks.find((x) => x.check === c)?.by_template ?? [])
      .filter((r) => r.total > 0)
      .sort((a, b) => order(a.template_key) - order(b.template_key));
  const direct = rowsOf('direct_answer_150');
  const pages = d.page_results.filter((p) => p.check_id === check.id);
  const renders = d.access_tests.filter(
    (t) => t.check_id === check.id && t.ua === null && t.source_ip_class === 'browser_rendering',
  );
  const nameOf = (k: string) => templateNoun(templates.find((t) => t.template_key === k)!.label);
  const cell = (c: ContentCheck, r: Row): ContentCell => {
    const failingPages = pages.filter(
      (p) => p.template_key === r.template_key && p.content_failures?.includes(c),
    );
    const shown = failingPages
      .map((p) => ({ p, t: renders.find((t) => t.page_url === p.url && t.body_excerpt) }))
      .find((x) => x.t);
    return {
      id: `${c}|${r.template_key}`,
      section: nameOf(r.template_key).inList,
      text: r.total === 1 ? (r.passing ? 'yes' : 'no') : `${count(r.passing)} of ${count(r.total)}`,
      state: stateOf(r),
      failing: failingPages.map((p) => new URL(p.url).pathname),
      evidence: shown
        ? {
            title: `Evidence · ${new URL(shown.p.url).pathname} · first ${FIRST_WORDS} words a crawler reads, rendered`,
            text: firstWords(shown.t!.body_excerpt!, FIRST_WORDS),
          }
        : null,
    };
  };
  const recorded = ContentCheckSchema.options.filter((c) => rowsOf(c).length);
  const rows: ContentRow[] = recorded.map((c) => ({
    check: c,
    ...CONTENT_CHECKS[c],
    cells: templates.map((t) => {
      const r = rowsOf(c).find((x) => x.template_key === t.template_key);
      return r ? cell(c, r) : null;
    }),
  }));
  const missing = ContentCheckSchema.options.filter((c) => !recorded.includes(c));
  const share = (r: Row) => r.passing / r.total;
  const multi = [...direct.filter((r) => r.total > 1)].sort((a, b) => share(a) - share(b));
  const weakest = multi[0];
  const strongest = multi.length > 1 ? multi.at(-1) : undefined;
  const schema = weakest
    ? rowsOf('schema_with_description').find((r) => r.template_key === weakest.template_key)
    : undefined;
  const of = (r: Row) => `${count(r.passing)} of ${count(r.total)}`;
  const sum = (key: 'passing' | 'total') => direct.reduce((n, r) => n + r[key], 0);
  const firstCells = rows[0]?.cells.filter((c): c is ContentCell => c !== null) ?? [];
  const initial =
    (weakest && rows[0]?.check === 'direct_answer_150'
      ? firstCells.find((c) => c.id === `direct_answer_150|${weakest.template_key}`)
      : undefined) ?? firstCells[0];
  const perTemplate = templates.map((t) =>
    Math.max(
      0,
      ...content.checks.map(
        (c) => c.by_template.find((r) => r.template_key === t.template_key)?.total ?? 0,
      ),
    ),
  );
  const withheld = d.withheld.find(
    (w) => w.check_id === check.id && w.collection === 'page_results',
  );
  return {
    frame,
    headline: {
      title: headline(check, direct),
      pill: {
        state: content.score >= GOOD_SCORE ? 'ok' : 'warn',
        label: `${content.score} / 100`,
      },
      body: body(check, direct),
    },
    tiles: [
      ...(direct.length
        ? [
            {
              label: 'Pages with a quotable opening',
              value: `${count(sum('passing'))} of ${count(sum('total'))}`,
              note: null,
            },
          ]
        : []),
      ...[weakest, strongest]
        .filter((r): r is Row => r !== undefined)
        .map((r) => ({
          label: capitalise(nameOf(r.template_key).pages),
          value: of(r),
          note: null,
        })),
      ...(weakest && schema
        ? [
            {
              label: `${capitalise(nameOf(weakest.template_key).adjective)} schema with description`,
              value: of(schema),
              note: null,
            },
          ]
        : []),
    ],
    grid: {
      title: `${capitalise(numberWord(ContentCheckSchema.options.length))} things an answer engine looks for, by section`,
      columns: templates.map((t) => ({
        key: t.template_key,
        label: t.template_key === '/' ? t.label : `${t.label} · ${count(t.pages)}`,
      })),
      rows,
      notChecked: missing.length
        ? `Not checked in this audit: ${listOf(missing.map((c) => lower(CONTENT_CHECKS[c].label)))}.`
        : null,
    },
    initial: initial?.id ?? null,
    noFailing: withheld
      ? `This record holds ${count(withheld.included)} of the ${count(withheld.total)} pages of this audit, and none of them fails this check here.`
      : 'No page in this record fails this check here.',
    coverage: {
      pages: {
        tested: perTemplate.reduce((n, p) => n + p, 0),
        total: coverage.pages_discovered,
        groups: perTemplate.filter((p) => p > 0).length,
      },
    },
    fixes,
    fixesNote: fixesNote(d, check, fixes, frame.keptUntil !== null),
    keep: keepFor(weakest ? `a ${nameOf(weakest.template_key).adjective} page` : 'a page'),
  };
}
