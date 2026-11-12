/**
 * The alert (CC-28 D5): one email per site per check that fired a rule, to one recipient seat. Problems
 * first, then the rest; each row says what changed, where, on how many pages, and how a grade moved.
 *
 * Every string from outside our code (the host, a change's summary and where, a crawler's name) is
 * made one line and bounded (escape.ts) and HTML-escaped in the HTML part. The only links are pages of
 * crawlmouse.com built here from ids, and the signed unsubscribe URL (D3, D7); the recipient's address
 * is not in the message.
 */
import type { Change, GradeLetter, GradeName } from '@crawlmouse/types/v2';
import { dayDate, hourMinute } from '../../format';
import { count, plural } from '../../words';
import { html, oneLine } from '../escape';
import { layout } from '../layout';
import type { RenderedMail, Template } from '../types';

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

export interface AlertMailInput {
  host: string;
  checkId: string;
  /** When the check finished, and the account's zone to read it in. */
  checkedAt: string;
  zone: string;
  changes: readonly MailChange[];
  unsubscribeUrl: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A crawlmouse.com page for an id we hold; anything that is not an id is refused, not linked. */
export function pageUrl(path: '/audit/' | '/sites/', id: string): string {
  if (!UUID.test(id)) throw new RangeError('not an id');
  return `${SITE_ORIGIN}${path}${id}`;
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
  const ua = c.ua ? `${oneLine(c.ua, BOUNDS.ua)}: ` : '';
  const summary = oneLine(c.summary, BOUNDS.summary);
  return {
    label: LABEL[c.kind],
    line: summary.startsWith(ua) ? summary : `${ua}${summary}`,
    detail: [`${oneLine(c.where, BOUNDS.where)}, ${pages}`, ...c.grade_deltas.map(gradeMove)].join(
      ' · ',
    ),
  };
}

/** At most `MAIL_ROWS_MAX` rows, and how many were left out. */
export function capRows<T>(rows: readonly T[], max = MAIL_ROWS_MAX): { shown: T[]; more: number } {
  return { shown: rows.filter((_, k) => k < max), more: Math.max(0, rows.length - max) };
}

export const rowsHtml = (rows: readonly RowText[]) =>
  `<ul style="padding-left:18px;margin:0 0 16px">${rows
    .map(
      (r) =>
        `<li style="margin:0 0 10px"><strong>${html(r.label)}</strong> ${html(r.line)}<br><span style="color:#6b6257">${html(r.detail)}</span></li>`,
    )
    .join('')}</ul>`;

export const rowsText = (rows: readonly RowText[]) =>
  rows.map((r) => `- ${r.label}: ${r.line}\n  ${r.detail}`).join('\n');

export const link = (href: string, text: string) =>
  `<p style="margin:0 0 12px"><a href="${html(href)}">${html(text)}</a></p>`;

export const ALERT_COPY = {
  subject: (host: string, n: number, problems: number) =>
    `${host}: ${count(n)} ${plural(n, 'change', 'changes')}${problems ? `, ${count(problems)} ${plural(problems, 'problem', 'problems')}` : ''}`,
  title: (host: string) => `Changes on ${host}`,
  intro: (when: string) => `The check that finished ${when} found what your alert rules cover.`,
  more: (n: number) => `And ${count(n)} more on the check’s page.`,
  open: 'Open the check',
  rules: 'Change your alert rules',
  why: 'You get this because email alerts are on for you in a Crawlmouse account that watches this site.',
};

export const alertTemplate: Template<AlertMailInput> = (input): RenderedMail => {
  const host = oneLine(input.host, BOUNDS.host);
  const all = problemsFirst(input.changes);
  const { shown, more } = capRows(all);
  const rows = shown.map(rowText);
  const when = `${dayDate(input.checkedAt, input.zone)} ${hourMinute(input.checkedAt, input.zone)}`;
  const check = pageUrl('/audit/', input.checkId);
  const rules = `${SITE_ORIGIN}/alerts`;
  const problems = all.filter(isProblem).length;
  const title = ALERT_COPY.title(host);
  const body = [
    `<p style="margin:0 0 16px">${html(ALERT_COPY.intro(when))}</p>`,
    rowsHtml(rows),
    more ? `<p style="margin:0 0 16px">${html(ALERT_COPY.more(more))}</p>` : '',
    link(check, ALERT_COPY.open),
    link(rules, ALERT_COPY.rules),
  ].join('');
  const text = [
    title,
    '',
    ALERT_COPY.intro(when),
    '',
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
