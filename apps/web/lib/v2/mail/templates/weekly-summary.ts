/**
 * The weekly summary (CC-28 D6): one email per account per week, to one recipient seat, listing the
 * week's changes by site. Sites with a problem come first; within a site, problems first; each site
 * says how its grades moved over the week. It is never rendered empty: a week with no change sends
 * nothing (the caller's rule), and this refuses one.
 *
 * Outside strings are bounded and escaped as in the alert (alert.ts); the only links are crawlmouse.com
 * pages built from ids, and the signed unsubscribe URL.
 */
import type { GradeName } from '@crawlmouse/types/v2';
import { dayMonth } from '../../format';
import { count, plural } from '../../words';
import { html, oneLine } from '../escape';
import { layout } from '../layout';
import type { RenderedMail, Template } from '../types';
import {
  BOUNDS,
  capRows,
  GRADE_NAMES,
  isProblem,
  link,
  pageUrl,
  problemsFirst,
  rowsHtml,
  rowsText,
  rowText,
  SITE_ORIGIN,
  type MailChange,
} from './alert';

/** The rows one site lists before it says how many more there are. */
export const SUMMARY_SITE_ROWS = 10;

export type SummaryChange = MailChange & { detected_at: string };

export interface SummarySite {
  siteId: string;
  host: string;
  changes: readonly SummaryChange[];
}

export interface WeeklySummaryInput {
  /** The week covered: from `since` up to `until`, read in the account's zone. */
  since: string;
  until: string;
  zone: string;
  sites: readonly SummarySite[];
  unsubscribeUrl: string;
}

export interface GradeMovement {
  grade: GradeName;
  from: string;
  to: string;
  fromScore: number;
  toScore: number;
}

/** Each grade's move over the week: its first delta's start to its last delta's end, by time. */
export function gradeMovement(changes: readonly SummaryChange[]): GradeMovement[] {
  const timed = [...changes].sort((a, b) => Date.parse(a.detected_at) - Date.parse(b.detected_at));
  const out = new Map<GradeName, GradeMovement>();
  for (const c of timed) {
    for (const d of c.grade_deltas) {
      const was = out.get(d.grade);
      out.set(d.grade, {
        grade: d.grade,
        from: was?.from ?? d.from_grade,
        fromScore: was?.fromScore ?? d.from_score,
        to: d.to_grade,
        toScore: d.to_score,
      });
    }
  }
  return (['technical_seo', 'ai_readability'] as const).flatMap((g) => out.get(g) ?? []);
}

export const SUMMARY_COPY = {
  subject: (n: number, sites: number, problems: number) =>
    `Your week on Crawlmouse: ${count(n)} ${plural(n, 'change', 'changes')} on ${count(sites)} ${plural(sites, 'site', 'sites')}${problems ? `, ${count(problems)} ${plural(problems, 'problem', 'problems')}` : ''}`,
  title: 'Your week',
  intro: (since: string, until: string) => `What your checks found from ${since} to ${until}.`,
  site: (host: string, n: number) => `${host}: ${count(n)} ${plural(n, 'change', 'changes')}`,
  grades: (moves: readonly GradeMovement[]) =>
    moves.length
      ? `Grades: ${moves.map((m) => `${GRADE_NAMES[m.grade]} ${m.from} ${m.fromScore} → ${m.to} ${m.toScore}`).join(', ')}`
      : 'No grade moved.',
  more: (n: number) => `And ${count(n)} more on the site’s page.`,
  openSite: 'Open the site',
  log: 'See every change',
  why: 'You get this weekly summary because it is on for you in a Crawlmouse account.',
};

const siteOrder = (a: SummarySite, b: SummarySite) =>
  Number(b.changes.some(isProblem)) - Number(a.changes.some(isProblem)) ||
  a.host.localeCompare(b.host);

export const weeklySummaryTemplate: Template<WeeklySummaryInput> = (input): RenderedMail => {
  const sites = input.sites.filter((s) => s.changes.length > 0);
  if (sites.length === 0) throw new RangeError('a weekly summary with no change');
  const ordered = [...sites].sort(siteOrder);
  const total = sites.reduce((n, s) => n + s.changes.length, 0);
  const problems = sites.reduce((n, s) => n + s.changes.filter(isProblem).length, 0);
  // `until` is the start of the next week: the last day covered is the one before it.
  const lastDay = new Date(Date.parse(input.until) - 1).toISOString();
  const intro = SUMMARY_COPY.intro(
    dayMonth(input.since, input.zone),
    dayMonth(lastDay, input.zone),
  );
  const log = `${SITE_ORIGIN}/changes`;

  const htmlParts: string[] = [`<p style="margin:0 0 16px">${html(intro)}</p>`];
  const textParts: string[] = [SUMMARY_COPY.title, '', intro];
  for (const s of ordered) {
    const host = oneLine(s.host, BOUNDS.host);
    const { shown, more } = capRows(problemsFirst(s.changes), SUMMARY_SITE_ROWS);
    const rows = shown.map(rowText);
    const grades = SUMMARY_COPY.grades(gradeMovement(s.changes));
    const href = pageUrl('/sites/', s.siteId);
    const heading = SUMMARY_COPY.site(host, s.changes.length);
    htmlParts.push(
      `<h2 style="font-size:16px;margin:20px 0 8px">${html(heading)}</h2>`,
      `<p style="margin:0 0 8px">${html(grades)}</p>`,
      rowsHtml(rows),
      more ? `<p style="margin:0 0 8px">${html(SUMMARY_COPY.more(more))}</p>` : '',
      link(href, SUMMARY_COPY.openSite),
    );
    textParts.push(
      '',
      heading,
      grades,
      rowsText(rows),
      ...(more ? [SUMMARY_COPY.more(more)] : []),
      `${SUMMARY_COPY.openSite}: ${href}`,
    );
  }
  htmlParts.push(link(log, SUMMARY_COPY.log));
  textParts.push(
    '',
    `${SUMMARY_COPY.log}: ${log}`,
    '',
    SUMMARY_COPY.why,
    `Unsubscribe: ${input.unsubscribeUrl}`,
  );
  return {
    subject: SUMMARY_COPY.subject(total, sites.length, problems),
    text: textParts.join('\n'),
    html: layout({
      title: SUMMARY_COPY.title,
      body: htmlParts.join(''),
      why: SUMMARY_COPY.why,
      unsubscribeUrl: input.unsubscribeUrl,
    }),
  };
};
