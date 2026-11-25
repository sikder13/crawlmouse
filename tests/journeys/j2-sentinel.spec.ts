import { createHash } from 'node:crypto';
import { expect } from './pw';
import { stagingAdmin } from './lib/accounts';
import { freshContext, keptSite, person, type Person } from './lib/people';
import { startTrialFromDashboard } from './lib/pro';
import { step } from './lib/step';

// J2.4i (row 23): the daily sentinel. sentinel.lab.crawlmouse.com disallows GPTBot during odd UTC
// hours and allows it during even ones (fixtures/qa-lab/api/sentinel.mjs). A Pro site whose baseline
// full check recorded GPTBot allowed, and whose watch looks early in an odd hour, sees GPTBot newly
// blocked on both looks, so the watch starts one full check that day, and the crawler_blocked rule
// (on by default) fires on it.
//
// When a site is watched comes from its id: the tick at sentinelHour:23 UTC dispatches it, and its
// watch first looks spreadMs after that. The step makes new Pro people until one site's first look
// falls in LOOK_WINDOW_MIN of an odd hour, so the two looks and the full check they start all read
// robots.txt in that hour, then waits for it: up to a day, bounded by JOURNEY_SENTINEL_MAX_HOURS
// (default 24). Every site it keeps is removed when the step ends, however it ends.
//
// The three functions below are copies, kept equal by hand, of the product's own: sentinelHour
// (apps/web/lib/v2/monitor/sentinel.ts), spreadMs (inngest/sentinel.ts) and stableId
// (packages/engine/src/v2/diff/ids.ts). The journey runs outside the app's module graph, so it cannot
// import them.

const HOST = 'sentinel.lab.crawlmouse.com';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** The tick runs at 23 past the hour (inngest/sentinel.ts). */
const TICK_MIN = 23;
/**
 * Minutes of the hour the first look may fall in. From 1, past the turn of the hour; to 30, so the
 * second look (5 to 9 minutes later) and the full check it starts read robots.txt before the turn.
 */
const LOOK_WINDOW_MIN = [1, 30] as const;
/** The worker keeps a site's robots.txt this long (packages/worker/src/batch/site-rules.ts). */
const ROBOTS_TTL_MS = 10 * MINUTE;
/** Two looks with their polls, then the full check and its alert. */
const SETTLE_MS = 45 * MINUTE;
const TRIES = 12;

const hashU32 = (s: string) => createHash('sha256').update(s).digest().readUInt32BE(0);
const sentinelHour = (siteId: string) => hashU32(`sentinel:${siteId}`) % 24;
const spreadMs = (siteId: string) => hashU32(`sentinel-spread:${siteId}`) % (50 * MINUTE);

function stableId(...parts: string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(`${part.length}:${part};`);
  const b = hash.digest();
  b[6] = (b[6]! & 0x0f) | 0x80;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = (from: number, to: number) => b.subarray(from, to).toString('hex');
  return `${hex(0, 4)}-${hex(4, 6)}-${hex(6, 8)}-${hex(8, 10)}-${hex(10, 16)}`;
}
/** The full check the sentinel starts for `siteId` on `day` (pipeline/request.ts, `sentinelDay`). */
const sentinelCheckId = (siteId: string, day: string) =>
  stableId('check_request', `check:${siteId}:sentinel:${day}`);

/** The site's next tick at or after `from`, and its first look after that tick. */
function nextWatch(siteId: string, from: number): { tick: number; look: number; day: string } {
  const d = new Date(from);
  let tick = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    sentinelHour(siteId),
    TICK_MIN,
  );
  if (tick < from) tick += 24 * HOUR;
  return {
    tick,
    look: tick + spreadMs(siteId),
    day: new Date(tick).toISOString().slice(0, 10),
  };
}

/** Whether a site's first look falls early in an odd UTC hour, so its whole watch reads GPTBot blocked. */
function looksInOddWindow(siteId: string): boolean {
  const m = TICK_MIN + spreadMs(siteId) / MINUTE;
  const hour = (sentinelHour(siteId) + Math.floor(m / 60)) % 24;
  const minute = m % 60;
  return hour % 2 === 1 && minute >= LOOK_WINDOW_MIN[0] && minute <= LOOK_WINDOW_MIN[1];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** QA's helper starts the trial with staging's trial ledger set aside, then the state is read. */
async function startPro(who: Person) {
  await startTrialFromDashboard(who);
  const { data } = await stagingAdmin()
    .from('accounts')
    .select('state')
    .eq('id', who.accountId)
    .single();
  expect(data?.state, 'the no-card Pro trial started').toBe('pro_trial');
}

async function removeSite(who: Person, siteId: string) {
  const status = await who.page.evaluate(
    async (id) =>
      (
        await fetch(`/api/sites/${id}`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirm: 'remove' }),
        })
      ).status,
    siteId,
  );
  expect(status, `the step's site ${siteId} is removed`).toBe(200);
}

/** The site's latest ended check, once one has ended at or after `since`. */
async function endedSince(siteId: string, since: number, waitMs: number) {
  const admin = stagingAdmin();
  const end = Date.now() + waitMs;
  for (;;) {
    const { data } = await admin
      .from('checks')
      .select('id, finished_at')
      .eq('site_id', siteId)
      .in('status', ['finished', 'partial'])
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data && Date.parse(data.finished_at as string) >= since) return data.id as string;
    if (Date.now() > end)
      throw new Error(`no check of ${siteId} ended within ${waitMs / MINUTE} min`);
    await sleep(30_000);
  }
}

/** What a check recorded for GPTBot: the verdicts of its GPTBot access tests. */
async function gptbotVerdicts(checkId: string): Promise<string[]> {
  const { data } = await stagingAdmin()
    .from('access_tests')
    .select('verdict')
    .eq('check_id', checkId)
    .eq('ua', 'GPTBot');
  return (data ?? []).map((t) => t.verdict as string);
}
const allowed = (v: string[]) =>
  v.length > 0 && v.every((x) => x === 'allowed' || x === 'allowed_thin');

step('J2.4i', 'Daily watch: a crawler newly blocked', async ({ context, baseURL }, info) => {
  const maxHours = Number(process.env.JOURNEY_SENTINEL_MAX_HOURS ?? '24');
  // Past the wait for the watch, at most: choosing and its baseline (0.5 h), a re-check in the next
  // even hour (2.9 h), the settle and the full check (1.3 h) and the Free arm (3.3 h).
  info.setTimeout((maxHours + 9) * HOUR);
  const admin = stagingAdmin();
  const skipUnless = (ok: boolean, why: string) => info.skip(!ok, why);
  /** Every site the step keeps, removed however the step ends, so none stays watched. */
  const kept: { who: Person; site: string }[] = [];
  try {
    // A Pro site whose watch looks early in an odd hour: about one new site in five, by its id.
    let pro: { who: Person; site: string } | null = null;
    for (let n = 1; n <= TRIES && pro === null; n++) {
      const ctx = n === 1 ? context : await freshContext(context, baseURL!);
      const who = await person(ctx, baseURL!, 'j2', 40 + n);
      await startPro(who);
      const site = await keptSite(who, HOST);
      kept.push({ who, site });
      if (looksInOddWindow(site)) pro = { who, site };
    }
    skipUnless(pro !== null, `no new site's watch fell early in an odd hour in ${TRIES} tries`);
    const { who, site } = pro!;

    // The baseline: the latest full check must have recorded GPTBot allowed. The worker keeps
    // robots.txt for ROBOTS_TTL_MS, so a re-check waits that long into an even hour.
    let base = await endedSince(site, 0, 30 * MINUTE);
    if (!allowed(await gptbotVerdicts(base))) {
      const nextEven = (Math.floor(Date.now() / (2 * HOUR)) + 1) * 2 * HOUR;
      const askAt = nextEven + ROBOTS_TTL_MS + MINUTE;
      await sleep(Math.max(0, askAt - Date.now()));
      const asked = await who.page.evaluate(
        async (id) => (await fetch(`/api/sites/${id}/checks`, { method: 'POST' })).status,
        site,
      );
      expect(asked < 300, `a re-check in an even hour is asked for (${asked})`).toBe(true);
      base = await endedSince(site, askAt, 40 * MINUTE);
    }
    expect(allowed(await gptbotVerdicts(base)), 'the baseline recorded GPTBot allowed').toBe(true);

    const watch = nextWatch(site, Date.now());
    // When the watch will look, for whoever plans the run: the step waits for it.
    info.annotations.push({
      type: 'sentinel-watch',
      description: `site ${site}: tick ${new Date(watch.tick).toISOString()}, first look ${new Date(watch.look).toISOString()}`,
    });
    skipUnless(
      watch.look - Date.now() <= maxHours * HOUR,
      `the site's watch is ${((watch.look - Date.now()) / HOUR).toFixed(1)} h away, past JOURNEY_SENTINEL_MAX_HOURS`,
    );
    await sleep(watch.look - Date.now() + SETTLE_MS);

    const checkId = sentinelCheckId(site, watch.day);
    const { data: started } = await admin
      .from('checks')
      .select('id, trigger')
      .eq('id', checkId)
      .maybeSingle();
    expect(started, 'the watch started one full check that day').not.toBeNull();
    expect(started!.trigger).toBe('scheduled');
    await endedSince(site, watch.look, 30 * MINUTE);
    expect(
      await gptbotVerdicts(checkId),
      'the full check records GPTBot disallowed by robots.txt',
    ).toContain('disallowed_by_robots');
    const { data: alerts } = await admin
      .from('alert_events')
      .select('id, alert_rules!inner(kind)')
      .eq('check_id', checkId)
      .eq('alert_rules.kind', 'crawler_blocked');
    expect((alerts ?? []).length, 'one crawler_blocked alert fired on it').toBe(1);

    // A Free site is not watched: asserted only when the Free site's own watch could see a move, which
    // holds on few runs (a look leaves nothing behind, so only a started full check shows a watch);
    // otherwise recorded as not proven. The Free filter itself is unit-tested with the sentinel.
    const free = await person(await freshContext(context, baseURL!), baseURL!, 'j2', 60);
    const freeSite = await keptSite(free, HOST);
    kept.push({ who: free, site: freeSite });
    const freeBase = await endedSince(freeSite, 0, 30 * MINUTE);
    const freeWatch = nextWatch(freeSite, Date.now());
    const provable =
      looksInOddWindow(freeSite) &&
      allowed(await gptbotVerdicts(freeBase)) &&
      freeWatch.look - Date.now() <= 2 * HOUR;
    if (provable) {
      await sleep(freeWatch.look - Date.now() + SETTLE_MS);
      const { data: none } = await admin
        .from('checks')
        .select('id')
        .eq('id', sentinelCheckId(freeSite, freeWatch.day))
        .maybeSingle();
      expect(none, 'the Free site was not watched').toBeNull();
    } else {
      info.annotations.push({
        type: 'note',
        description:
          "the Free arm is not proven on this run: its site's watch could not see a move",
      });
    }
  } finally {
    for (const k of kept) await removeSite(k.who, k.site);
  }
});
