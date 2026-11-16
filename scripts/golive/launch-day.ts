/**
 * The check-failure abort line of docs/ops/launch-day.md (CC-38 D6), as data: the floor of ended
 * checks below which the line is not read, the rate over which it is crossed, and which of the
 * pipeline's failure reasons count. The reasons are the pipeline's own (`FAILURE_REASONS`,
 * inngest/check-events.ts); what each means is the app's phrase for it (`FAILURE_COPY`,
 * apps/web/app/audit/[id]/_lib/failure-copy.ts). Only the "ours" mark is written here, typed by the
 * reason so a reason added to the pipeline does not compile until it is marked.
 *
 * The page's block between its check-failure markers is `renderCheckFailure()`, pinned by
 * launch-day.test.ts. Write it:
 *
 *   pnpm --filter @crawlmouse/scripts exec tsx golive/launch-day.ts --write
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAILURE_COPY } from '../../apps/web/app/audit/[id]/_lib/failure-copy';
import { FAILURE_REASONS, type FailureReason } from '../../inngest/check-events';
import { REPO_ROOT } from './env-scan';

/** The fewest checks ended in the hour for the rate to be read at all. */
export const CHECK_FAILURE_FLOOR = 20;
/** The rate, in percent of the checks ended in the hour, over which the line is crossed. */
export const CHECK_FAILURE_LINE = 20;

/** Whether a failure with this reason is ours to count, and why not when it is not. */
export const REASON_COUNTED: Readonly<Record<FailureReason, true | { notCounted: string }>> = {
  paused: {
    notCounted:
      'a pause is the owner setting `CRAWL_PAUSED`, a decision already taken, not a fault',
  },
  site_busy: {
    notCounted: 'a second check of a site asked for while its first still ran, refused by design',
  },
  // A visitor’s cancel and the run’s finish timeout are stored alike (Q18); a timeout is a fault of ours
  // more often than a cancel is a visitor's, so the line counts both.
  canceled: true,
  stalled: true,
  not_started: true,
  worker_redeployed: true,
  worker_unavailable: true,
  build_failed: true,
  persist_failed: true,
  internal: true,
};

export const COUNTED_REASONS: readonly FailureReason[] = FAILURE_REASONS.filter(
  (r) => REASON_COUNTED[r] === true,
);

const quoted = (rs: readonly string[]) => rs.map((r) => `'${r}'`).join(', ');

/**
 * The query the CTO runs each hour; `abort` is the line, floor included. Columns are named with
 * their table, so the CC-33 join the page describes adds no ambiguous name.
 */
export function checkFailureSql(): string {
  const pct = '100.0 * count(*) filter (where ours) / nullif(count(*), 0)';
  return [
    'with ended as (',
    "  select checks.status = 'failed' as failed,",
    "         checks.status = 'failed' and checks.failure_reason in (",
    `           ${quoted(COUNTED_REASONS)}`,
    '         ) as ours',
    '  from public.checks',
    "  where checks.finished_at > now() - interval '1 hour'",
    ')',
    'select count(*) filter (where ours) as failed_ours,',
    '       count(*) filter (where failed) as failed_any,',
    '       count(*) as ended,',
    `       round(${pct}, 1) as failed_pct,`,
    `       count(*) >= ${CHECK_FAILURE_FLOOR} and coalesce(${pct} > ${CHECK_FAILURE_LINE}, false) as abort`,
    'from ended;',
  ].join('\n');
}

/** The page's block: the query, then each reason with the app's phrase and whether it counts. */
export function renderCheckFailure(): string {
  return [
    '```sql',
    checkFailureSql(),
    '```',
    '',
    `\`abort\` is true when at least ${CHECK_FAILURE_FLOOR} checks ended in the hour and more than ${CHECK_FAILURE_LINE}% of them failed with a reason counted below. Below the floor the rate is not read; the other rows of the watch still are.`,
    '',
    'The reasons a check fails with, each with what the result page tells its visitor:',
    '',
    ...FAILURE_REASONS.map((r) => {
      const mark = REASON_COUNTED[r];
      return mark === true
        ? `- \`${r}\`, counted: ${FAILURE_COPY[r]}`
        : `- \`${r}\`, not counted: ${FAILURE_COPY[r]}; ${mark.notCounted}`;
    }),
  ].join('\n');
}

export const PAGE = join(REPO_ROOT, 'docs/ops/launch-day.md');
export const CHECK_FAILURE_START = '<!-- launch-day:check-failure:start -->';
export const CHECK_FAILURE_END = '<!-- launch-day:check-failure:end -->';

/** The page with its check-failure block replaced by the render. */
export function withCheckFailure(page: string): string {
  const start = page.indexOf(CHECK_FAILURE_START);
  const end = page.indexOf(CHECK_FAILURE_END);
  if (start < 0 || end < start) throw new Error('the check-failure markers are missing');
  return `${page.slice(0, start + CHECK_FAILURE_START.length)}\n\n${renderCheckFailure()}\n\n${page.slice(end)}`;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1] &&
  process.argv.includes('--write')
) {
  writeFileSync(PAGE, withCheckFailure(readFileSync(PAGE, 'utf8')));
  console.log(`wrote ${PAGE}`);
}
