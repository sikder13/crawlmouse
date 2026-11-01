/**
 * Readable without JavaScript (Final-Seg-JS) as data: how much of each measured page's text is in
 * the HTML the server sends, template by template, and the two responses behind each page the
 * check kept (the untagged control fetch, and the rendering browser's).
 */
import type {
  AccessTest,
  Check,
  FixSection,
  FixtureDataset,
  PageResult,
} from '@crawlmouse/types/v2';
import { findCheck } from '../../fixtures';
import { listOf, percent, templateNoun, testedAt, timeOfDay } from '../../format';
import {
  EDGE_SENTENCE,
  clientRenderedTemplates,
  isAi,
  isAllowed,
  meetsEdge,
} from '../../sentences';
import { capitalise, count, numberWord, plural } from '../../words';
import type { CoverageView, DoorView } from '../result';
import { sectionFixes, type SectionFixesView } from './fixes';
import { SEGMENTS, segmentFrame, type SegmentFrame, type SegmentOptions } from './frame';

export interface NoJsEvidence {
  title: string;
  caption: string;
  /** What the server sent: the control fetch's start, then its word count. */
  raw: string;
  /** What a browser shows after scripts run. */
  rendered: string;
}

export interface NoJsRow {
  /** The page's URL, unique on the page. */
  id: string;
  path: string;
  section: string;
  raw: string;
  rendered: string;
  share: string;
  percent: number;
  status: { state: DoorView['pill']['state']; label: string };
  evidence: NoJsEvidence | null;
}

export interface NoJsView {
  frame: SegmentFrame;
  headline: { title: string; pill: DoorView['pill']; body: string };
  tiles: { label: string; value: string; note: string | null }[];
  /** FACTS K9: which pages were measured, and what Pro measures. */
  measuredSet: string;
  /** How many of the measured pages this record lists; null when it lists them all. */
  recordLine: string | null;
  /** The Pro offer's label: every page, and the CSV. */
  proLabel: string;
  rows: NoJsRow[];
  /** The row open when the page loads. */
  initial: string | null;
  /** Said for a selected page whose responses are not in the record. */
  missing: string;
  coverage: CoverageView;
  fixes: SectionFixesView;
  fixesNote: string | null;
  keep: { title: string; sub: string } | null;
}

type JsTextState = NonNullable<PageResult['without_js']>['state'];

const STATUS: Record<JsTextState, NoJsRow['status']> = {
  readable: { state: 'ok', label: 'readable' },
  partial: { state: 'warn', label: 'partial' },
  empty_shell: { state: 'bad', label: 'empty shell' },
};

/** A site whose text arrives this share or more without JavaScript is fine (the Result door's line). */
const READABLE = 0.9;

const pathOf = (url: string) => new URL(url).pathname;

function evidenceOf(tests: readonly AccessTest[], url: string): NoJsEvidence | null {
  const control = tests.find(
    (t) => t.ua === null && t.page_url === url && t.source_ip_class === 'fly_egress',
  );
  const render = tests.find(
    (t) => t.ua === null && t.page_url === url && t.source_ip_class === 'browser_rendering',
  );
  if (!control || !render) return null;
  const side = (t: AccessTest) =>
    [t.body_excerpt ?? '', t.word_count === null ? null : `${count(t.word_count)} words.`]
      .filter((x) => x !== null)
      .join('\n\n');
  return {
    title: `Evidence · ${pathOf(url)} · ${timeOfDay(render.tested_at)}`,
    caption: 'left, what the server sent · right, what a browser shows after scripts run',
    raw: side(control),
    rendered: side(render),
  };
}

/** "11–12%", or "12%" when the pages agree. */
function range(rows: readonly PageResult[]): string {
  const shares = rows.map((r) => percent(r.without_js!.text_share));
  const lo = Math.min(...shares);
  const hi = Math.max(...shares);
  return lo === hi ? `${lo}%` : `${lo}–${hi}%`;
}

/** `known` is null when no AI crawler read a template, so the thin ones cannot be told. */
function headline(check: Check, known: string[] | null, rows: readonly PageResult[]) {
  const thin = known ?? [];
  const share = check.without_js!.site_text_share;
  const pill: DoorView['pill'] = {
    state: share >= READABLE ? 'ok' : 'warn',
    label: `${percent(share)}% site-wide`,
  };
  const labelOf = (k: string) => check.coverage!.templates.find((t) => t.template_key === k)!.label;
  if (known === null) {
    return { pill, title: `${percent(share)}% of the text is in the HTML before JavaScript runs.` };
  }
  if (!thin.length) return { pill, title: 'Every template ships its text without JavaScript.' };
  const names = listOf(thin.map((k) => templateNoun(labelOf(k)).adjective));
  const measured = rows.filter((r) => thin.includes(r.template_key));
  const keeps = thin.length === 1 ? `template keeps` : `templates keep`;
  return {
    pill,
    title: measured.length
      ? `Your ${names} ${keeps} ${range(measured)} of ${plural(thin.length, 'its', 'their')} text without JavaScript.`
      : `Your ${names} ${plural(thin.length, 'template is', 'templates are')} near-empty without JavaScript.`,
  };
}

function body(check: Check, known: string[] | null, rows: readonly PageResult[]): string {
  const thin = known ?? [];
  const ai = check.crawlers.filter(isAi);
  const readers = ai.filter((c) => isAllowed(c.verdict)).map((c) => c.ua);
  const outside = ai.filter((c) => !isAllowed(c.verdict)).map((c) => c.ua);
  const templates = check.coverage!.templates;
  const nounOf = (k: string) => templateNoun(templates.find((t) => t.template_key === k)!.label);
  const parts: string[] = [];
  if (meetsEdge(check)) {
    parts.push(
      `${EDGE_SENTENCE} from our published IPs, tagged or not, so this was measured with a rendering browser rather than as the crawlers.`,
    );
  } else if (known === null) {
    parts.push(
      'No AI crawler got in, so their responses cannot say which templates arrive empty; this share was measured with a rendering browser.',
    );
  } else if (readers.length) {
    parts.push(
      `${listOf(readers)} read the HTML your server sends and do not run scripts${outside.length ? `; ${listOf(outside)} would too, once they get in` : ''}.`,
    );
  }
  for (const key of thin) {
    const measured = rows.filter((r) => r.template_key === key);
    const noun = nounOf(key);
    if (measured.length) {
      const words = (pick: (r: PageResult) => number) =>
        listOf(measured.map((r) => count(pick(r))));
      parts.push(
        `On ${measured.length === 1 ? pathOf(measured[0]!.url) : `the ${numberWord(measured.length)} ${noun.pages} measured`}, that HTML holds ${words((r) => r.without_js!.raw_words)} words; a browser renders ${words((r) => r.without_js!.rendered_words)}.`,
      );
    }
    const pages = templates.find((t) => t.template_key === key)!.pages;
    parts.push(`All ${count(pages)} ${noun.pages} share the template.`);
  }
  if (thin.length) {
    const fine = templates.filter((t) => !thin.includes(t.template_key));
    if (fine.length) {
      const names = fine.map((t) => templateNoun(t.label).inList);
      parts.push(
        `The ${listOf(names)} ${plural(fine.length, 'is', 'are')} fine${thin.length === 1 ? ', so this is one template, not a site-wide problem' : ''}.`,
      );
    }
  } else if (!meetsEdge(check)) {
    parts.push(
      `${percent(check.without_js!.site_text_share)}% of what a browser shows is there before scripts run.`,
    );
  }
  if (check.tested_at) parts.push(`Measured ${testedAt(check.tested_at)}.`);
  return parts.join(' ');
}

/** "No Pro-only fixes in this section. The three free fixes of this audit are this one, …". */
function fixesNote(fixes: SectionFixesView): string | null {
  if (!fixes.open.length || fixes.proCount) return null;
  const segmentOf = (s: FixSection) => Object.values(SEGMENTS).find((m) => m.section === s)!.tab;
  const free = fixes.open.length + fixes.openElsewhere.length;
  const others = fixes.openElsewhere.map(
    (f) => `${f.title.replace(/^./u, (c) => c.toLowerCase())} in ${segmentOf(f.section)}`,
  );
  const here = fixes.open.length === 1 ? 'this one' : `these ${numberWord(fixes.open.length)}`;
  return `No Pro-only fixes in this section. The ${numberWord(free)} free ${plural(free, 'fix', 'fixes')} of this audit ${plural(free, 'is', 'are')} ${
    others.length
      ? `${here}, ${others
          .slice(0, -1)
          .map((o) => `${o}, `)
          .join('')}and ${others.at(-1)}`
      : here
  }.`;
}

export function nojsView(
  d: FixtureDataset,
  checkId: string,
  options: SegmentOptions = {},
): NoJsView {
  const check = findCheck(d, checkId);
  const coverage = check.coverage;
  if (!coverage || !check.without_js) {
    throw new Error(`Check ${check.id} was not measured without JavaScript`);
  }
  const frame = segmentFrame(d, checkId, 'nojs', options);
  const templates = coverage.templates;
  const order = (k: string) => templates.findIndex((t) => t.template_key === k);
  const measured = d.page_results
    .filter((p) => p.check_id === check.id && p.sampled && p.without_js)
    .sort((a, b) => order(a.template_key) - order(b.template_key));
  const tests = d.access_tests.filter((t) => t.check_id === check.id);
  const known = clientRenderedTemplates(check);
  const thin = known ?? [];
  const rows: NoJsRow[] = measured.map((p) => {
    const t = templates.find((x) => x.template_key === p.template_key)!;
    const w = p.without_js!;
    return {
      id: p.url,
      path: pathOf(p.url),
      section: t.template_key === '/' ? t.label : `${t.label} · ${count(t.pages)}`,
      raw: count(w.raw_words),
      rendered: count(w.rendered_words),
      share: `${percent(w.text_share)}%`,
      percent: percent(w.text_share),
      status: STATUS[w.state],
      evidence: evidenceOf(tests, p.url),
    };
  });
  const featured =
    rows.find(
      (r) =>
        r.evidence && thin.some((k) => measured.find((p) => p.url === r.id)?.template_key === k),
    ) ??
    rows.find((r) => r.evidence) ??
    rows[0] ??
    null;
  const featuredPage = featured ? measured.find((p) => p.url === featured.id)! : null;
  const thinTemplate =
    thin.length === 1 ? templates.find((t) => t.template_key === thin[0]) : undefined;
  const census = coverage.sample_strategy.method === 'census';
  const withheld = d.withheld.find(
    (w) => w.check_id === check.id && w.collection === 'access_tests',
  );
  const fixes = sectionFixes(d, check, 'without_js');
  return {
    frame,
    headline: {
      ...headline(check, known, measured),
      body: body(check, known, measured),
    },
    tiles: [
      {
        label: 'Text without JavaScript, site',
        value: `${percent(check.without_js.site_text_share)}%`,
        note: null,
      },
      ...(thinTemplate
        ? [
            {
              label: `${capitalise(templateNoun(thinTemplate.label).pages)} sharing the template`,
              value: count(thinTemplate.pages),
              note: null,
            },
          ]
        : []),
      ...(featuredPage
        ? [
            {
              label: `Words on ${pathOf(featuredPage.url)}`,
              value: `${count(featuredPage.without_js!.raw_words)} raw · ${count(featuredPage.without_js!.rendered_words)} rendered`,
              note: null,
            },
          ]
        : []),
      {
        label: 'Pages measured',
        value: `${count(coverage.pages_sampled)} of ${count(coverage.pages_discovered)}`,
        note: null,
      },
    ],
    measuredSet: census
      ? 'Every page was measured without JavaScript.'
      : `${count(coverage.pages_sampled)} pages (at most ${coverage.sample_strategy.max_pages}), chosen across every template, measured without JavaScript; every page with Pro (10 full renders a month; Agency 30).`,
    recordLine:
      rows.length < coverage.pages_sampled
        ? `${count(rows.length)} of the ${count(coverage.pages_sampled)} measured pages are in this record.`
        : null,
    proLabel: census
      ? 'CSV with Pro'
      : `All ${count(coverage.pages_discovered)} pages and CSV with Pro`,
    rows,
    initial: featured?.id ?? null,
    missing: withheld
      ? `This record holds ${count(withheld.included)} of the ${count(withheld.total)} responses the audit kept, and this page’s are not among them.`
      : 'The audit kept no response for this page.',
    coverage: {
      tested: coverage.pages_sampled,
      total: coverage.pages_discovered,
      groups: templates.length,
    },
    fixes,
    fixesNote: fixesNote(fixes),
    keep: frame.keptUntil
      ? {
          title: `Keep this audit: an email when ${
            thin.length
              ? `the ${listOf(thin.map((k) => templateNoun(templates.find((t) => t.template_key === k)!.label).adjective))} ${plural(thin.length, 'template starts', 'templates start')} shipping ${plural(thin.length, 'its', 'their')} text`
              : 'a template stops shipping its text'
          }, and every fix for 14 days.`,
          sub: `One email creates a free account that re-checks monthly, with 14 days of Pro to start, including CSV and PDF export. Otherwise this page expires ${frame.keptUntil}.`,
        }
      : null,
  };
}
