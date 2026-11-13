/**
 * `crawlmouse.report.schedules` as production builds it (CC-31 D8): the hourly run over the
 * service-role client, the mails asked for as Inngest events, and the event capture with no request
 * (a scheduled run has no visitor's cookie). The client is made when a run starts, not when the
 * serve route loads.
 */
import { createClient } from '@supabase/supabase-js';
import type { InngestFunction } from 'inngest';
import { createReportSchedulesFn } from '../../../../../inngest/report-schedules';
import { agencyCaptureWithoutRequest } from './events';
import { runDueSchedules } from './schedules-run';
import { inngestClientReportMail, supabaseScheduleRunStore } from './schedules-store';

type Env = Readonly<Record<string, string | undefined>>;

export function reportScheduleFunctions(env: Env = process.env): InngestFunction.Like[] {
  return [
    createReportSchedulesFn(() =>
      runDueSchedules({
        store: supabaseScheduleRunStore(
          createClient(env.NEXT_PUBLIC_SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
            auth: { persistSession: false },
          }),
        ),
        mail: inngestClientReportMail(),
        capture: agencyCaptureWithoutRequest(),
        now: () => new Date(),
      }),
    ),
  ];
}
