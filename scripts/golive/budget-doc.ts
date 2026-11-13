/**
 * Renders `docs/ops/inngest-budget.md` from `budget.ts`, so every number in it comes from the model
 * (OPERATING-RULES §10: prose that names measured data is rendered from the data).
 *
 *   pnpm --filter @crawlmouse/scripts exec tsx golive/budget-doc.ts --write
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  DAYS_PER_MONTH,
  FUNCTIONS,
  HOBBY_HEADROOM_LINE,
  HOBBY_MONTHLY_EXECUTIONS,
  alertFiring,
  allShapes,
  checkExecutions,
  cronPerDay,
  finishedFanOut,
  floorBySwitchOn,
  hobbyVerdict,
  monthlyFloor,
  monthlyTotal,
  oneMail,
  scenarios,
  v1Floor,
} from './budget';

export const DOC_PATH = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../docs/ops/inngest-budget.md',
);

const n = (x: number): string => x.toLocaleString('en-US');
const CHECK_COUNTS = [100, 1_000, 5_000] as const;

export async function renderBudget(): Promise<string> {
  const crons = FUNCTIONS.filter((f) => f.runsPerDay > 0);
  const events = FUNCTIONS.filter((f) => f.runsPerDay === 0);
  const verdict = await hobbyVerdict();
  const lines: string[] = [
    '# Inngest execution budget',
    '',
    '<!-- Rendered by scripts/golive/budget-doc.ts from scripts/golive/budget.ts. Do not edit by hand:',
    '     change the model and run `pnpm --filter @crawlmouse/scripts exec tsx golive/budget-doc.ts --write`. -->',
    '',
    `Inngest's Hobby plan allows ${n(HOBBY_MONTHLY_EXECUTIONS)} executions a month. Each function run is one`,
    'execution and each step (`step.run`, `step.sleep*`, `step.waitForEvent`, `step.sendEvent`,',
    '`step.invoke`) is one more. When the quota is used, every function pauses until the next month or an',
    "upgrade: v1's audits, the checks, the mail and the crons alike (inngest.com/pricing, read 2026-11-13).",
    '',
    'How the numbers are made: a check is counted by running the real `runCheck` (`inngest/check.ts`)',
    "against a scripted worker with a counting `step` (`checkExecutions`). Every other function's steps",
    "are a row of `FUNCTIONS`. `scripts/golive/budget.test.ts` fails when a file's step call sites differ",
    "from the sum of its rows' call sites, when a cron row's schedule differs from the cron literal in",
    'its file (its runs a day are read from that schedule), when a line an event row cites holds no step',
    "call, and when this file differs from its render. An event row's steps a run are written by hand",
    'from the step calls it cites; no test derives that number from the code.',
    '',
    `## The fixed floor: crons with nothing due, all four flags on, ${DAYS_PER_MONTH} days`,
    '',
    '| Function | File | Registered with | Schedule | Steps when idle | Executions a day |',
    '| --- | --- | --- | --- | --- | --- |',
    ...crons.map(
      (f) =>
        `| \`${f.id}\` | \`${f.file}\` | ${f.registration} | ${f.trigger} | ${f.steps} (${f.stepsHow}) | ${n(cronPerDay(f))} |`,
    ),
    '',
    `**Floor: ${n(monthlyFloor())} executions a month.** v1's own crons are ${n(v1Floor())} of it, counted as`,
    "they run with V2_BILLING on (the reconcile's second step); with every flag off they are one step fewer a day.",
    '',
    '### The floor after each switch-on step',
    '',
    '| After setting | Floor a month |',
    '| --- | --- |',
    ...floorBySwitchOn().map(({ flags, floor }) => `| ${flags.join(', ')} | ${n(floor)} |`),
    '',
    'A cron registered under two flags (`V2_PIPELINE+V2_CHECKS_PUBLIC`) starts with the second of them.',
    '',
    '## Event functions, per event',
    '',
    '| Function | File | Registered with | Trigger | Steps a run | Step calls |',
    '| --- | --- | --- | --- | --- | --- |',
    ...events.map(
      (f) =>
        `| \`${f.id}\` | \`${f.file}\` | ${f.registration} | ${f.trigger} | ${f.id === 'crawlmouse.check.run' ? 'see the check shapes' : `${f.steps} (${f.stepsHow})`} | ${(f.stepAt ?? []).map((l) => `\`${f.file}:${l}\``).join(', ') || 'measured'} |`,
    ),
    '',
    `A finished check starts three of them (the alert planner, the notify mail, the capture): ${finishedFanOut()} executions.`,
    `One alert that fires on both channels: ${alertFiring()}. One mail: ${oneMail()}.`,
    '',
    '## One check, by shape',
    '',
    "The shapes come from production's v1 audits completed in the 30 days to 2026-11-13 (72 audits; median",
    '27 pages in 14 s, 90th percentile 195 pages in 247 s), read with:',
    '',
    '```sql',
    'select count(*), percentile_disc(0.5) within group (order by page_count),',
    '  percentile_disc(0.9) within group (order by page_count),',
    '  percentile_disc(0.5) within group (order by extract(epoch from (completed_at - started_at))),',
    '  percentile_disc(0.9) within group (order by extract(epoch from (completed_at - started_at)))',
    "from audits where status = 'completed' and started_at > now() - interval '30 days';",
    '```',
    '',
    "A v1 audit's time is not a v2 batch's time; the worker's own batch times are not yet measured on",
    'production, so the shapes stand in for them until they are.',
    '',
    '| Shape | Why | checkFn run | First check | Scheduled re-check |',
    '| --- | --- | --- | --- | --- |',
  ];
  const shapes = await allShapes();
  for (const shape of shapes) {
    const [first, recheck] = await scenarios(shape);
    lines.push(
      `| ${shape.label} | ${shape.why} | ${await checkExecutions(shape)} | ${first!.executions} | ${recheck!.executions} |`,
    );
  }
  lines.push(
    '',
    'A run that passes its finish timeout is counted to the sleep that passes it, and Inngest cancels',
    'it there; the table still adds the fan-out of a finished check to it, where the real run would',
    'start `crawlmouse.check.cancelled` and the failed-check mail instead.',
    '',
    '## A month, against the quota',
    '',
    `| Checks a month | ${shapes.map((s) => s.label).join(' | ')} |`,
    `| --- | ${shapes.map(() => '---').join(' | ')} |`,
  );
  for (const checks of CHECK_COUNTS) {
    const totals = await Promise.all(shapes.map((s) => monthlyTotal(checks, s)));
    lines.push(`| ${n(checks)} | ${totals.map(n).join(' | ')} |`);
  }
  lines.push(
    '',
    'Every figure is a clean run: a step that fails and is retried is one more execution, and an',
    "`onFailure` handler's run and steps are more again. The totals are a floor under real traffic.",
    '',
    "v1's audits are left out of the table: each is one run and five steps (`crawlmouse.audit`), and",
    'the brief measured 85 audits in production in the 30 days to 2026-11-13 (F2).',
    '',
    '## The rule (CC-35 D2)',
    '',
    `The floor plus 1,000 typical checks is **${n(verdict.total)}** against the line of ${n(HOBBY_HEADROOM_LINE)}.`,
    verdict.passes
      ? 'It is under the line: the Hobby plan passes `golive:check`.'
      : '**It is over the line: `golive:check` reports the Hobby plan as a failing precondition of `V2_PIPELINE`, and the owner decides the plan (Pro starts at $99 a month for 1M executions) before step 2.**',
    '',
    `The largest part of the floor is \`crawlmouse.check.reaper\` every ten minutes (${n(
      cronPerDay(FUNCTIONS.find((f) => f.id === 'crawlmouse.check.reaper')!) * DAYS_PER_MONTH,
    )} a month).`,
    '',
    '## Not confirmed on a running app',
    '',
    "No figure here was read from an Inngest run's step list: CC-35 holds no Inngest credential, for",
    'staging or production. The count is confirmed against the code (the simulation runs the real',
    "orchestration) and not yet against Inngest's own run history. The first",
    "check after step 2 is the place to confirm it: Inngest → Runs → the check's run → its step list.",
    '',
  );
  // Formatted as CI's Prettier check would leave it, so the check and the byte comparison agree.
  return format(lines.join('\n'), { ...(await resolveConfig(DOC_PATH)), filepath: DOC_PATH });
}

if (process.argv.includes('--write')) {
  writeFileSync(DOC_PATH, await renderBudget());
  console.log(`wrote ${DOC_PATH}`);
}
