import { describe, expect, it } from 'vitest';
import { PRODUCTION_REF } from '../db/target';
import {
  ROUTES,
  RefusedRequest,
  TOKEN_HOST,
  guardedFetch,
  refusal,
  stringLeaves,
  type Tokens,
} from './http';
import { migrationsProbe } from './probes/migrations';
import { resendProbe } from './probes/resend';
import { stripeProbe } from './probes/stripe';
import { VERCEL_PROJECT_ID, VERCEL_TEAM_ID, vercelEnvProbe } from './probes/vercel-env';
import { healthzProbe, releaseProbe } from './probes/worker';
import { TOKEN_ENV } from './redact';
import { deps, fakeToken, json, scriptedFetch } from './test-support';

const ENV = `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env`;
const PROJECT = `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}`;
const READ_ONLY = `https://api.supabase.com/v1/projects/${PRODUCTION_REF}/database/query/read-only`;
const MACHINES = 'https://api.machines.dev/v1/apps/crawlmouse-worker/machines';
const HEALTHZ = 'https://crawlmouse-worker.fly.dev/healthz';

const tokens = {
  VERCEL_TOKEN: fakeToken(['vcp', 'test'], 'v'),
  SUPABASE_ACCESS_TOKEN: fakeToken(['sbp', 'test'], 's'),
  FLY_READ_TOKEN: ['FlyV1', fakeToken(['fm2'], 'f')].join(' '),
  STRIPE_LIVE_READ_KEY: ['rk', 'live', 'k'.repeat(30)].join('_'),
  RESEND_API_KEY: fakeToken(['re', 'test'], 'r'),
} satisfies Tokens;
const bearer = (t: string) => new Headers({ authorization: `Bearer ${t}` });
const P = VERCEL_PROJECT_ID;

describe('the outbound allow-list', () => {
  it.each([
    ['another host', 'https://example.com/x', 'GET'],
    ['a host that ends like an allowed one', `https://evil-api.vercel.com/v9/projects/${P}`, 'GET'],
    ['a subdomain of an allowed one', 'https://x.api.stripe.com/v1/prices', 'GET'],
    ['plain http', `http://api.vercel.com/v9/projects/${P}`, 'GET'],
    ['a non-default port', `https://api.vercel.com:8443/v9/projects/${P}`, 'GET'],
    ['credentials in the URL', `https://u:p@api.vercel.com/v9/projects/${P}`, 'GET'],
    ['a decrypt query', `${ENV}?decrypt=true`, 'GET'],
    ['a percent-encoded decrypt query', `${ENV}?de%63rypt=true`, 'GET'],
    ['a decrypt query beside teamId', `${ENV}?teamId=${VERCEL_TEAM_ID}&decrypt=true`, 'GET'],
    [
      'the single-variable path',
      `https://api.vercel.com/v1/projects/${P}/env/env_abc?teamId=t`,
      'GET',
    ],
    ['the env path under another version', `https://api.vercel.com/v9/projects/${P}/env`, 'GET'],
    ['a decrypt path', `${ENV}/e/decrypt`, 'GET'],
    ['another Vercel project', 'https://api.vercel.com/v9/projects/prj_other', 'GET'],
    ['a percent-encoded path segment', `https://api.vercel.com/v10/projects/${P}/%65nv`, 'GET'],
    ['a deployments listing', 'https://api.vercel.com/v6/deployments', 'GET'],
    ['a POST to Vercel', ENV, 'POST'],
    ['a DELETE to Fly', MACHINES, 'DELETE'],
    [
      'another Fly app',
      'https://api.machines.dev/v1/apps/crawlmouse-worker-staging/machines',
      'GET',
    ],
    ['one machine', `${MACHINES}/m1`, 'GET'],
    ['a POST to Stripe', 'https://api.stripe.com/v1/prices', 'POST'],
    ['another Stripe path', 'https://api.stripe.com/v1/customers', 'GET'],
    ['an expand parameter on prices', 'https://api.stripe.com/v1/prices?expand[]=x', 'GET'],
    ['another worker path', 'https://crawlmouse-worker.fly.dev/batch', 'GET'],
    ['a query on healthz', `${HEALTHZ}?x=1`, 'GET'],
    ['another Resend path', 'https://api.resend.com/emails', 'GET'],
    [
      'a POST to another Supabase path',
      `https://api.supabase.com/v1/projects/${PRODUCTION_REF}/database/query`,
      'POST',
    ],
    [
      'the read-only query on another project',
      'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query/read-only',
      'POST',
    ],
    ['a GET to the read-only query', READ_ONLY, 'GET'],
    ['a relative URL', '/v1/prices', 'GET'],
  ])('refuses %s', (_label, url, method) => {
    expect(refusal(url, method)).not.toBeNull();
  });

  it('allows each route with its own parameters', () => {
    expect(refusal(`${ENV}?teamId=${VERCEL_TEAM_ID}`, 'GET')).toBeNull();
    expect(refusal(`${PROJECT}?teamId=${VERCEL_TEAM_ID}`, 'GET')).toBeNull();
    expect(refusal(READ_ONLY, 'POST')).toBeNull();
    expect(refusal(MACHINES, 'GET')).toBeNull();
    expect(refusal(HEALTHZ, 'GET')).toBeNull();
    expect(refusal('https://api.stripe.com/v1/prices?lookup_keys[]=a&limit=100', 'GET')).toBeNull();
    expect(refusal('https://api.resend.com/domains', 'GET')).toBeNull();
  });

  it("accepts every probe's real request, headers and tokens included", async () => {
    const { fetch, calls } = scriptedFetch(() => json({}, 500));
    const d = deps({ fetch, env: tokens });
    await vercelEnvProbe(1)(d);
    await migrationsProbe()(d);
    await healthzProbe(d);
    await releaseProbe(() => ['packages/**'])(d);
    await stripeProbe(d);
    await resendProbe(d);
    const hosts = new Set(calls.map((c) => new URL(c.url).hostname));
    expect([...hosts].sort()).toEqual([...new Set(ROUTES.map((r) => r.host))].sort());
    for (const c of calls) {
      expect(refusal(c.url, c.method, new Headers(c.headers), tokens), c.url).toBeNull();
    }
  });

  it('throws before the inner fetch is called', async () => {
    const { fetch, calls } = scriptedFetch(() => json({}));
    const guarded = guardedFetch(fetch, () => {});
    await expect(guarded('https://example.com/', { method: 'GET' })).rejects.toBeInstanceOf(
      RefusedRequest,
    );
    await expect(guarded(`${ENV}?decrypt=true`)).rejects.toBeInstanceOf(RefusedRequest);
    await expect(guarded(PROJECT, { method: 'PATCH' })).rejects.toBeInstanceOf(RefusedRequest);
    expect(calls).toEqual([]);
  });

  it('passes an allowed request through and hands every response string to onValue', async () => {
    const { fetch, calls } = scriptedFetch(() =>
      json({ envs: [{ key: 'A_NAME', value: 'a-value-long' }] }),
    );
    const seen: string[] = [];
    const res = await guardedFetch(fetch, (v) => seen.push(v))(ENV);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
    expect(await res.json()).toEqual({ envs: [{ key: 'A_NAME', value: 'a-value-long' }] });
    expect(seen).toEqual(expect.arrayContaining(['a-value-long']));
  });

  it('hands a body that is not JSON to onValue whole', async () => {
    const { fetch } = scriptedFetch(() => new Response('plain text body', { status: 500 }));
    const seen: string[] = [];
    const res = await guardedFetch(fetch, (v) => seen.push(v))('https://api.resend.com/domains');
    expect(res.status).toBe(500);
    expect(seen).toEqual(['plain text body']);
  });

  it('collects nested values, not keys', () => {
    expect(stringLeaves({ a: ['x', { b: 'y' }], c: 1 })).toEqual(['x', 'y']);
  });
});

describe('a token goes to its own host only', () => {
  it('ties every token the check reads to a route host', () => {
    expect(Object.keys(TOKEN_HOST).sort()).toEqual([...TOKEN_ENV].sort());
    for (const h of Object.values(TOKEN_HOST))
      expect(
        ROUTES.some((r) => r.host === h),
        h,
      ).toBe(true);
  });

  it('allows each token in an authorization header to its host', () => {
    expect(refusal(PROJECT, 'GET', bearer(tokens.VERCEL_TOKEN), tokens)).toBeNull();
    expect(refusal(READ_ONLY, 'POST', bearer(tokens.SUPABASE_ACCESS_TOKEN), tokens)).toBeNull();
    const fly = new Headers({ authorization: tokens.FLY_READ_TOKEN });
    expect(refusal(MACHINES, 'GET', fly, tokens)).toBeNull();
  });

  it.each([
    ['the Vercel token to Stripe', 'https://api.stripe.com/v1/prices', 'VERCEL_TOKEN'],
    ['the Stripe key to Vercel', PROJECT, 'STRIPE_LIVE_READ_KEY'],
    ['the Fly token to the worker', HEALTHZ, 'FLY_READ_TOKEN'],
    ['the Supabase token to Resend', 'https://api.resend.com/domains', 'SUPABASE_ACCESS_TOKEN'],
    ['the Resend key to Fly', MACHINES, 'RESEND_API_KEY'],
  ] as const)('refuses %s', (_label, url, name) => {
    expect(refusal(url, 'GET', bearer(tokens[name]), tokens)).not.toBeNull();
  });

  it('refuses a token in another header, or in the URL, to another host', () => {
    const h = new Headers({ 'x-extra': tokens.VERCEL_TOKEN });
    expect(refusal('https://api.resend.com/domains', 'GET', h, tokens)).not.toBeNull();
    const q = `https://api.stripe.com/v1/prices?limit=${tokens.RESEND_API_KEY}`;
    expect(refusal(q, 'GET', new Headers(), tokens)).not.toBeNull();
  });

  it('refuses an authorization header that is not its host token, or to a host with none', () => {
    expect(refusal(PROJECT, 'GET', bearer('something-else'), tokens)).not.toBeNull();
    expect(refusal(PROJECT, 'GET', bearer('x'), {})).not.toBeNull();
    expect(refusal(HEALTHZ, 'GET', bearer('x'), tokens)).not.toBeNull();
  });

  it('applies the binding in guardedFetch, before the inner fetch', async () => {
    const { fetch, calls } = scriptedFetch(() => json({}));
    const guarded = guardedFetch(fetch, () => {}, tokens);
    await expect(
      guarded('https://api.stripe.com/v1/prices', { headers: bearer(tokens.VERCEL_TOKEN) }),
    ).rejects.toBeInstanceOf(RefusedRequest);
    expect(calls).toEqual([]);
  });
});
