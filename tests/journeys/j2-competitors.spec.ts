import { expect } from './pw';
import { stagingAdmin } from './lib/accounts';
import { keptLabSite, person } from './lib/people';
import { assertCheckableSite } from './lib/sites';
import { step } from './lib/step';

// J2.4e (row 18): a competitor a Pro customer names is audited and compared. The customer is a new
// person on staging on the no-card Pro trial, the site and the competitor are two of the lab's
// client sites, and the comparison is read where the customer reads it: the Signals tab.

const MINUTE = 60_000;
/** A lab site's own check and its competitor's, back to back, with room for a busy worker. */
const WAIT_MS = 25 * MINUTE;

async function until<T>(what: string, read: () => Promise<T | null>, ms: number): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = await read();
    if (got !== null) return got;
    if (Date.now() > end) throw new Error(`F-096: ${what} within ${ms / MINUTE} minutes`);
    await new Promise((r) => setTimeout(r, 20_000));
  }
}

step('J2.4e', 'One competitor', async ({ context, baseURL }, info) => {
  info.setTimeout(WAIT_MS + 10 * MINUTE);
  const A = await person(context, baseURL!, 'j2', 5);
  const trial = await A.page.evaluate(async (accountId) => {
    const r = await fetch('/api/billing/pro-trial/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId }),
    });
    return r.status;
  }, A.accountId);
  expect(trial, 'the no-card Pro trial starts').toBe(200);

  const { site, host } = await keptLabSite(A);
  const rival = ['client-1', 'client-2']
    .map((c) => `${c}.lab.crawlmouse.com`)
    .find((h) => h !== host)!;
  assertCheckableSite(rival);

  const saved = await A.page.evaluate(
    async ({ id, competitor }) =>
      (
        await fetch(`/api/sites/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ competitorHosts: [competitor] }),
        })
      ).status,
    { id: site, competitor: rival },
  );
  expect(saved, 'the competitor is saved').toBe(200);
  const asked = await A.page.evaluate(
    async (id) => (await fetch(`/api/sites/${id}/checks`, { method: 'POST' })).status,
    site,
  );
  expect(asked < 300, `a re-check is asked for (${asked})`).toBe(true);

  const admin = stagingAdmin();
  const compared = await until(
    `the site's check carries ${rival}'s snapshot`,
    async () => {
      const { data } = await admin
        .from('checks')
        .select('id, competitors')
        .eq('site_id', site)
        .in('status', ['finished', 'partial'])
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const snaps = (data?.competitors ?? []) as { host: string }[];
      return data && snaps.some((s) => s.host === rival) ? (data.id as string) : null;
    },
    WAIT_MS,
  );

  // The competitor was audited as a site no account keeps, under its own host, and nothing of the
  // customer's is on that row.
  const { data: theirs } = await admin
    .from('sites')
    .select('id, host, account_id, competitor_hosts, owner_seat_id')
    .eq('host', rival)
    .is('account_id', null);
  expect(theirs?.length, `${rival} has a site row no account keeps`).toBeGreaterThan(0);
  for (const row of theirs ?? []) {
    expect(row.competitor_hosts, 'the competitor names no competitor').toEqual([]);
    expect(row.owner_seat_id, 'the competitor has no owner').toBeNull();
  }

  await A.page.goto(`/audit/${compared}/signals`);
  const main = A.page.locator('main').first();
  await expect(main, 'the Signals tab compares the two').toContainText(`How ${rival} compares`);
  await expect(main).toContainText('Crawlers that get in');
  await expect(main).not.toContainText('undefined');
});
