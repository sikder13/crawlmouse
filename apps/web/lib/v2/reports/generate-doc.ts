/**
 * A check's records as a report document (CC-31 D6, D6b), built through the view functions the
 * audit pages draw from, called as a paid plan's pages call them (each live fix open).
 *
 * A string of a document comes from one of three places: a view (a string it returned, or a number
 * it returned, written as its digits); the screens' word for a verdict (`VERDICTS`); or
 * `REPORT_DOC_COPY`, the titles and labels a document adds. The footer is `footerLine` of the
 * check's date as its Result page writes it. `generate-doc.test.ts` holds each document to that,
 * over the contract fixtures and over generated checks.
 *
 * Times are the views': a page of a check read without its account (as `loadCheck` reads one) writes
 * them in UTC and says so.
 */
import { instant } from '@crawlmouse/types/v2';
import { VERDICTS } from '../../../components/v2/verdicts';
import { footerLine, REPORT_DOC_COPY as COPY } from '../copy/report-doc';
import { findCheck, type ViewDataset } from '../fixtures';
import { fixView } from '../view/fix';
import { partialNotice, resultView, type GradeView } from '../view/result';
import { screenSignals } from '../view/screen-signals';
import { accessView } from '../view/segment/access';
import { changesView, type ChangeRowView } from '../view/segment/changes';
import { contentView } from '../view/segment/content';
import { nojsView } from '../view/segment/nojs';
import { signalsView } from '../view/segment/signals';
import { structureView } from '../view/segment/structure';
import type { DocBlock, DocSection, DocSide, ReportDoc } from './generate';

/** One check, and the records its pages are drawn from. */
export interface CheckRecords {
  dataset: ViewDataset;
  checkId: string;
}

export interface DocOptions {
  /** The home page's address, which the footer links. */
  home: string;
}

const PLAN = { plan: 'pro' } as const;

/** The pages of one check, as data. */
function pagesOf({ dataset: d, checkId }: CheckRecords) {
  return {
    check: findCheck(d, checkId),
    result: resultView(d, checkId, { map: null, ...PLAN }),
    access: accessView(d, checkId, PLAN),
    nojs: nojsView(d, checkId, PLAN),
    // No drawing: a document has the link map's figures, not its picture.
    structure: structureView(d, checkId, PLAN, null),
    content: contentView(d, checkId, PLAN),
    signals: signalsView(d, checkId, PLAN),
    partial: partialNotice(d, checkId),
  };
}

type Pages = ReturnType<typeof pagesOf>;

const text = (t: string): DocBlock => ({ type: 'text', text: t });

const facts = (tiles: readonly { label: string; value: string }[]): DocBlock[] =>
  tiles.length
    ? [{ type: 'facts', rows: tiles.map(({ label, value }) => ({ label, value })) }]
    : [];

const footerOf = (p: Pages, { home }: DocOptions): ReportDoc['footer'] => ({
  text: footerLine(p.result.crawledAt),
  href: home,
});

/** Under the title: the site, when it was checked, and how much of it was crawled. */
const linesOf = (p: Pages): string[] => [p.result.domain, p.result.crawledAt, p.result.crawledLine];

function gradesSection(p: Pages): DocSection {
  return {
    heading: COPY.grades,
    blocks: [
      {
        type: 'table',
        caption: COPY.gradesCaption,
        columns: [COPY.grade, COPY.letter, COPY.score, COPY.summary],
        rows: p.result.grades.map((g) => [
          g.label,
          g.letter ?? COPY.withheld,
          g.score === null ? COPY.withheld : String(g.score),
          g.summary,
        ]),
      },
    ],
  };
}

/** The access page's headline, its figures, a table of crawlers per group, and how it was tested. */
function accessSection({ access: a }: Pages): DocSection {
  return {
    heading: a.frame.title,
    blocks: [
      text(a.headline.title),
      text(a.headline.body),
      ...facts(a.tiles),
      ...a.groups.flatMap((g): DocBlock[] => [
        {
          type: 'table',
          caption: g.title,
          columns: [COPY.crawler, COPY.verdict, COPY.textRead, COPY.inTheWay],
          rows: g.rows.map((r) => [r.ua, VERDICTS[r.verdict].label, r.text, r.cause]),
        },
        text(g.note),
      ]),
      ...(a.footnote === null ? [] : [text(a.footnote)]),
      text(a.method),
    ],
  };
}

/** What a segment page heads with: its headline, the paragraph under it, and its figures. */
function headOf(
  title: string,
  headline: { title: string; body: string },
  tiles: readonly { label: string; value: string }[],
): DocSection {
  return {
    heading: title,
    blocks: [text(headline.title), text(headline.body), ...facts(tiles)],
  };
}

function signalsSection({ signals: s }: Pages): DocSection {
  return {
    heading: s.frame.title,
    blocks: [
      text(s.headline.title),
      text(s.body),
      {
        type: 'table',
        caption: s.coverage.read,
        columns: [COPY.signal, COPY.status, COPY.where],
        rows: s.rows.map((r) => [r.name, r.status.label, r.where]),
      },
    ],
  };
}

/** Each live fix in the audit's order, with its effect; null when the check found none. */
function fixesSection(p: Pages): DocSection | null {
  if (p.result.fixes === null) return null;
  const open = new Map(
    [p.access, p.nojs, p.structure, p.content]
      .flatMap((section) => section.fixes.open)
      .map((f) => [f.id, f] as const),
  );
  return {
    heading: COPY.fixes,
    blocks: [
      {
        type: 'table',
        caption: COPY.fixesCaption,
        columns: [COPY.fix, COPY.pages, COPY.effect, COPY.effort, COPY.kind],
        rows: p.result.fixes.rows.map((r) => {
          const fix = open.get(r.key);
          return [
            r.title,
            r.scope ?? COPY.none,
            r.points,
            fix?.effort ?? COPY.none,
            fix?.recommendation.label ?? COPY.none,
          ];
        }),
      },
    ],
  };
}

/**
 * What the check did not measure, each in its page's sentence: the partial notice; why AI
 * readability is withheld; text without JavaScript and the content checks, when not measured; the
 * content checks the audit did not record; and how many signals were tested, when not each was.
 */
function notMeasuredOf(p: Pages): string[] {
  const [, ai] = p.result.grades;
  const untested = screenSignals(p.check).some(
    (s) => s.state !== 'detected' && s.state !== 'not_detected',
  );
  return [
    p.partial,
    ai.withheld ? ai.summary : null,
    p.check.without_js ? null : p.nojs.headline.title,
    p.check.content ? null : p.content.headline.title,
    p.content.grid?.notChecked ?? null,
    untested ? p.signals.coverage.read : null,
  ].filter((s): s is string => s !== null);
}

/** The audit as a document: grades, crawlers, each section's head, and each open fix. */
export function auditDoc(records: CheckRecords, options: DocOptions): ReportDoc {
  const p = pagesOf(records);
  const fixes = fixesSection(p);
  return {
    title: COPY.auditTitle,
    lines: linesOf(p),
    sections: [
      gradesSection(p),
      accessSection(p),
      headOf(p.nojs.frame.title, p.nojs.headline, p.nojs.tiles),
      headOf(p.structure.frame.title, p.structure.headline, p.structure.tiles),
      headOf(p.content.frame.title, p.content.headline, p.content.tiles),
      signalsSection(p),
      ...(fixes ? [fixes] : []),
    ],
    notMeasured: notMeasuredOf(p),
    footer: footerOf(p, options),
  };
}

/**
 * One check on its own, for a proof page with nothing to compare: what was checked and when, both
 * grades, and what the access and no-JavaScript pages head with. It says what those pages say, so
 * for a site that something blocks it names the block.
 */
export function baselineDoc(records: CheckRecords, options: DocOptions): ReportDoc {
  const p = pagesOf(records);
  return {
    title: COPY.baselineTitle,
    lines: linesOf(p),
    sections: [gradesSection(p), accessSection(p), headOf(p.nojs.frame.title, p.nojs.headline, [])],
    notMeasured: notMeasuredOf(p),
    footer: footerOf(p, options),
  };
}

/** When each graded check of the later check's site finished, as the Changes page lists them. */
function datesOf(after: CheckRecords): (checkId: string | null) => string {
  const history = changesView(after.dataset, after.checkId, { ...PLAN, rerun: false }).history;
  const when = new Map(history.map((h) => [h.key, h.when] as const));
  return (checkId) => (checkId === null ? COPY.none : (when.get(checkId) ?? COPY.none));
}

const gradeSide = (label: string, date: string, g: GradeView): DocSide => ({
  label,
  date,
  value: g.letter ?? COPY.withheld,
  evidence: [...(g.score === null ? [] : [String(g.score)]), g.summary],
});

/** Both grades, each as the earlier and the later check's Result page gives it. */
function gradePairs(before: Pages, after: Pages, dates: { before: string; after: string }) {
  return after.result.grades.map(
    (g, i): DocBlock => ({
      type: 'pair',
      title: g.label,
      before: gradeSide(COPY.before, dates.before, before.result.grades[i]!),
      after: gradeSide(COPY.after, dates.after, g),
    }),
  );
}

/** One change as the Changes page states it: the lines removed before it, the cause and lines added after. */
function changeBlocks(row: ChangeRowView, dates: { before: string; after: string }): DocBlock[] {
  const lines = (sign: '+' | '−') => row.diff.filter((l) => l.sign === sign).map((l) => l.line);
  return [
    {
      type: 'pair',
      title: row.summary,
      before: { label: COPY.before, date: dates.before, value: COPY.none, evidence: lines('−') },
      after: {
        label: COPY.after,
        date: dates.after,
        value: row.pill.label,
        evidence: [row.cause, ...lines('+')],
      },
    },
    {
      type: 'facts',
      rows: [
        { label: COPY.where, value: row.where },
        { label: COPY.pages, value: row.pages ?? COPY.none },
        { label: COPY.effectOnGrades, value: row.effect },
      ],
    },
  ];
}

/** The two checks of one site, the earlier first; throws for any other two. */
function ordered(before: CheckRecords, after: CheckRecords) {
  const [a, b] = [
    findCheck(before.dataset, before.checkId),
    findCheck(after.dataset, after.checkId),
  ];
  if (a.site_id !== b.site_id) throw new Error('a comparison is of two checks of one site');
  if (a.id === b.id || instant(a.queued_at) >= instant(b.queued_at)) {
    throw new Error('a comparison needs the earlier check first');
  }
  return { earlier: a, later: b };
}

/** What the earlier check did not measure, as a section; none when it measured each thing. */
function earlierGaps(before: Pages): DocSection[] {
  const gaps = notMeasuredOf(before);
  return gaps.length ? [{ heading: COPY.notMeasuredEarlier, blocks: gaps.map(text) }] : [];
}

/**
 * Two checks of one site, before and after: each grade as a pair, then, for each graded check after
 * the earlier one up to the later one, what its Changes page heads with and each change it lists.
 * `after.dataset` must hold the changes of each of those checks for them to be listed.
 */
export function compareDoc(
  before: CheckRecords,
  after: CheckRecords,
  options: DocOptions,
): ReportDoc {
  const { earlier, later } = ordered(before, after);
  const [was, is] = [pagesOf(before), pagesOf(after)];
  const dateOf = datesOf(after);
  const between = after.dataset.checks
    .filter((c) => c.site_id === later.site_id)
    .filter((c) => c.status === 'finished' || c.status === 'partial')
    .filter(
      (c) =>
        instant(c.queued_at) > instant(earlier.queued_at) &&
        instant(c.queued_at) <= instant(later.queued_at),
    )
    .sort((a, b) => instant(a.queued_at) - instant(b.queued_at));
  return {
    title: COPY.compareTitle,
    lines: [is.result.domain, dateOf(earlier.id), dateOf(later.id)],
    sections: [
      {
        heading: COPY.grades,
        blocks: gradePairs(was, is, { before: dateOf(earlier.id), after: dateOf(later.id) }),
      },
      {
        heading: COPY.changes,
        blocks: between.flatMap((c) => {
          const page = changesView(after.dataset, c.id, { ...PLAN, rerun: false });
          const dates = { before: dateOf(c.previous_check_id), after: dateOf(c.id) };
          return [text(page.headline.title), ...page.rows.flatMap((r) => changeBlocks(r, dates))];
        }),
      },
      ...earlierGaps(was),
    ],
    notMeasured: notMeasuredOf(is),
    footer: footerOf(is, options),
  };
}

/**
 * One fix the later check verified: the fix as the page of the check that held it open shows it,
 * beside its page at the check that verified it, then both grades of the two checks. Throws when
 * the later check's fix page does not say the fix is resolved.
 */
export function fixProofDoc(
  before: CheckRecords,
  after: CheckRecords,
  fixId: string,
  options: DocOptions,
): ReportDoc {
  const { earlier, later } = ordered(before, after);
  const [was, is] = [pagesOf(before), pagesOf(after)];
  const fixAt = (r: CheckRecords) =>
    fixView(r.dataset, r.checkId, fixId, { ...PLAN, rerun: false });
  const [open, resolved] = [fixAt(before), fixAt(after)];
  if (open.kind !== 'open') throw new Error('the earlier check did not hold the fix open');
  if (resolved.kind !== 'resolved') throw new Error('the later check did not verify the fix');
  const dateOf = datesOf(after);
  const dates = { before: dateOf(earlier.id), after: dateOf(later.id) };
  return {
    title: COPY.fixProofTitle,
    lines: [resolved.frame.domain, resolved.head.title],
    sections: [
      {
        heading: resolved.frame.section.title,
        blocks: [
          {
            type: 'pair',
            title: resolved.head.title,
            before: {
              label: COPY.before,
              date: dates.before,
              value: open.frame.position,
              evidence: open.head.lede,
            },
            after: {
              label: COPY.after,
              date: dates.after,
              value: resolved.frame.position,
              evidence: [resolved.resolved],
            },
          },
        ],
      },
      { heading: COPY.grades, blocks: gradePairs(was, is, dates) },
      ...earlierGaps(was),
    ],
    notMeasured: notMeasuredOf(is),
    footer: footerOf(is, options),
  };
}
