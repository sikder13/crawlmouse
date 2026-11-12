/**
 * The alert (CC-28 D5): one email per site per check that fired a rule, to one recipient seat. It opens
 * with when the check ran and what it found (counted from the changes), then each grade whose letter
 * moved, then the rows: problems first, each saying what changed, where and on how many pages as one
 * phrase (`wherePhrase`), and how a grade moved. An opened change with a fix links to the fix's page.
 *
 * Every string from outside our code (the host, a change's summary and where, a crawler's name) is
 * made one line and bounded (escape.ts) and HTML-escaped in the HTML part. The only links are pages of
 * crawlmouse.com built here from ids, and the signed unsubscribe URL (D3, D7); the recipient's address
 * is not in the message.
 */
import type { Change, GradeLetter, GradeName } from '@crawlmouse/types/v2';
import { dayDate } from '../../format';
import { auditHrefs } from '../../view/audit-hrefs';
import { count, plural } from '../../words';
import { html, oneLine } from '../escape';
import { layout } from '../layout';
import type { RenderedMail, Template } from '../types';
import { clockTime } from './when';

/** Where the links in v2 mail point: pages this product serves. */
export const SITE_ORIGIN = 'https://crawlmouse.com';

/** The rows a message lists before it says how many more there are. */
export const MAIL_ROWS_MAX = 20;
/** Bounds, in code points, on the outside strings a row carries. */
export const BOUNDS = { host: 253, subjectHost: 120, summary: 200, where: 120, ua: 60 } as const;

export type MailChange = Pick<
  Change,
  'kind' | 'subject' | 'severity' | 'summary' | 'where' | 'pages_affected' | 'ua' | 'grade_deltas'
>;

/** An alert's change also names the fix it opened, which its row links to. */
export type AlertMailChange = MailChange & Pick<Change, 'fix_id'>;

export interface AlertMailInput {
  host: string;
  checkId: string;
  /** When the check finished, and the account's zone to read it in. */
  checkedAt: string;
  zone: string;
  changes: readonly AlertMailChange[];
  unsubscribeUrl: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A crawlmouse.com page for an id we hold; anything that is not an id is refused, not linked. */
export function pageUrl(path: '/audit/' | '/sites/', id: string): string {
  if (!UUID.test(id)) throw new RangeError('not an id');
  return `${SITE_ORIGIN}${path}${id}`;
}

/** A fix's page under the check that found it (`auditHrefs(checkId).fix(fixId)`); ids only. */
export function fixUrl(checkId: string, fixId: string): string {
  if (!UUID.test(checkId) || !UUID.test(fixId)) throw new RangeError('not an id');
  return `${SITE_ORIGIN}${auditHrefs(checkId).fix(fixId)}`;
}

export const GRADE_NAMES: Record<GradeName, string> = {
  technical_seo: 'Technical SEO',
  ai_readability: 'AI readability',
};

/** A problem: a row opened, or a grade that fell. */
export function isProblem(c: MailChange): boolean {
  return c.kind === 'opened' || c.grade_deltas.some((g) => g.to_score < g.from_score);
}

const RANK = { bad: 0, warn: 1, info: 2 } as const;
/** Problems first (opened by severity, then falling grades), then other changes, then resolutions. */
function order(c: MailChange): number {
  if (c.kind === 'opened') return c.severity ? RANK[c.severity] : 2;
  if (isProblem(c)) return 3;
  if (c.kind === 'resolved') return 5;
  return 4;
}

export function problemsFirst<T extends MailChange>(changes: readonly T[]): T[] {
  return changes
    .map((c, k) => ({ c, k }))
    .sort((a, b) => order(a.c) - order(b.c) || a.k - b.k)
    .map((x) => x.c);
}

const LABEL: Record<Change['kind'], string> = {
  opened: 'Problem',
  resolved: 'Resolved',
  changed: 'Changed',
  baseline: 'New baseline',
};

export interface RowText {
  label: string;
  /** The change in one line, outside strings bounded. */
  line: string;
  /** Where and on how many pages; the grade movement when there is one. */
  detail: string;
  /** The fix's page, for an opened change that names one in an alert; null otherwise. */
  fix: string | null;
}

/**
 * How the engine's site-wide `where` values read after a row's change (packages/engine/src/v2/diff/
 * changes.ts writes these literals); any other `where` (a path, a pattern, a template's noun) reads
 * "on <where>". Looked up with `Object.hasOwn`, so a where named like a prototype key is a where.
 */
const WHERE_PHRASES: Readonly<Record<string, string>> = {
  'all pages': 'across the site',
  'robots.txt': 'in robots.txt',
  stack: 'in the site’s stack',
};

export function wherePhrase(where: string): string {
  return Object.hasOwn(WHERE_PHRASES, where)
    ? WHERE_PHRASES[where]!
    : `on ${oneLine(where, BOUNDS.where)}`;
}

export function gradeMove(g: {
  grade: GradeName;
  from_grade: GradeLetter;
  to_grade: GradeLetter;
  from_score: number;
  to_score: number;
}): string {
  return `${GRADE_NAMES[g.grade]} ${g.from_grade} ${g.from_score} → ${g.to_grade} ${g.to_score}`;
}

export function rowText(c: MailChange): RowText {
  const pages = `${count(c.pages_affected)} ${plural(c.pages_affected, 'page', 'pages')}`;
  const ua = c.ua ? oneLine(c.ua, BOUNDS.ua) : '';
  const summary = oneLine(c.summary, BOUNDS.summary);
  // The crawler's name leads the line once: not added when the summary already starts with it as a
  // word ("ClaudeBot is now blocked", "GPTBot: allowed → …").
  const named =
    ua === '' || (summary.startsWith(ua) && /^(?:[\s:]|$)/.test(summary.slice(ua.length)));
  return {
    label: LABEL[c.kind],
    line: named ? summary : `${ua}: ${summary}`,
    detail: [wherePhrase(c.where), pages, ...c.grade_deltas.map(gradeMove)].join(' · '),
    fix: null,
  };
}

/** Each grade whose letter the changes moved: its first delta's start to its last delta's end. */
export function letterMoves(
  changes: readonly MailChange[],
): { grade: GradeName; from: GradeLetter; to: GradeLetter }[] {
  const out = new Map<GradeName, { grade: GradeName; from: GradeLetter; to: GradeLetter }>();
  for (const d of changes.flatMap((c) => c.grade_deltas)) {
    const was = out.get(d.grade);
    out.set(d.grade, { grade: d.grade, from: was?.from ?? d.from_grade, to: d.to_grade });
  }
  return (['technical_seo', 'ai_readability'] as const).flatMap((g) => {
    const m = out.get(g);
    return m && m.from !== m.to ? [m] : [];
  });
}

/** At most `MAIL_ROWS_MAX` rows, and how many were left out. */
export function capRows<T>(rows: readonly T[], max = MAIL_ROWS_MAX): { shown: T[]; more: number } {
  return { shown: rows.filter((_, k) => k < max), more: Math.max(0, rows.length - max) };
}

export const rowsHtml = (rows: readonly RowText[]) =>
  `<ul style="padding-left:18px;margin:0 0 16px">${rows
    .map(
      (r) =>
        `<li style="margin:0 0 10px"><strong>${html(r.label)}</strong> ${html(r.line)}<br><span style="color:#6b6257">${html(r.detail)}</span>${r.fix ? `<br><a href="${html(r.fix)}">${html(ALERT_COPY.fix)}</a>` : ''}</li>`,
    )
    .join('')}</ul>`;

export const rowsText = (rows: readonly RowText[]) =>
  rows
    .map(
      (r) =>
        `- ${r.label}: ${r.line}\n  ${r.detail}${r.fix ? `\n  ${ALERT_COPY.fix}: ${r.fix}` : ''}`,
    )
    .join('\n');

export const link = (href: string, text: string) =>
  `<p style="margin:0 0 12px"><a href="${html(href)}">${html(text)}</a></p>`;

export const ALERT_COPY = {
  subject: (host: string, n: number, problems: number) =>
    `${host}: ${count(n)} ${plural(n, 'change', 'changes')}${problems ? `, ${count(problems)} ${plural(problems, 'problem', 'problems')}` : ''}`,
  title: (host: string) => `Changes on ${host}`,
  /** What the check found, counted from the changes the alert lists: problems, then the others. */
  intro: (when: string, problems: number, others: number) => {
    const p = `${count(problems)} ${plural(problems, 'problem', 'problems')}`;
    const o = (word: string, words: string) => `${count(others)} ${plural(others, word, words)}`;
    const found =
      problems === 0
        ? o('change', 'changes')
        : others === 0
          ? p
          : `${p} and ${o('other change', 'other changes')}`;
    return `The check on ${when} found ${found}.`;
  },
  grades: (moves: ReturnType<typeof letterMoves>) =>
    moves.map((m) => `${GRADE_NAMES[m.grade]} ${m.from} → ${m.to}`).join(' · '),
  fix: 'Open the fix',
  more: (n: number) => `And ${count(n)} more on the check’s page.`,
  open: 'Open the check',
  rules: 'Change your alert rules',
  why: 'You get this because email alerts are on for you in a Crawlmouse account that watches this site.',
};

export const alertTemplate: Template<AlertMailInput> = (input): RenderedMail => {
  const host = oneLine(input.host, BOUNDS.host);
  const all = problemsFirst(input.changes);
  const { shown, more } = capRows(all);
  const rows = shown.map((c) => ({
    ...rowText(c),
    fix: c.kind === 'opened' && c.fix_id ? fixUrl(input.checkId, c.fix_id) : null,
  }));
  const when = `${dayDate(input.checkedAt, input.zone)} at ${clockTime(input.checkedAt, input.zone)}`;
  const check = pageUrl('/audit/', input.checkId);
  const rules = `${SITE_ORIGIN}/alerts`;
  const problems = all.filter(isProblem).length;
  const intro = ALERT_COPY.intro(when, problems, all.length - problems);
  const moves = letterMoves(all);
  const grades = moves.length ? ALERT_COPY.grades(moves) : null;
  const title = ALERT_COPY.title(host);
  const body = [
    `<p style="margin:0 0 16px">${html(intro)}</p>`,
    grades ? `<p style="margin:0 0 16px"><strong>${html(grades)}</strong></p>` : '',
    rowsHtml(rows),
    more ? `<p style="margin:0 0 16px">${html(ALERT_COPY.more(more))}</p>` : '',
    link(check, ALERT_COPY.open),
    link(rules, ALERT_COPY.rules),
  ].join('');
  const text = [
    title,
    '',
    intro,
    '',
    ...(grades ? [grades, ''] : []),
    rowsText(rows),
    ...(more ? ['', ALERT_COPY.more(more)] : []),
    '',
    `${ALERT_COPY.open}: ${check}`,
    `${ALERT_COPY.rules}: ${rules}`,
    '',
    ALERT_COPY.why,
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ].join('\n');
  return {
    subject: ALERT_COPY.subject(oneLine(input.host, BOUNDS.subjectHost), all.length, problems),
    text,
    html: layout({ title, body, why: ALERT_COPY.why, unsubscribeUrl: input.unsubscribeUrl }),
  };
};
