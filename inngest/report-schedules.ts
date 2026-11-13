/**
 * `crawlmouse.report.schedules` (CC-31 D8): every hour, runs the client report schedules that are
 * due. `run` does the work (apps/web/lib/v2/agency/schedules-run.ts: `runDueSchedules`) and
 * returns counts, which is the step's whole output: no site, report or address is in it.
 *
 * A run that is retried sends nothing twice: a schedule's report row is one a site and slot
 * (`write_client_report`), and a schedule the run finished with is no longer due
 * (`mark_report_schedule_run`).
 */
import { inngest } from './client';

export const REPORT_SCHEDULES_FN_ID = 'crawlmouse.report.schedules';

/** What one run did, as counts. `skipped` is by reason. */
export interface ScheduleRunCounts {
  due: number;
  /** Reports whose mail went in this run. */
  sent: number;
  /** Reports handed on to be mailed. */
  queued: number;
  /** Confirmation mails asked for. */
  confirmations: number;
  skipped: Record<string, number>;
}

export function createReportSchedulesFn(run: () => Promise<ScheduleRunCounts>) {
  return inngest.createFunction(
    { id: REPORT_SCHEDULES_FN_ID, concurrency: { limit: 1 } },
    { cron: '7 * * * *' },
    async ({ step }) => step.run('run-due', run),
  );
}
