/**
 * The daily sentinel (row 23): two functions.
 *
 * `crawlmouse.sentinel.tick`, at 23 minutes past each hour: `due` asks for the paid sites whose
 * sentinel hour (UTC) this is, and `watch` sends one `sentinel.watch` event per site, with the event
 * id `sentinel-watch:{site}:{day}`, so a site is watched once a day however often the tick is retried.
 *
 * `crawlmouse.sentinel.watch`, per site: `plan` picks the pages of the site's latest full check,
 * `look-1` posts them to the worker as an access batch, and `wait-1-{p}` / `result-1-{p}` poll it
 * (`LOOK_POLLS_S`). When something moved, it sleeps `again` (`LOOK_AGAIN_MS`) and looks once more
 * (`look-2`, ...). Moved twice: `request` starts a full check, whose diff and the existing alert rules
 * send the alert. Moved once: noise, and nothing starts. A look that fails or is still running at its
 * last poll is read as no evidence, and nothing starts.
 *
 * The work is injected (apps/web/lib/v2/monitor/sentinel-work.ts): this package does not import the app.
 */
import { inngest } from './client';
import { sized } from './check';
import { planSafeLimit } from './concurrency';

export const SENTINEL_TICK_FN_ID = 'crawlmouse.sentinel.tick';
export const SENTINEL_WATCH_FN_ID = 'crawlmouse.sentinel.watch';

/** Seconds slept before each read of a look: 3 min 10 s in all, past the look's 120 s budget. */
export const LOOK_POLLS_S: readonly number[] = [20, 20, 30, 30, 30, 30, 30];
/** How long after a move the second look is taken. */
export const LOOK_AGAIN_MS = 5 * 60 * 1000;

export type SentinelWatch = { siteId: string; day: string };

type Env = Readonly<Record<string, string | undefined>>;
type Page = { template_key: string; url: string };

export interface SentinelSteps {
  due(hour: number): Promise<{ skip: string } | { siteIds: string[] }>;
  plan(
    siteId: string,
  ): Promise<{ skip: string } | { host: string; baseline: string; pages: Page[] }>;
  look(
    siteId: string,
    host: string,
    pages: Page[],
    n: number,
  ): Promise<{ skip: string } | { batchId: string }>;
  result(
    siteId: string,
    batchId: string,
  ): Promise<{ status: 'running' | 'failed' } | { status: 'done'; moved: number }>;
  request(siteId: string): Promise<{ skip: string } | { checkId: string }>;
}

export function createSentinelTickFn(
  work: SentinelSteps,
  env: Env = process.env,
  now: () => number = Date.now,
) {
  void env;
  return inngest.createFunction(
    { id: SENTINEL_TICK_FN_ID, retries: 3, concurrency: { limit: 1 } },
    { cron: '23 * * * *' },
    async ({ step }) => {
      const due = await step.run('due', async () => {
        const at = new Date(now());
        const answer = await work.due(at.getUTCHours());
        return sized('due', { ...answer, day: at.toISOString().slice(0, 10) });
      });
      if ('skip' in due) return { skip: due.skip };
      if (due.siteIds.length === 0) return { watched: 0 };
      await step.sendEvent(
        'watch',
        due.siteIds.map((siteId) => ({
          id: `sentinel-watch:${siteId}:${due.day}`,
          name: 'sentinel.watch' as const,
          data: { siteId, day: due.day },
        })),
      );
      return { watched: due.siteIds.length };
    },
  );
}

export function createSentinelWatchFn(work: SentinelSteps, env: Env = process.env) {
  return inngest.createFunction(
    {
      id: SENTINEL_WATCH_FN_ID,
      retries: 3,
      concurrency: { limit: planSafeLimit(env.INNGEST_SENTINEL_CONCURRENCY, 4) },
    },
    { event: 'sentinel.watch' },
    async ({ event, step }) => {
      const { siteId } = event.data as SentinelWatch;
      const plan = await step.run('plan', async () => sized('plan', await work.plan(siteId)));
      if ('skip' in plan) return plan;

      /** How many crawler answers moved in look `n`; null when the look gave no evidence. */
      const lookAt = async (n: number): Promise<number | null> => {
        const posted = await step.run(`look-${n}`, async () =>
          sized(`look-${n}`, await work.look(siteId, plan.host, plan.pages, n)),
        );
        if ('skip' in posted) return null;
        for (let p = 1; p <= LOOK_POLLS_S.length; p++) {
          await step.sleep(`wait-${n}-${p}`, LOOK_POLLS_S[p - 1]! * 1000);
          const read = await step.run(`result-${n}-${p}`, async () =>
            sized(`result-${n}-${p}`, await work.result(siteId, posted.batchId)),
          );
          if (read.status === 'done') return read.moved;
          if (read.status === 'failed') return null;
        }
        return null;
      };

      const first = await lookAt(1);
      if (first === null) return { skip: 'look_unread' };
      if (first === 0) return { moved: 0 };
      await step.sleep('again', LOOK_AGAIN_MS);
      const second = await lookAt(2);
      if (second === null) return { skip: 'look_unread' };
      if (second === 0) return { moved: 0, seenOnce: first };
      const started = await step.run('request', async () =>
        sized('request', await work.request(siteId)),
      );
      return 'skip' in started
        ? { moved: second, ...started }
        : { moved: second, checkId: started.checkId };
    },
  );
}
