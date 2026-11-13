import { describe, expect, it } from 'vitest';
import { inngest } from './client';
import {
  createReportSchedulesFn,
  REPORT_SCHEDULES_FN_ID,
  type ScheduleRunCounts,
} from './report-schedules';

const COUNTS: ScheduleRunCounts = {
  due: 3,
  sent: 1,
  queued: 1,
  confirmations: 1,
  skipped: { unconfirmed: 1 },
};

describe('createReportSchedulesFn (CC-31 D8)', () => {
  it('runs every hour, one run at a time', () => {
    const [config] = (
      createReportSchedulesFn(async () => COUNTS) as unknown as {
        getConfig(o: { baseUrl: URL; appPrefix: string }): Record<string, unknown>[];
      }
    ).getConfig({ baseUrl: new URL('https://example.com/api/inngest'), appPrefix: inngest.id });
    expect(config).toMatchObject({
      id: `${inngest.id}-${REPORT_SCHEDULES_FN_ID}`,
      triggers: [{ cron: '7 * * * *' }],
      concurrency: { limit: 1 },
    });
    expect(REPORT_SCHEDULES_FN_ID).toBe('crawlmouse.report.schedules');
  });

  it('runs the due schedules in one step, whose output is the counts', async () => {
    let runs = 0;
    const fn = createReportSchedulesFn(async () => {
      runs += 1;
      return COUNTS;
    }) as unknown as { fn: (ctx: unknown) => Promise<unknown> };
    const ids: string[] = [];
    const out = await fn.fn({
      step: {
        run: async (id: string, body: () => Promise<unknown>) => {
          ids.push(id);
          return body();
        },
      },
    });
    expect(ids).toEqual(['run-due']);
    expect(runs).toBe(1);
    expect(out).toEqual(COUNTS);
  });
});
