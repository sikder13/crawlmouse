import { randomUUID } from 'node:crypto';
import { expect } from './pw';
import { freshContext, keptSite, person } from './lib/people';
import { step } from './lib/step';

// J4: somebody else's data. Each step makes its own people on staging; the guards in lib/step.ts and
// lib/accounts.ts refuse to do that anywhere else.
const labHost = () => `client-${1 + Math.floor(Math.random() * 6)}.lab.crawlmouse.com`;

step(
  'J4.1',
  "A's site page: B gets the 404, signed out goes to sign-in",
  async ({ context, baseURL }) => {
    const A = await person(context, baseURL!, 'j4', 1);
    const bContext = await freshContext(context, baseURL!);
    const sContext = await freshContext(context, baseURL!);
    try {
      const B = await person(bContext, baseURL!, 'j4', 2);
      const host = labHost();
      const site = await keptSite(A, host);
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
