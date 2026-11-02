/**
 * The change rows that are not a fix opening or resolving (grade, crawler, robots.txt, deploy, a new
 * baseline), and the row a fix writes. Every sentence is built from the values it names.
 */
import {
  UNMEASURED_VERDICTS,
  type Change,
  type Check,
  type CrawlerResult,
  type Fix,
  type FixEvent,
  type FixStatus,
  type GradeLetter,
  type GradeName,
  type Verdict,
} from '@crawlmouse/types/v2';
import { toPersistableText } from '../../text-safety.js';
import { severityOf } from './severity.js';
import { FIX_SUBJECT } from './subjects.js';
import { stableId } from './ids.js';
import type { LineDiff } from './robots-diff.js';

/**
 * The smallest move in a grade's score that writes a row when its letter stays the same.
 * Provisional, until the ground-truth corpus (CC-18) says how much a score moves between two checks
 * of an unchanged site.
 */
export const MIN_GRADE_SCORE_DELTA = 1;

/** What the contract allows a row to quote of a changed file (Change.cause.diff). */
export const QUOTED_LINES = 50;
export const QUOTED_LINE_BYTES = 500;

type Row = Omit<Change, 'id'>;
type ChangeKind = Change['kind'];

/** The fields every row of one check shares. */
export interface RowContext {
  site_id: string;
  check_id: string;
  previous_check_id: string | null;
  detected_at: string;
  /** Pages the crawl reached on this check: what a site-wide change affects. */
  pages_crawled: number;
}

function withId(row: Row): Change {
  const id = stableId(
    'change',
    row.check_id,
    row.kind,
    row.subject,
    row.ua ?? '',
    row.fix_id ?? '',
    row.where,
  );
  return { id, ...row };
}

/**
 * A row of this check. Its severity is decided here (`severityOf`), from its kind and the fix it
 * opens or resolves, so every row is stored with the severity alerts will read.
 */
function row(
  ctx: RowContext,
  fields: Omit<Row, keyof Omit<RowContext, 'pages_crawled'> | 'notified' | 'severity'>,
  fix: Pick<Fix, 'effect'> | null = null,
): Change {
  const { site_id, check_id, previous_check_id, detected_at } = ctx;
  const { kind, ...rest } = fields;
  const severity = severityOf({ kind }, fix);
  return withId({
    site_id,
    check_id,
    previous_check_id,
    detected_at,
    kind,
    severity,
    ...rest,
    notified: null,
  });
}

export function baselineRow(ctx: RowContext, from: string, to: string): Change {
  return row(ctx, {
    kind: 'baseline',
    subject: 'grade',
    summary: `New baseline: grading changed from ${from} to ${to}; earlier results are not compared.`,
    where: 'all pages',
    pages_affected: ctx.pages_crawled,
    ua: null,
    grade_deltas: [],
    cause: null,
    fix_id: null,
  });
}

const GRADE_LABEL: Readonly<Record<GradeName, string>> = {
  technical_seo: 'Technical SEO',
  ai_readability: 'AI readability',
};

/** The grades a check measured: Technical SEO unless refused, AI readability unless withheld. */
function measuredGrades(c: Check): Map<GradeName, { score: number; grade: GradeLetter }> {
  const out = new Map<GradeName, { score: number; grade: GradeLetter }>();
  const t = c.technical_seo;
  if (t && t.score !== null && t.grade !== null) {
    out.set('technical_seo', { score: t.score, grade: t.grade });
  }
  const a = c.ai_readability;
  if (a && !a.withheld) out.set('ai_readability', { score: a.total, grade: a.grade });
  return out;
}

export function gradeRow(ctx: RowContext, before: Check, after: Check): Change | null {
  const was = measuredGrades(before);
  const now = measuredGrades(after);
  const deltas: Change['grade_deltas'] = [];
  for (const grade of Object.keys(GRADE_LABEL) as GradeName[]) {
    const from = was.get(grade);
    const to = now.get(grade);
    if (!from || !to) continue;
    const moved =
      from.grade !== to.grade || Math.abs(to.score - from.score) >= MIN_GRADE_SCORE_DELTA;
    if (!moved) continue;
    deltas.push({
      grade,
      from_score: from.score,
      to_score: to.score,
      from_grade: from.grade,
      to_grade: to.grade,
    });
  }
  if (deltas.length === 0) return null;
  return row(ctx, {
    kind: 'changed',
    subject: 'grade',
    summary: deltas
      .map(
        (d) =>
          `${GRADE_LABEL[d.grade]} ${d.from_grade} → ${d.to_grade} (${d.from_score} → ${d.to_score})`,
      )
      .join('; '),
    where: 'all pages',
    pages_affected: ctx.pages_crawled,
    ua: null,
    grade_deltas: deltas,
    cause: null,
    fix_id: null,
  });
}

/** How a verdict reads in a row's summary. The two unmeasured verdicts never reach a row. */
export const VERDICT_PHRASE: Readonly<Record<Verdict, string>> = {
  allowed: 'allowed',
  allowed_thin: 'allowed, reading little text',
  disallowed_by_robots: 'disallowed by robots.txt',
  blocked_by_ua_rule: 'blocked by a user-agent rule',
  challenged_ua: 'challenged',
  refused_unverified: 'refused as unverified',
  rate_limited: 'rate limited',
  payment_required: 'asked to pay',
  edge_blocks_automation: 'blocked our test requests',
  redirected_away: 'redirected away',
  not_measured: 'not measured',
};
export const ACCESS: readonly Verdict[] = ['allowed', 'allowed_thin'];

/**
 * A row for each crawler both checks tested and measured whose verdict moved, in user-agent order:
 * `opened` when it lost access, `resolved` when it regained it, `changed` otherwise. A move to or
 * from a robots.txt disallow is placed in robots.txt and quotes its diff, when both checks read it.
 */
export function crawlerRows(
  ctx: RowContext,
  before: Check,
  after: Check,
  robots: LineDiff | null,
): Change[] {
  const measured = (c: Check) =>
    new Map(
      c.crawlers
        .filter((r) => !UNMEASURED_VERDICTS.includes(r.verdict))
        .map((r) => [r.ua, r] as const),
    );
  const was = measured(before);
  const now = measured(after);
  const rows: Change[] = [];
  for (const ua of [...now.keys()].sort()) {
    const from = was.get(ua)?.verdict;
    const to = now.get(ua)!.verdict;
    if (from === undefined || from === to) continue;
    const viaRobots = from === 'disallowed_by_robots' || to === 'disallowed_by_robots';
    rows.push(
      row(ctx, {
        kind: accessMove(from, to),
        subject: 'crawler_access',
        summary: `${ua}: ${VERDICT_PHRASE[from]} → ${VERDICT_PHRASE[to]}`,
        where: viaRobots ? 'robots.txt' : 'all pages',
        pages_affected: ctx.pages_crawled,
        ua,
        grade_deltas: [],
        cause: viaRobots && robots ? robotsCause(robots) : null,
        fix_id: null,
      }),
    );
  }
  return rows;
}

function accessMove(from: CrawlerResult['verdict'], to: CrawlerResult['verdict']): ChangeKind {
  const had = ACCESS.includes(from);
  const has = ACCESS.includes(to);
  if (had && !has) return 'opened';
  if (!had && has) return 'resolved';
  return 'changed';
}

export function robotsRow(ctx: RowContext, diff: LineDiff): Change {
  return row(ctx, {
    kind: 'changed',
    subject: 'crawler_access',
    summary: 'robots.txt changed',
    where: 'robots.txt',
    pages_affected: ctx.pages_crawled,
    ua: null,
    grade_deltas: [],
    cause: robotsCause(diff),
    fix_id: null,
  });
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * The cause a robots.txt change carries: its counts, and the changed lines quoted within what the
 * contract allows. What is not quoted, or is cut, is said.
 */
function robotsCause(diff: LineDiff): NonNullable<Change['cause']> {
  const quote = (lines: string[]) =>
    lines
      .filter((_, k) => k < QUOTED_LINES)
      .map((line) => toPersistableText(line, QUOTED_LINE_BYTES));
  const removed = quote(diff.removed);
  const added = quote(diff.added);
  let text = `robots.txt changed: ${count(diff.added.length, 'line')} added, ${diff.removed.length} removed.`;
  const unquotedAdded = diff.added.length - added.length;
  const unquotedRemoved = diff.removed.length - removed.length;
  if (unquotedAdded + unquotedRemoved > 0) {
    text += ` The first ${QUOTED_LINES} each way are quoted; ${unquotedAdded} added and ${unquotedRemoved} removed are not.`;
  }
  const changedBy = (quoted: string[], lines: string[]) =>
    quoted.filter((q, k) => q !== lines[k]).length;
  const altered = changedBy(removed, diff.removed) + changedBy(added, diff.added);
  if (altered > 0) {
    text += ` ${count(altered, 'quoted line')} ${altered === 1 ? 'is' : 'are'} cut to ${QUOTED_LINE_BYTES} bytes or cleaned of control characters.`;
  }
  return { text, changed_at: null, diff: { removed, added } };
}

/** The stack as a reader names it, part by part. */
function stackParts(c: Check): Record<'frontend' | 'backend' | 'edge', string> | null {
  const s = c.stack;
  if (!s) return null;
  const f = s.frontend;
  return {
    frontend: f
      ? `${f.name}${f.version ? ` ${f.version}` : ''}${f.router ? ` (${f.router})` : ''}`
      : 'none',
    backend: s.backend ? s.backend.cms : 'none',
    edge: s.edge ? s.edge.vendor : 'none',
  };
}

/** A row when the detected stack differs; how each part was detected is evidence, not the stack. */
export function deployRow(ctx: RowContext, before: Check, after: Check): Change | null {
  const was = stackParts(before);
  const now = stackParts(after);
  if (!was || !now) return null;
  const moved = (Object.keys(now) as (keyof typeof now)[]).filter(
    (part) => was[part] !== now[part],
  );
  if (moved.length === 0) return null;
  return row(ctx, {
    kind: 'changed',
    subject: 'deploy',
    summary: `Stack changed: ${moved.map((p) => `${p} ${was[p]} → ${now[p]}`).join('; ')}`,
    where: 'stack',
    pages_affected: ctx.pages_crawled,
    ua: null,
    grade_deltas: [],
    cause: null,
    fix_id: null,
  });
}

/**
 * The row a fix writes when it opens or resolves. A fix opened again after it was marked done or
 * resolved says so, with the day, from its events.
 */
export function fixRow(
  ctx: RowContext,
  fix: Fix,
  kind: 'opened' | 'resolved',
  prior: FixStatus | 'none',
  events: readonly FixEvent[],
): Change {
  return row(
    ctx,
    {
      kind,
      subject: FIX_SUBJECT[fix.type],
      summary: kind === 'opened' ? fix.title : `Resolved: ${fix.title}`,
      where: fix.template_key ?? 'all pages',
      pages_affected: fix.affected_pages,
      ua: fix.crawler_uas.length === 1 ? fix.crawler_uas[0]! : null,
      grade_deltas: [],
      cause: kind === 'opened' ? reopenNote(prior, events) : null,
      fix_id: fix.id,
    },
    fix,
  );
}

function reopenNote(prior: FixStatus | 'none', events: readonly FixEvent[]): Change['cause'] {
  const lastOf = (kind: FixEvent['kind']) => events.filter((e) => e.kind === kind).at(-1);
  // The calendar day (UTC) of an ISO timestamp: the part before its `T`.
  const day = (e: FixEvent) => e.at.split('T')[0]!;
  const marked = lastOf('marked_done');
  const verified = lastOf('verified');
  if ((prior === 'marked_done' || prior === 'unable_to_verify') && marked) {
    return {
      text: `Marked done on ${day(marked)}, and found again on this check.`,
      changed_at: null,
      diff: null,
    };
  }
  if (prior === 'verified_resolved' && verified) {
    return {
      text: `Resolved on ${day(verified)}, and found again on this check.`,
      changed_at: null,
      diff: null,
    };
  }
  return null;
}
