import { randomUUID } from 'node:crypto';
import { expect, type Page } from './pw';
import { stagingAdmin } from './lib/accounts';
import {
  finishedLabSite,
  freshContext,
  keptLabSite,
  person,
  personWithNoSeat,
  removedMember,
} from './lib/people';
import { step } from './lib/step';

// J4: somebody else's data. Each step makes its own people on staging; the guards in lib/step.ts and
// lib/accounts.ts refuse to do that anywhere else.

step(
  'J4.1',
  "A's site page: B gets the 404, signed out goes to sign-in",
  async ({ context, baseURL }) => {
    const A = await person(context, baseURL!, 'j4', 1);
    const bContext = await freshContext(context, baseURL!);
    const sContext = await freshContext(context, baseURL!);
    try {
      const B = await person(bContext, baseURL!, 'j4', 2);
      const { site, host } = await keptLabSite(A);
      const path = `/sites/${site}`;

      const own = await A.context.request.get(path);
      expect(own.status(), 'control: A opens its own site').toBe(200);
      expect(await own.text(), 'control: the page names the host').toContain(host);

      const asB = await B.context.request.get(path);
      const missing = await B.context.request.get(`/sites/${randomUUID()}`);
      expect(asB.status(), "B on A's site").toBe(404);
      expect(missing.status(), 'B on a missing id').toBe(404);
      expect(await asB.text(), "B's answer does not name A's host").not.toContain(host);
      const shown = async (p: string) => {
        await B.page.goto(p);
        return (await B.page.locator('main').first().innerText()).replace(/\s+/g, ' ').trim();
      };
      expect(await shown(path), "A's site and a missing one read alike to B").toBe(
        await shown(`/sites/${randomUUID()}`),
      );

      const out = await sContext.request.get(path, { maxRedirects: 0 });
      expect(out.status(), 'signed out is redirected').toBeGreaterThanOrEqual(300);
      expect(out.status(), 'signed out is redirected').toBeLessThan(400);
      expect(new URL(out.headers()['location'] ?? '', baseURL).pathname, 'to sign-in').toBe(
        '/login',
      );
    } finally {
      await bContext.close();
      await sContext.close();
    }
  },
);

step(
  'J4.2',
  "A's result on each tab: B and signed out get the one 404 a missing id gets",
  async ({ context, baseURL }) => {
    const A = await person(context, baseURL!, 'j4', 6);
    const bContext = await freshContext(context, baseURL!);
    const sContext = await freshContext(context, baseURL!);
    try {
      const B = await person(bContext, baseURL!, 'j4', 7);
      const S = await sContext.newPage();
      const { site, host } = await keptLabSite(A);
      const { data } = await stagingAdmin()
        .from('checks')
        .select('id')
        .eq('site_id', site)
        .single();
      const id = data!.id as string;
      const missing = randomUUID();
      const tabs = [
        '',
        '/overview',
        '/access',
        '/nojs',
        '/structure',
        '/content',
        '/signals',
        '/changes',
        '/map',
      ];

      // The control for each tab: the owner gets the real page, naming the site, so B's 404 is a refusal.
      for (const tab of tabs) {
        const own = await A.page.goto(`/audit/${id}${tab}`);
        expect(own?.status(), `control: A opens ${tab || '/'}`).toBe(200);
        expect(new URL(A.page.url()).pathname, `control: A stays on ${tab || '/'}`).toContain(id);
        expect(await A.page.content(), `control: ${tab || '/'} names A's site`).toContain(host);
      }

      const read = async (page: Page, path: string) => {
        const res = await page.goto(path);
        const main = page.locator('main').first();
        return {
          status: res?.status(),
          text: (await main.innerText()).replace(/\s+/g, ' ').trim(),
          html: await page.content(),
          signIn: await main.locator('a[href^="/login"]').count(),
          start: await main.locator('a[href="/"]').count(),
        };
      };
      for (const [who, page] of [
        ['B', B.page],
        ['signed out', S],
      ] as const) {
        for (const tab of tabs) {
          const theirs = await read(page, `/audit/${id}${tab}`);
          const none = await read(page, `/audit/${missing}${tab}`);
          const where = `${who} on ${tab || '/'}`;
          expect(theirs.status, `${where}: a private id is a 404`).toBe(404);
          expect(none.status, `${where}: a missing id is a 404`).toBe(404);
          expect(theirs.text, `${where}: private and missing read alike`).toBe(none.text);
          expect(theirs.html, `${where}: the page's source names nothing of A`).not.toContain(host);
          expect(theirs.signIn, `${where}: offers sign-in`).toBeGreaterThan(0);
          expect(theirs.start, `${where}: offers a new audit`).toBeGreaterThan(0);
        }
      }
    } finally {
      await bContext.close();
      await sContext.close();
    }
  },
);

step(
  'J4.3',
  "B sees only its own account, even naming A's site or forging A's account",
  async ({ context, baseURL }) => {
    const A = await person(context, baseURL!, 'j4', 4);
    const bContext = await freshContext(context, baseURL!);
    try {
      const B = await person(bContext, baseURL!, 'j4', 5);
      const { site, host } = await keptLabSite(A);
      const secrets = [host, A.email, A.accountId, site];
      const leaks = (body: string, path: string) =>
        secrets.filter((m) => !path.includes(m) && body.includes(m));
      const pages = [
        '/dashboard',
        '/changes',
        '/alerts',
        '/reports',
        '/settings',
        '/settings/plan',
        '/settings/delete',
        '/seats',
      ];

      // The controls: A's pages hold what is searched for, and B is really signed in as B.
      const ownDashboard = await A.context.request.get('/dashboard');
      expect(ownDashboard.status(), 'control: A opens its dashboard').toBe(200);
      expect(await ownDashboard.text(), "control: A's dashboard names its site").toContain(host);
      const ownSettings = await A.context.request.get('/settings');
      expect(await ownSettings.text(), "control: A's settings name its address").toContain(A.email);
      const isB = async (when: string) => {
        const r = await B.context.request.get('/settings');
        expect(r.status(), `B is signed in ${when}`).toBe(200);
        expect(new URL(r.url()).pathname, `B stays on Settings ${when}`).toBe('/settings');
        expect(await r.text(), `Settings names B ${when}`).toContain(B.email);
      };
      const stillSignedIn = (r: { url(): string }, path: string) =>
        expect(new URL(r.url()).pathname, `${path} did not send B to sign-in`).not.toBe('/login');

      await isB('before the forged cookie');
      for (const path of pages) {
        const r = await B.context.request.get(path);
        expect(r.status(), `B opens its own ${path}`).toBeLessThan(500);
        stillSignedIn(r, path);
        expect(leaks(await r.text(), path), `${path} shows nothing of A`).toEqual([]);
      }
      // A forged account cookie must not move B onto A's account.
      const origin = new URL(baseURL!);
      await B.context.addCookies([
        {
          name: 'cm_account',
          value: A.accountId,
          domain: origin.hostname,
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        },
      ]);
      for (const path of pages) {
        const r = await B.context.request.get(path);
        expect(r.status(), `${path} with A's account cookie`).toBeLessThan(500);
        stillSignedIn(r, path);
        expect(
          leaks(await r.text(), path),
          `${path} with A's account cookie shows nothing of A`,
        ).toEqual([]);
      }
      await isB('with the forged cookie');
      await B.context.clearCookies({ name: 'cm_account' });

      // F-130: a foreign site id in the filter is dropped without a word.
      const path = `/changes?site=${site}`;
      const r = await B.context.request.get(path);
      const body = await r.text();
      expect(r.status(), `${path} does not fail`).toBeLessThan(500);
      expect(leaks(body, path), `${path} shows nothing of A`).toEqual([]);
      if (r.status() !== 404) {
        expect(body, 'F-130: /changes says the site is not in this account').toMatch(
          /not in this account/i,
        );
      }
    } finally {
      await bContext.close();
    }
  },
);

step('J4.7', 'v1 API routes answer 410 or refuse', async ({ context, baseURL }) => {
  const A = await person(context, baseURL!, 'j4', 3);
  const id = randomUUID();
  for (const path of [
    '/api/audits/start',
    `/api/audits/${id}/cancel`,
    `/api/audits/${id}/notify`,
    `/api/audits/${id}/reaudit`,
  ]) {
    const r = await A.context.request.post(path, { data: {} });
    expect(r.status(), `${path} is retired`).toBe(410);
  }
  // F-133: these still answer as v1 for a signed-in person, instead of 410.
  const billing = await A.context.request.get('/api/billing/status');
  if (billing.status() === 200) {
    expect(billing.status(), 'F-133: /api/billing/status still answers as v1').toBe(410);
  }
  expect(billing.status(), '/api/billing/status is retired').toBe(410);
  for (const tail of ['export', 'llms-txt']) {
    const r = await A.context.request.get(`/api/audits/${id}/${tail}`);
    if (r.status() === 402) {
      expect(r.status(), `F-133: /api/audits/<id>/${tail} still answers 402`).toBe(410);
    }
    expect(r.status(), `/api/audits/<id>/${tail} is retired`).toBe(410);
  }
});

/** One request from inside a page of the deployment, so it carries that browser's session and origin. */
const call = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ({ method, path, body }) => {
      const r = await fetch(path, {
        method,
        signal: AbortSignal.timeout(10_000),
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      return { status: r.status, text: (await r.text()).slice(0, 400) };
    },
    { method, path, body },
  );

step(
  'J4.4',
  "A's fix packet and its email: B gets the 404, signed out the 401",
  async ({ context, baseURL }, info) => {
    info.setTimeout(420_000);
    const A = await person(context, baseURL!, 'j4', 8);
    const bContext = await freshContext(context, baseURL!);
    const sContext = await freshContext(context, baseURL!);
    try {
      const B = await person(bContext, baseURL!, 'j4', 9);
      const S = await sContext.newPage();
      const { fix, host } = await finishedLabSite(A);
      await Promise.all([A.page.goto('/dashboard'), B.page.goto('/dashboard'), S.goto('/help')]);
      const own = await call(A.page, 'GET', `/api/fixes/${fix}/packet`);
      expect([200, 402], `control: A reaches its own packet (${own.status})`).toContain(own.status);
      const missing = randomUUID();
      for (const [method, tail, body] of [
        ['GET', 'packet', undefined],
        ['POST', 'email-developer', { email: 'developer@lab.crawlmouse.com' }],
      ] as const) {
        const asB = await call(B.page, method, `/api/fixes/${fix}/${tail}`, body);
        const none = await call(B.page, method, `/api/fixes/${missing}/${tail}`, body);
        expect(asB.status, `B on ${tail}`).toBe(404);
        expect(asB.text.replaceAll(fix, 'ID'), `B: ${tail} reads as a missing id`).toBe(
          none.text.replaceAll(missing, 'ID'),
        );
        expect(asB.text, `B: ${tail} names nothing of A`).not.toContain(host);
        const out = await call(S, method, `/api/fixes/${fix}/${tail}`, body);
        expect(out.status, `signed out on ${tail}`).toBe(401);
      }
      const { count } = await stagingAdmin()
        .from('fix_email_requests')
        .select('*', { count: 'exact', head: true })
        .eq('fix_id', fix);
      expect(count ?? 0, "no email request was recorded for A's fix").toBe(0);
    } finally {
      await bContext.close();
      await sContext.close();
    }
  },
);

step(
  'J4.6',
  "A's API calls replayed by people with no access change nothing",
  async ({ context, baseURL }, info) => {
    info.setTimeout(600_000);
    const A = await person(context, baseURL!, 'j4', 10);
    const contexts = await Promise.all([1, 2, 3, 4].map(() => freshContext(context, baseURL!)));
    try {
      const B = await person(contexts[0]!, baseURL!, 'j4', 11);
      const none = await personWithNoSeat(contexts[1]!, baseURL!, 'j4', 12);
      const gone = await removedMember(contexts[2]!, baseURL!, A, 'j4', 13);
      const S = await contexts[3]!.newPage();
      const { site, check, fix, host } = await finishedLabSite(A);
      const db = stagingAdmin();
      const { data: seatRow } = await db
        .from('seats')
        .select('id')
        .eq('account_id', A.accountId)
        .eq('user_id', A.userId)
        .single();
      const seat = seatRow!.id as string;
      const state = async () =>
        JSON.stringify(
          await Promise.all([
            db
              .from('sites')
              .select('host, removed_at, paused, schedule_cadence, competitor_hosts')
              .eq('id', site)
              .single()
              .then((r) => r.data),
            db
              .from('checks')
              .select('status, failure_reason')
              .eq('id', check)
              .single()
              .then((r) => r.data),
            db
              .from('site_fixes')
              .select('status')
              .eq('id', fix)
              .single()
              .then((r) => r.data),
            db
              .from('seats')
              .select('role, status')
              .eq('id', seat)
              .single()
              .then((r) => r.data),
            db
              .from('fix_events')
              .select('id', { count: 'exact', head: true })
              .eq('fix_id', fix)
              .then((r) => r.count),
            db
              .from('checks')
              .select('id', { count: 'exact', head: true })
              .eq('site_id', site)
              .then((r) => r.count),
          ]),
        );
      const before = await state();
      const routes: [string, (id: string) => string, string, unknown?][] = [
        ['GET', (i) => `/api/checks/${i}/stream`, check],
        ['POST', (i) => `/api/checks/${i}/cancel`, check, {}],
        ['POST', (i) => `/api/checks/${i}/claim`, check, {}],
        ['POST', (i) => `/api/checks/${i}/notify`, check, { email: 'nobody@lab.crawlmouse.com' }],
        ['GET', (i) => `/api/fixes/${i}/packet`, fix],
        ['POST', (i) => `/api/fixes/${i}/done`, fix, {}],
        [
          'POST',
          (i) => `/api/fixes/${i}/email-developer`,
          fix,
          { email: 'nobody@lab.crawlmouse.com' },
        ],
        ['PATCH', (i) => `/api/sites/${i}`, site, { paused: true }],
        ['DELETE', (i) => `/api/sites/${i}`, site],
        ['POST', (i) => `/api/sites/${i}/checks`, site, {}],
        ['PUT', (i) => `/api/sites/${i}/alert-rules`, site, {}],
        ['PUT', (i) => `/api/report-files/schedules/site/${i}`, site, {}],
        ['DELETE', (i) => `/api/report-files/schedules/site/${i}`, site],
        ['PATCH', (i) => `/api/seats/id/${i}`, seat, { role: 'developer', scope: 'all' }],
        ['DELETE', (i) => `/api/seats/id/${i}`, seat],
        ['POST', (i) => `/api/seats/id/${i}/resend`, seat, {}],
      ];
      const actors: [string, Page][] = [
        ['B', B.page],
        ['no active seat', none.page],
        ["A's removed member", gone.page],
        ['signed out', S],
      ];
      const seen: Record<string, number> = {};
      for (const [who, page] of actors) {
        await page.goto('/help');
        for (const [method, path, id, body] of routes) {
          const missing = randomUUID();
          const real = await call(page, method, path(id), body);
          const fake = await call(page, method, path(missing), body);
          const where = `${who}: ${method} ${path(':id')}`;
          seen[real.status] = (seen[real.status] ?? 0) + 1;
          expect(real.status, `${where} is refused`).toBeGreaterThanOrEqual(400);
          expect(real.status, `${where} does not error`).toBeLessThan(500);
          expect(real.text, `${where} names nothing of A`).not.toContain(host);
          if (real.status === 429 || fake.status === 429) continue;
          expect(real.status, `${where}: a private id and a missing id answer alike`).toBe(
            fake.status,
          );
          expect(real.text.replaceAll(id, 'ID'), `${where}: the same body`).toBe(
            fake.text.replaceAll(missing, 'ID'),
          );
        }
      }
      info.annotations.push({ type: 'statuses', description: JSON.stringify(seen) });
      expect(await state(), "no request changed A's site, check, fix or seat").toBe(before);
    } finally {
      for (const c of contexts) await c.close();
    }
  },
);
