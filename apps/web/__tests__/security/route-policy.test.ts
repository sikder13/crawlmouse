import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ROUTE_POLICIES,
  isApiPath,
  isStateChanging,
  pathSegments,
  policiesForPath,
  policyForPath,
} from '../../lib/security/route-policy';
import { mechanismProblems, readsJsonBody, refusesWithoutSession } from './route-mechanism';
import {
  callPositions,
  exportedMethods,
  parseSource,
  readRoute,
  routeFolders,
} from './route-source';

const byRoute = new Map(ROUTE_POLICIES.map((p) => [p.route, p]));

describe('the route registry lists every route file once', () => {
  const onDisk = routeFolders();

  it('reads route files from disk (anti-vacuity)', () => {
    expect(onDisk.length).toBeGreaterThan(20);
    expect(onDisk).toContain('api/webhooks/stripe');
    expect(onDisk).toContain('login/verify');
  });

  it('every route file has a row', () => {
    expect(onDisk.filter((r) => !byRoute.has(r))).toEqual([]);
  });

  it('every row has a route file', () => {
    expect(ROUTE_POLICIES.map((p) => p.route).filter((r) => !onDisk.includes(r))).toEqual([]);
  });

  it('no route has two rows', () => {
    expect(ROUTE_POLICIES.length).toBe(byRoute.size);
  });

  it.each(ROUTE_POLICIES.map((p) => [p.route, p] as const))(
    '%s lists exactly the methods its file exports',
    (route, policy) => {
      expect([...policy.methods].sort()).toEqual(exportedMethods(readRoute(route)));
    },
  );

  it('every public row says why it needs no session', () => {
    const missing = ROUTE_POLICIES.filter((p) => p.class === 'public' && !p.reason?.trim());
    expect(missing.map((p) => p.route)).toEqual([]);
  });

  it('only public rows carry a reason, and only service and webhook rows a verifier', () => {
    for (const p of ROUTE_POLICIES) {
      expect(p.reason === undefined, p.route).toBe(p.class !== 'public');
      expect(p.verifier === undefined, p.route).toBe(
        p.class !== 'service' && p.class !== 'webhook',
      );
    }
  });
});

describe('the route finder sees every file Next serves as a route handler', () => {
  it.each(['route.ts', 'route.tsx', 'route.js', 'route.jsx'])('%s', (name) => {
    const dir = mkdtempSync(join(tmpdir(), 'routes-'));
    try {
      mkdirSync(join(dir, 'api', 'probe'), { recursive: true });
      writeFileSync(join(dir, 'api', 'probe', name), 'export async function POST() {}');
      writeFileSync(join(dir, 'api', 'probe', 'helper.ts'), '');
      expect(routeFolders(dir)).toEqual(['api/probe']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the export reader sees each spelling a route uses', () => {
  it.each([
    ['export async function POST() {}', ['POST']],
    ['export function GET() {}\nexport async function DELETE() {}', ['DELETE', 'GET']],
    ['const handler = () => null;\nexport { handler as GET, handler as POST };', ['GET', 'POST']],
    ['export const { GET, POST, PUT } = serve({});', ['GET', 'POST', 'PUT']],
    ['export const PATCH = () => null;', ['PATCH']],
    ['export const runtime = "nodejs";\nexport const maxDuration = 300;', []],
  ])('%s', (src, methods) => {
    expect(exportedMethods(parseSource(src))).toEqual(methods);
  });
});

describe('each route source shows the mechanism its class requires', () => {
  it.each(ROUTE_POLICIES.map((p) => [`${p.route} (${p.class})`, p] as const))('%s', (_, policy) => {
    expect(mechanismProblems(readRoute(policy.route), policy.class, policy.verifier)).toEqual([]);
  });

  it('a route that answers 401 after asking for the session is registered as user or member', () => {
    const misfiled = ROUTE_POLICIES.filter(
      (p) =>
        p.class !== 'user' && p.class !== 'member' && refusesWithoutSession(readRoute(p.route)),
    );
    expect(misfiled.map((p) => p.route)).toEqual([]);
  });

  it('the 401 reading finds the signed-in routes (anti-vacuity)', () => {
    expect(refusesWithoutSession(readRoute('api/verify/start'))).toBe(true);
    expect(refusesWithoutSession(readRoute('api/audits/start'))).toBe(false);
  });

  it("the tRPC router defines queries and no mutation, as trpc/[trpc]'s reason says", () => {
    const router = parseSource(
      readFileSync(resolve(__dirname, '../../lib/trpc/router.ts'), 'utf8'),
    );
    expect(callPositions(router, 'query').length).toBeGreaterThan(0);
    expect(callPositions(router, 'mutation')).toEqual([]);
    expect(callPositions(router, 'subscription')).toEqual([]);
  });
});

describe('the mechanism checks fail on the code they guard against', () => {
  const check = (src: string, cls: Parameters<typeof mechanismProblems>[1], verifier?: string) =>
    mechanismProblems(parseSource(src), cls, verifier);

  it('user: the session is read before any service-role call', () => {
    const ok = `export async function POST() { const { data: { user } } = await sb.auth.getUser(); const a = supabaseAdmin(); }`;
    const late = `export async function POST() { const a = supabaseAdmin(); await sb.auth.getUser(); }`;
    const none = `export async function POST() { const a = supabaseAdmin(); }`;
    const commented = `// sb.auth.getUser()\nexport async function POST() { const a = supabaseAdmin(); }`;
    expect(check(ok, 'user')).toEqual([]);
    expect(check(late, 'user')).toEqual(['calls supabaseAdmin() before getUser() (1 call)']);
    expect(check(none, 'user')).toEqual(['never calls getUser()']);
    expect(check(commented, 'user')).toEqual(['never calls getUser()']);
  });

  it('member: the membership check runs before any service-role call', () => {
    const ok = `export async function POST() { await sb.auth.getUser(); await sb.rpc('is_member', { p_account: a }); supabaseAdmin(); }`;
    const late = `export async function POST() { await sb.auth.getUser(); supabaseAdmin(); await sb.rpc('is_member', {}); }`;
    const none = `export async function POST() { await sb.auth.getUser(); supabaseAdmin(); }`;
    expect(check(ok, 'member')).toEqual([]);
    expect(check(late, 'member')).toEqual(['calls supabaseAdmin() before the membership check']);
    expect(check(none, 'member')).toEqual(['never checks membership through rpc()']);
  });

  it('webhook: the signature is verified before the route uses the payload', () => {
    const imports = `import { applyEvent } from '@/lib/apply';\nimport { stripe } from '@/lib/stripe';\n`;
    const ok = `${imports}export async function POST(req) { const raw = await req.text(); const e = stripe.webhooks.constructEvent(raw, s, k); await applyEvent(e); }`;
    const late = `${imports}export async function POST(req) { const raw = await req.text(); await applyEvent(raw); stripe.webhooks.constructEvent(raw, s, k); }`;
    const parsed = `${imports}export async function POST(req) { const b = await req.json(); stripe.webhooks.constructEvent(b, s, k); }`;
    expect(check(ok, 'webhook', 'constructEvent')).toEqual([]);
    expect(check(late, 'webhook', 'constructEvent')).toEqual([
      'calls applyEvent() before constructEvent()',
    ]);
    expect(check(parsed, 'webhook', 'constructEvent')).toEqual([
      'parses the request body with json() or formData()',
      'calls req.json() before constructEvent()',
    ]);
    const viaClient = `${imports}export async function POST(req) { const raw = await req.text(); const u = JSON.parse(raw); await stripe.customers.update(u.id, {}); stripe.webhooks.constructEvent(raw, s, k); }`;
    expect(check(viaClient, 'webhook', 'constructEvent')).toEqual([
      'calls JSON.parse() before constructEvent()',
      'calls stripe.customers.update() before constructEvent()',
    ]);
    const viaAlias = `${imports}export async function POST(req) { const raw = await req.text(); const body = await req.clone().json(); const customers = stripe.customers; await customers.update(body.id, {}); stripe.webhooks.constructEvent(raw, s, k); }`;
    expect(check(viaAlias, 'webhook', 'constructEvent')).toEqual([
      'calls req.clone().json() before constructEvent()',
      'calls customers.update() before constructEvent()',
    ]);
  });

  it('webhook (inngest): every export is handled by serve() from inngest/next', () => {
    const ok = `import { serve } from 'inngest/next';\nexport const { GET, POST, PUT } = serve({});`;
    const extra = `import { serve } from 'inngest/next';\nexport const { GET, PUT } = serve({});\nexport async function POST() {}`;
    const other = `import { serve } from './not-inngest';\nexport const { POST } = serve({});`;
    expect(check(ok, 'webhook', 'serve')).toEqual([]);
    expect(check(extra, 'webhook', 'serve')).toEqual(['exports POST that serve() does not handle']);
    expect(check(other, 'webhook', 'serve')).toEqual(['does not import serve from inngest/next']);
  });

  it('operator: requireOperator runs before any service-role client or body read', () => {
    const ok = `export async function POST(req) { const proof = await requireOperator(await supabaseServer()); if (!proof) return notFound(); const body = await readBody(req); consoleStore(proof); }`;
    const late = `export async function POST(req) { const s = consoleStore(p); const a = supabaseAdmin(); const b = consoleAdmin(p); await requireOperator(sb); }`;
    const bodyFirst = `export async function POST(req) { const body = await readBody(req); const f = await req.formData(); await requireOperator(sb); }`;
    const none = `export async function POST(req) { const a = supabaseAdmin(); }`;
    const commented = `// requireOperator(sb)\nexport async function POST() { consoleStore(p); }`;
    expect(check(ok, 'operator')).toEqual([]);
    expect(check(late, 'operator')).toEqual([
      'calls supabaseAdmin(), consoleAdmin() or consoleStore() before requireOperator() (3 calls)',
    ]);
    expect(check(bodyFirst, 'operator')).toEqual([
      'reads the request body before requireOperator() (2 reads)',
    ]);
    expect(check(none, 'operator')).toEqual(['never calls requireOperator()']);
    expect(check(commented, 'operator')).toEqual(['never calls requireOperator()']);
  });

  it('service: the credential is checked before any service-role call', () => {
    const ok = `export async function POST(req) { if (!timingSafeEqual(a, b)) return; supabaseAdmin(); }`;
    const late = `export async function POST(req) { supabaseAdmin(); timingSafeEqual(a, b); }`;
    expect(check(ok, 'service', 'timingSafeEqual')).toEqual([]);
    expect(check(late, 'service', 'timingSafeEqual')).toEqual([
      'calls supabaseAdmin() before timingSafeEqual()',
    ]);
  });
});

describe('the registry finds the row a request path reaches', () => {
  it.each([
    ['/api/billing/checkout', 'api/billing/checkout'],
    ['/api/billing/checkout/', 'api/billing/checkout'],
    ['/api//billing///checkout', 'api/billing/checkout'],
    ['/api/billing/%63heckout', 'api/billing/checkout'],
    ['/api/audits/6f1c2a8e-0000-4000-8000-000000000000/cancel', 'api/audits/[id]/cancel'],
    ['/api/reports/abc123/white-label', 'api/reports/[slug]/white-label'],
    // Next decodes a dynamic segment's value after matching, so an encoded slash stays inside it.
    ['/api/reports/a%2Fb/claim', 'api/reports/[slug]/claim'],
    ['/api/audits/6f1c2a8e%2Fx/cancel', 'api/audits/[id]/cancel'],
    ['/api/trpc/audits.getById', 'api/trpc/[trpc]'],
    // Vercel's router serves a dynamic route in any case, so the lookup matches in any case too.
    ['/API/reports/abc/visibility', 'api/reports/[slug]/visibility'],
    ['/Api/audits/6f1c2a8e-0000-4000-8000-000000000000/CANCEL', 'api/audits/[id]/cancel'],
    ['/api/REPORTS/abc/mine', 'api/reports/[slug]/mine'],
    ['/API/webhooks/stripe', 'api/webhooks/stripe'],
    ['/billing', 'billing'],
    ['/login/verify', 'login/verify'],
    ['/robots.txt', 'robots.txt'],
  ])('%s → %s', (path, route) => {
    expect(policyForPath(path)?.route).toBe(route);
  });

  it.each([
    '/api/billing',
    '/api/billing/checkout/extra',
    '/api/audits//cancel',
    '/api/%E0%A4%A',
    '/api/audits/%ZZ/cancel',
    '/billing/checkout',
    '/robotsXtxt',
  ])('%s matches no row', (path) => {
    expect(policyForPath(path)).toBeUndefined();
  });

  it("each row's own path matches that row alone: no two rows overlap", () => {
    // A static route's path also matches a dynamic sibling's pattern, so this catches the overlap Next
    // would settle by preferring the static route, and the lookup would settle by registry order.
    // A route group's segment is not in the URL.
    const samples = (route: string) =>
      [
        route
          .replace(/\([^)]*\)\//g, '')
          .replace(/\[\[?\.\.\.[^\]]+\]\]?/g, 'a/b')
          .replace(/\[[^\]]+\]/g, 'sample'),
      ].map((p) => `/${p}`);
    for (const p of ROUTE_POLICIES) {
      for (const path of samples(p.route)) {
        expect(
          policiesForPath(path).map((r) => r.route),
          path,
        ).toEqual([p.route]);
      }
    }
  });

  it('decodes each segment on its own, and gives up on one that does not decode', () => {
    expect(pathSegments('/api/reports/a%2Fb/claim/')).toEqual(['api', 'reports', 'a/b', 'claim']);
    expect(pathSegments('/api/audits/%ZZ/cancel')).toBeUndefined();
  });

  it('an /api path is recognised decoded, encoded, or undecodable', () => {
    for (const p of ['/api/x', '/%61pi/x', '/api/%ZZ', '/API/x', '/Api/%ZZ'])
      expect(isApiPath(p), p).toBe(true);
    for (const p of ['/apix', '/login', '/', '/%ZZ/api/x']) expect(isApiPath(p), p).toBe(false);
  });

  it('every method but GET, HEAD and OPTIONS is a state change, an unknown one included', () => {
    for (const m of ['POST', 'put', 'Patch', 'DELETE', 'QUERY', 'PROPFIND'])
      expect(isStateChanging(m), m).toBe(true);
    for (const m of ['GET', 'head', 'OPTIONS']) expect(isStateChanging(m), m).toBe(false);
  });
});

describe('cross-site refusal covers every state change a session or a visitor can be made to send', () => {
  it('every state-changing user, member or operator route takes the strict rule', () => {
    const open = ROUTE_POLICIES.filter(
      (p) =>
        (p.class === 'user' || p.class === 'member' || p.class === 'operator') &&
        p.methods.some(isStateChanging) &&
        p.origin !== 'strict',
    );
    expect(open.map((p) => p.route)).toEqual([]);
  });

  it('the strict rule is on exactly these routes', () => {
    expect(
      ROUTE_POLICIES.filter((p) => p.origin === 'strict')
        .map((p) => p.route)
        .sort(),
    ).toEqual([
      'api/account',
      'api/account/delete/confirm',
      'api/account/email',
      'api/account/email/confirm',
      'api/account/email/undo',
      'api/account/restore',
      'api/agency-trial',
      'api/alert-rules',
      'api/audits/[id]/cancel',
      'api/audits/[id]/reaudit',
      'api/auth/logout',
      'api/billing/agency-trial',
      'api/billing/cancel',
      'api/billing/checkout',
      'api/billing/portal',
      'api/billing/pro-trial/start',
      'api/checks/[id]/cancel',
      'api/checks/[id]/claim',
      'api/fixes/[id]/done',
      'api/fixes/[id]/email-developer',
      'api/internal/accounts/[id]/sign-in-link',
      'api/internal/checks/[id]/rerun',
      'api/internal/search',
      'api/me',
      'api/reports/[slug]/claim',
      'api/reports/[slug]/logo',
      'api/reports/[slug]/view',
      'api/reports/[slug]/visibility',
      'api/reports/[slug]/white-label',
      'api/sites',
      'api/sites/[id]',
      'api/sites/[id]/alert-rules',
      'api/sites/[id]/checks',
      'api/verify/check/[id]',
      'api/verify/start',
    ]);
  });

  it('a public route says it reads the session exactly when its source calls getUser()', () => {
    for (const p of ROUTE_POLICIES.filter((r) => r.class === 'public')) {
      expect(p.session === 'optional', p.route).toBe(
        callPositions(readRoute(p.route), 'getUser').length > 0,
      );
    }
    for (const p of ROUTE_POLICIES.filter((r) => r.class !== 'public'))
      expect(p.session, p.route).toBeUndefined();
  });

  it('a state-changing public route that reads the session takes an origin rule', () => {
    // The middleware guards API routes only. /login/verify, outside /api, checks the same strict rule
    // in its own POST, which its source must show.
    const CHECKS_ITS_OWN = ['login/verify'];
    expect(callPositions(readRoute('login/verify'), 'isSameOrigin').length).toBeGreaterThan(0);
    const open = ROUTE_POLICIES.filter(
      (p) =>
        p.session === 'optional' &&
        p.methods.some(isStateChanging) &&
        p.origin === 'any' &&
        !CHECKS_ITS_OWN.includes(p.route),
    );
    expect(open.map((p) => p.route)).toEqual([]);
  });

  it('webhook and service routes take no origin rule: their callers are not our pages', () => {
    const wrong = ROUTE_POLICIES.filter(
      (p) => (p.class === 'webhook' || p.class === 'service') && p.origin !== 'any',
    );
    expect(wrong.map((p) => p.route)).toEqual([]);
  });

  it('a route with no state-changing method takes no origin rule, and only API routes take one', () => {
    const idle = ROUTE_POLICIES.filter(
      (p) =>
        p.origin !== 'any' && (!p.methods.some(isStateChanging) || !p.route.startsWith('api/')),
    );
    expect(idle.map((p) => p.route)).toEqual([]);
  });

  it('a route that requires a JSON body reads one, and takes an origin rule', () => {
    for (const p of ROUTE_POLICIES.filter((r) => r.jsonBody)) {
      expect(readsJsonBody(readRoute(p.route)), p.route).toBe(true);
      expect(p.origin, p.route).not.toBe('any');
    }
  });

  it('every public route that changes state from a JSON body takes the lenient rule and the JSON rule', () => {
    const missing = ROUTE_POLICIES.filter(
      (p) =>
        p.class === 'public' &&
        p.methods.some(isStateChanging) &&
        readsJsonBody(readRoute(p.route)) &&
        !(p.origin === 'lenient' && p.jsonBody),
    );
    expect(missing.map((p) => p.route)).toEqual([]);
  });
});
