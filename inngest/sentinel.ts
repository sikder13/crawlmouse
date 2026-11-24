/**
 * The daily sentinel (row 23): two functions.
 *
 * `crawlmouse.sentinel.tick`, at 23 minutes past each hour: its one step, `due`, sends one
 * `sentinel.watch` event per paid site whose sentinel hour (UTC) this is, with the event id
 * `sentinel-watch:{site}:{day}`, so a retried tick sends no site twice in a day.
 *
 * `crawlmouse.sentinel.watch`, per site: `spread` waits the site's place in the hour (`spreadMs`), so
 * the hour's looks do not reach the worker at once; `look-1` posts the pages of the site's latest
 * full check to the worker as an access batch, and `wait-1-{p}` / `result-1-{p}` poll it
 * (`LOOK_POLLS_S`). When something moved, it sleeps `again` (`LOOK_AGAIN_MS`) and looks once more
 * (`look-2`, ...). Moved twice: `request` starts a full check, whose diff and the existing alert rules
 * send the alert. Moved once: noise, and nothing starts. A look that fails or is still running at its
 * last poll is read as no evidence, and nothing starts.
 *
 * The work is injected (apps/web/lib/v2/monitor/sentinel-work.ts): this package does not import the app.
 */
import { createHash } from 'node:crypto';
import { inngest } from './client';
import { sized } from './check';
import { planSafeLimit } from './concurrency';

export const SENTINEL_TICK_FN_ID = 'crawlmouse.sentinel.tick';
export const SENTINEL_WATCH_FN_ID = 'crawlmouse.sentinel.watch';

/** Seconds slept before each read of a look: 3 min 10 s in all, past the look's 120 s budget. */
export const LOOK_POLLS_S: readonly number[] = [20, 20, 30, 30, 30, 30, 30];
/** How long after a move the second look is taken. */
export const LOOK_AGAIN_MS = 5 * 60 * 1000;
/** Watches due in one hour start spread over its first 50 minutes, a site's place set by its id. */
export const SPREAD_MS = 50 * 60 * 1000;

/** How long a site's watch waits before its first look: from its id, the same every day. */
export const spreadMs = (siteId: string): number =>
  createHash('sha256').update(`sentinel-spread:${siteId}`).digest().readUInt32BE(0) % SPREAD_MS;

export type SentinelWatch = { siteId: string; day: string };

type Env = Readonly<Record<string, string | undefined>>;

export interface SentinelSteps {
  dispatch(hour: number, day: string): Promise<{ skip: string } | { watched: number }>;
  look(
    siteId: string,
    day: string,
    n: number,
  ): Promise<{ skip: string } | { batchId: string; baseline: string }>;
  result(
    baseline: string,
    batchId: string,
  ): Promise<{ status: 'running' | 'failed' } | { status: 'done'; moved: number }>;
  request(siteId: string, day: string): Promise<{ skip: string } | { checkId: string }>;
}

export function createSentinelTickFn(work: SentinelSteps, now: () => number = Date.now) {
  return inngest.createFunction(
    { id: SENTINEL_TICK_FN_ID, retries: 3, concurrency: { limit: 1 } },
    { cron: '23 * * * *' },
    async ({ step }) =>
      step.run('due', async () => {
        const at = new Date(now());
        return sized('due', await work.dispatch(at.getUTCHours(), at.toISOString().slice(0, 10)));
      }),
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
      const { siteId, day } = event.data as SentinelWatch;
      await step.sleep('spread', spreadMs(siteId));

      /** How many crawler answers moved in look `n`; null when the look gave no evidence. */
      const lookAt = async (n: number): Promise<number | null> => {
        const posted = await step.run(`look-${n}`, async () =>
          sized(`look-${n}`, await work.look(siteId, day, n)),
        );
        if ('skip' in posted) return null;
        for (let p = 1; p <= LOOK_POLLS_S.length; p++) {
          await step.sleep(`wait-${n}-${p}`, LOOK_POLLS_S[p - 1]! * 1000);
          const read = await step.run(`result-${n}-${p}`, async () =>
            sized(`result-${n}-${p}`, await work.result(posted.baseline, posted.batchId)),
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
        sized('request', await work.request(siteId, day)),
      );
      return 'skip' in started
        ? { moved: second, ...started }
        : { moved: second, checkId: started.checkId };
    },
  );
}
