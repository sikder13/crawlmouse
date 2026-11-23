import { randomUUID } from 'node:crypto';
import { expect, type Page } from './pw';
import { stagingAdmin } from './lib/accounts';
import { freshContext, keptLabSite, person } from './lib/people';
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
  "A's result on every tab: B and signed out get the one 404 a missing id gets",
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
      const fix = randomUUID();
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
        `/fix/${fix}`,
      ];

      const own = await A.page.goto(`/audit/${id}/overview`);
      expect(own?.status(), 'control: A opens its own result').toBe(200);

      const read = async (page: Page, path: string) => {
        const res = await page.goto(path);
        const main = page.locator('main').first();
        return {
          status: res?.status(),
          text: (await main.innerText()).replace(/\s+/g, ' ').trim(),
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
          // F-127's own symptom: the page tells the owner of a kept result that it is gone.
          if (theirs.status === 404 && /does not exist, or it has expired/i.test(theirs.text)) {
            expect(theirs.text, `F-127: ${where} says the result is gone`).not.toMatch(
              /does not exist, or it has expired/i,
            );
          }
          expect(theirs.status, `${where}: a private id is a 404`).toBe(404);
          expect(none.status, `${where}: a missing id is a 404`).toBe(404);
          expect(theirs.text, `${where}: private and missing read alike`).toBe(none.text);
          expect(theirs.text, `${where}: names nothing of A`).not.toContain(host);
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

      for (const path of pages) {
        const r = await B.context.request.get(path);
        expect(r.status(), `B opens its own ${path}`).toBeLessThan(500);
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
        expect(
          leaks(await r.text(), path),
          `${path} with A's account cookie shows nothing of A`,
        ).toEqual([]);
      }
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
