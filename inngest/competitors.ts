/**
 * `crawlmouse.competitors.compare` (row 18): audits a site's competitors and copies what they
 * measured into the site's check.
 *
 * It runs on `check.finished`, for the check that finished, and on `competitors.requested`
 * (`{ siteId }`), for the site's latest ended check. Nothing in this package sends that event: it is
 * for the site edit route to send after a member changes the competitor list, which that route's
 * owner adds; until then a changed list is first audited at the site's next check. A concurrency key
 * on the site keeps two runs' steps for one site from executing at once; it does not stop the runs
 * overlapping, since a sleeping run holds no slot. Why an overlap does no harm is in
 * apps/web/lib/v2/competitors/compare.ts. Steps: `latest` (the second event only), `plan` (whether the check audits competitors, and
 * which hosts), `start-<n>` per host (reuse a recent check of the host, or request one), then
 * `wait-<n>` and `ended-<n>` until every started check has ended or the polls in
 * `COMPETITOR_POLLS_S` run out, then `write`. A competitor's own check finishing starts this function
 * too, and its plan answers `unkept`: no competitor of a competitor is audited.
 *
 * It polls the checks' status instead of waiting for their `check.finished`, because an event sent
 * before a wait is registered is not delivered to it, and a reused or quick check can end that early.
 *
 * The work is injected (apps/web/lib/v2/competitors/compare.ts): this package does not import the app.
 */
import { inngest } from './client';
import { sized } from './check';
import type { CheckFinished } from './check-events';
import { planSafeLimit } from './concurrency';

export const COMPETITOR_FN_ID = 'crawlmouse.competitors.compare';

/** The event for a member's change of the competitor list; the site edit route is to send it. */
export type CompetitorsRequested = { siteId: string };

/**
 * Seconds slept before each look at the competitors' checks: 2, 4 and 8 minutes, then every 15, for
 * 2 h 59 min in all, after which what ended is written and the rest is left out.
 */
export const COMPETITOR_POLLS_S: readonly number[] = [
  120,
  240,
  480,
  ...Array<number>(11).fill(900),
];

type Env = Readonly<Record<string, string | undefined>>;

export interface CompetitorWork {
  latest(siteId: string): Promise<string | null>;
  plan(
    checkId: string,
  ): Promise<{ skip: string } | { hosts: string[]; accountId: string; cap: number }>;
  start(
    host: string,
    accountId: string,
    cap: number,
  ): Promise<{ skip: string } | { checkId: string; reused: boolean }>;
  ended(checkIds: string[]): Promise<string[]>;
  write(
    checkId: string,
    entries: { host: string; checkId: string | null }[],
  ): Promise<{ written: number }>;
}

export function createCompetitorFn(work: CompetitorWork, env: Env = process.env) {
  return inngest.createFunction(
    {
      id: COMPETITOR_FN_ID,
      retries: 3,
      concurrency: [
        { limit: planSafeLimit(env.INNGEST_COMPETITOR_CONCURRENCY, 2) },
        { key: 'event.data.siteId', limit: 1 },
      ],
    },
    [{ event: 'check.finished' }, { event: 'competitors.requested' }],
    async ({ event, step }) => {
      let checkId: string;
      if (event.name === 'competitors.requested') {
        const { siteId } = event.data as CompetitorsRequested;
        const latest = await step.run('latest', async () =>
          sized('latest', await work.latest(siteId)),
        );
        if (latest === null) return { skip: 'no_check' };
        checkId = latest;
      } else {
        checkId = (event.data as CheckFinished).checkId;
      }

      const plan = await step.run('plan', async () => sized('plan', await work.plan(checkId)));
      if ('skip' in plan) return plan;

      const entries: { host: string; checkId: string | null }[] = [];
      let waiting: string[] = [];
      for (const [i, host] of plan.hosts.entries()) {
        const started = await step.run(`start-${i}`, async () =>
          sized(`start-${i}`, await work.start(host, plan.accountId, plan.cap)),
        );
        if ('skip' in started) {
          entries.push({ host, checkId: null });
          continue;
        }
        entries.push({ host, checkId: started.checkId });
        if (!started.reused) waiting.push(started.checkId);
      }

      for (let n = 1; waiting.length > 0 && n <= COMPETITOR_POLLS_S.length; n++) {
        await step.sleep(`wait-${n}`, COMPETITOR_POLLS_S[n - 1]! * 1000);
        const asked = waiting;
        const done = await step.run(`ended-${n}`, async () =>
          sized(`ended-${n}`, await work.ended(asked)),
        );
        waiting = waiting.filter((id) => !done.includes(id));
      }

      return step.run('write', async () => sized('write', await work.write(checkId, entries)));
    },
  );
}
