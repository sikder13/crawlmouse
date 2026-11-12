/**
 * The weekly summary (CC-28 D6), as two functions:
 *
 * - `crawlmouse.summary.tick`, hourly: reads the accounts whose summary is due this hour a page at a
 *   time (each page its own step, read at the time the first step fixed, so a retried page is the
 *   same page) and sends one `summary.requested` per account, with an event id of the account and
 *   week, so a repeated tick asks once.
 * - `crawlmouse.summary.send`, on `summary.requested`: one account's summary in one step, so a
 *   failure of one account stops no other.
 *
 * The work is injected (apps/web/lib/v2/monitor/summary.ts).
 */
import { inngest } from './client';
import { sized } from './check';
import { planSafeLimit } from './concurrency';

export const SUMMARY_TICK_FN_ID = 'crawlmouse.summary.tick';
export const SUMMARY_SEND_FN_ID = 'crawlmouse.summary.send';
/** Accounts per page of the due list: each page's step answer stays under the step output bound. */
export const SUMMARY_PAGE = 20;
/** The ledger's three attempts, and one for a claim left busy by a dead worker. */
export const SUMMARY_RETRIES = 4;

type Env = Readonly<Record<string, string | undefined>>;

export interface SummaryRequested {
  accountId: string;
  weekKey: string;
  weekStart: string;
}

export interface SummaryTickWork {
  due(nowIso: string, offset: number, limit: number): Promise<SummaryRequested[]>;
}

export interface SummarySendWork {
  send(due: SummaryRequested): Promise<Record<string, unknown>>;
}

export function createSummaryTickFn(work: SummaryTickWork) {
  return inngest.createFunction(
    { id: SUMMARY_TICK_FN_ID, concurrency: { limit: 1 } },
    // Hourly, off the hour: an account's Monday 08:00 hour is due whenever in it the tick runs.
    { cron: '11 * * * *' },
    async ({ step }) => {
      const now = await step.run('clock', async () => new Date().toISOString());
      let requested = 0;
      for (let page = 0; ; page++) {
        const due = await step.run(`due-${page}`, async () =>
          sized(`due-${page}`, await work.due(now, page * SUMMARY_PAGE, SUMMARY_PAGE)),
        );
        if (due.length > 0) {
          await step.sendEvent(
            `request-${page}`,
            due.map((d) => ({
              name: 'summary.requested' as const,
              id: `summary:${d.accountId}:${d.weekKey}`,
              data: d,
            })),
          );
          requested += due.length;
        }
        if (due.length < SUMMARY_PAGE) break;
      }
      return { requested };
    },
  );
}

export function createSummarySendFn(work: SummarySendWork, env: Env = process.env) {
  return inngest.createFunction(
    {
      id: SUMMARY_SEND_FN_ID,
      retries: SUMMARY_RETRIES,
      concurrency: { limit: planSafeLimit(env.INNGEST_SUMMARY_CONCURRENCY, 1) },
    },
    { event: 'summary.requested' },
    async ({ event, step }) =>
      step.run('send', async () => sized('send', await work.send(event.data as SummaryRequested))),
  );
}
