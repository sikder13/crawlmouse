import { createHash } from 'node:crypto';
import { expect } from './pw';
import { stagingAdmin } from './lib/accounts';
import { freshContext, keptSite, person, type Person } from './lib/people';
import { step } from './lib/step';

// J2.4i (row 23): the daily sentinel. sentinel.lab.crawlmouse.com disallows GPTBot during odd UTC
// hours and allows it during even ones (fixtures/qa-lab/api/sentinel.mjs). A Pro site whose last full
// check ran in an even hour and whose daily watch falls in an odd one sees GPTBot newly blocked on both
// looks, so the watch starts one full check that day, and the crawler_blocked rule (on by default)
// fires on it. A Free site on the same host gets no watch.
//
// The watch's time comes from the site's id, so the step waits for it: up to a day, bounded by
// JOURNEY_SENTINEL_MAX_HOURS (default 24). The three functions below are copies, kept equal by hand, of
// the product's own: sentinelHour (apps/web/lib/v2/monitor/sentinel.ts), spreadMs
// (inngest/sentinel.ts) and stableId (packages/engine/src/v2/diff/ids.ts). The journey runs outside
// the app's module graph, so it cannot import them.

const HOST = 'sentinel.lab.crawlmouse.com';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** The tick runs at 23 past the hour, and a watch waits up to 50 minutes after it. */
const TICK_MS = 23 * MINUTE;
/** Two looks five minutes apart with their polls, then the full check and its alert. */
const SETTLE_MS = 40 * MINUTE;

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

/** When the site's watch next looks, at or after `from`: its hour, past the tick, plus its spread. */
function nextLook(siteId: string, from: number): number {
  const d = new Date(from);
  let at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), sentinelHour(siteId));
  at += TICK_MS + spreadMs(siteId);
  return at < from ? at + 24 * HOUR : at;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isOdd = (ms: number) => new Date(ms).getUTCHours() % 2 === 1;

async function startPro(who: Person) {
  const status = await who.page.evaluate(async (accountId) => {
    const r = await fetch('/api/billing/pro-trial/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId }),
    });
    return r.status;
  }, who.accountId);
  expect(status, 'the no-card Pro trial starts').toBe(200);
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
    if (data && Date.parse(data.finished_at as string) >= since) {
      return { id: data.id as string, finishedAt: Date.parse(data.finished_at as string) };
    }
    if (Date.now() > end)
      throw new Error(`no check of ${siteId} ended within ${waitMs / MINUTE} min`);
    await sleep(30_000);
  }
}

step('J2.4i', 'Daily watch: a crawler newly blocked', async ({ context, baseURL }, info) => {
  const maxHours = Number(process.env.JOURNEY_SENTINEL_MAX_HOURS ?? '24');
  info.setTimeout((maxHours + 3) * HOUR);
  const admin = stagingAdmin();

  // A Pro site whose watch falls in an odd hour; a site's hour comes from its id, so a new person
  // is made until one does (half of them, on average). Each keeps the host once.
  let pro: { who: Person; site: string } | null = null;
  for (let n = 1; n <= 4 && pro === null; n++) {
    const ctx = n === 1 ? context : await freshContext(context, baseURL!);
    const who = await person(ctx, baseURL!, 'j2', 40 + n);
    await startPro(who);
    const site = await keptSite(who, HOST);
    if (sentinelHour(site) % 2 === 1) pro = { who, site };
  }
  skipUnless(pro !== null, 'no new site fell on an odd watch hour in four tries');
  const { site } = pro!;

  // A Free site on the same host, which the sentinel must never watch.
  const free = await person(await freshContext(context, baseURL!), baseURL!, 'j2', 50);
  const freeSite = await keptSite(free, HOST);

  // The baseline: the Pro site's latest full check, ended in an even hour, when GPTBot is allowed.
  let base = await endedSince(site, 0, 30 * MINUTE);
  if (isOdd(base.finishedAt)) {
    const nextEven = (Math.floor(Date.now() / HOUR) + 1) * HOUR;
    await sleep(Math.max(0, nextEven - Date.now()) + MINUTE);
    const asked = await pro!.who.page.evaluate(
      async (id) => (await fetch(`/api/sites/${id}/checks`, { method: 'POST' })).status,
      site,
    );
    expect(asked < 300, `a re-check in an even hour is asked for (${asked})`).toBe(true);
    base = await endedSince(site, nextEven, 40 * MINUTE);
  }
  expect(isOdd(base.finishedAt), 'the baseline ended while GPTBot was allowed').toBe(false);

  const look = nextLook(site, Date.now());
  skipUnless(
    look - Date.now() <= maxHours * HOUR,
    `the site's watch is ${((look - Date.now()) / HOUR).toFixed(1)} h away, past JOURNEY_SENTINEL_MAX_HOURS`,
  );
  expect(isOdd(look), 'the watch looks while GPTBot is disallowed').toBe(true);
  await sleep(look - Date.now() + SETTLE_MS);

  const day = new Date(look - TICK_MS - spreadMs(site)).toISOString().slice(0, 10);
  const checkId = sentinelCheckId(site, day);
  const { data: started } = await admin
    .from('checks')
    .select('id, status, trigger')
    .eq('id', checkId)
    .maybeSingle();
  expect(started, 'the watch started one full check that day').not.toBeNull();
  expect(started!.trigger).toBe('scheduled');
  await endedSince(site, look, 30 * MINUTE);
  const { data: blocked } = await admin
    .from('access_tests')
    .select('verdict')
    .eq('check_id', checkId)
    .eq('ua', 'GPTBot');
  expect(
    (blocked ?? []).some((t) => t.verdict === 'disallowed_by_robots'),
    'the full check records GPTBot disallowed by robots.txt',
  ).toBe(true);
  const { data: alerts } = await admin
    .from('alert_events')
    .select('id, rule_id, alert_rules!inner(kind)')
    .eq('check_id', checkId)
    .eq('alert_rules.kind', 'crawler_blocked');
  expect((alerts ?? []).length, 'one crawler_blocked alert fired on it').toBe(1);

  // The Free site: no sentinel check on its own watch day, once its watch time has passed.
  const freeLook = nextLook(freeSite, base.finishedAt);
  if (freeLook + SETTLE_MS <= Date.now()) {
    const freeDay = new Date(freeLook - TICK_MS - spreadMs(freeSite)).toISOString().slice(0, 10);
    const { data: none } = await admin
      .from('checks')
      .select('id')
      .eq('id', sentinelCheckId(freeSite, freeDay))
      .maybeSingle();
    expect(none, 'the Free site was not watched').toBeNull();
  } else {
    info.annotations.push({
      type: 'note',
      description: "the Free site's watch time had not passed",
    });
  }

  function skipUnless(ok: boolean, why: string) {
    if (!ok) info.skip(true, why);
  }
});
