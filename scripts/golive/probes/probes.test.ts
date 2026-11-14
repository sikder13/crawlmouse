import { describe, expect, it } from 'vitest';
import { PRODUCTION_REF } from '../../db/target';
import { REQUIRED_ENV } from '../env-classes';
import { refusal } from '../http';
import { deps, fakeToken, json, scriptedFetch } from '../test-support';
import { PAID_PLAN_TICK, inngestBudgetProbe } from './inngest';
import { migrationsProbe } from './migrations';
import { SENDING_DOMAIN, resendProbe } from './resend';
import { VERCEL_PROJECT_ID, VERCEL_TEAM_ID, vercelEnvProbe } from './vercel-env';
import { WORKER_URL, healthzProbe, releaseProbe, workerInputPaths } from './worker';

const vercelToken = fakeToken(['vcp', 'test']);
const LIVE_AT = Date.UTC(2026, 10, 12);

function vercel(envs: unknown[], production: unknown = { createdAt: LIVE_AT }) {
  return scriptedFetch((url) => {
    if (url.pathname === `/v10/projects/${VERCEL_PROJECT_ID}/env`) return json({ envs });
    if (url.pathname === `/v9/projects/${VERCEL_PROJECT_ID}`)
      return json({ targets: { production } });
    return json({}, 404);
  });
}
const entry = (key: string, over: Record<string, unknown> = {}) => ({
  key,
  target: ['production', 'preview'],
  updatedAt: LIVE_AT - 1000,
  value: 'plain-value-of-' + key,
  ...over,
});
const allOf = (step: 1 | 2 | 3 | 4 | 5) => Object.keys(REQUIRED_ENV[step]).map((k) => entry(k));

describe('vercel-env', () => {
  it('answers unknown without a token, and sends nothing', async () => {
    const { fetch, calls } = vercel([]);
    const r = await vercelEnvProbe(1)(deps({ fetch }));
    expect(r).toEqual({ status: 'unknown', reason: 'set VERCEL_TOKEN in scripts/.env.local' });
    expect(calls).toEqual([]);
  });

  it('passes when every required name targets Production and predates the live deployment', async () => {
    const { fetch, calls } = vercel(allOf(1));
    const r = await vercelEnvProbe(1)(deps({ fetch, env: { VERCEL_TOKEN: vercelToken } }));
    expect(r.status).toBe('pass');
    for (const c of calls) {
      expect(c.method).toBe('GET');
      expect(refusal(c.url, c.method)).toBeNull();
      expect(new URL(c.url).searchParams.get('teamId')).toBe(VERCEL_TEAM_ID);
      expect(c.headers.authorization).toBe(`Bearer ${vercelToken}`);
    }
  });

  it('names a missing name, and does not count one set only for Preview or one branch', async () => {
    const rows = allOf(4).filter((e) => e.key !== 'EMAIL_LINK_SECRET');
    rows.push(entry('EMAIL_LINK_SECRET', { target: ['preview'] }));
    rows.push(entry('EMAIL_LINK_SECRET', { gitBranch: 'some-branch' }));
    const { fetch } = vercel(rows);
    const r = await vercelEnvProbe(4)(deps({ fetch, env: { VERCEL_TOKEN: vercelToken } }));
    expect(r).toEqual({ status: 'fail', reason: 'not set for Production: EMAIL_LINK_SECRET' });
  });

  it('accepts a target given as a string', async () => {
    const { fetch } = vercel(allOf(3).map((e) => ({ ...e, target: 'production' })));
    expect(
      (await vercelEnvProbe(3)(deps({ fetch, env: { VERCEL_TOKEN: vercelToken } }))).status,
    ).toBe('pass');
  });

  it('fails a name updated after the live deployment: redeploy', async () => {
    const rows = allOf(5).map((e) =>
      e.key === 'STRIPE_ACCOUNT_LIVEMODE' ? { ...e, updatedAt: LIVE_AT + 1 } : e,
    );
    const { fetch } = vercel(rows);
    const r = await vercelEnvProbe(5)(deps({ fetch, env: { VERCEL_TOKEN: vercelToken } }));
    expect(r).toEqual({
      status: 'fail',
      reason: 'set after the live deployment: redeploy (STRIPE_ACCOUNT_LIVEMODE)',
    });
  });

  it('answers unknown when the live deployment has no creation time', async () => {
    const { fetch } = vercel(allOf(4), null);
    expect(
      (await vercelEnvProbe(4)(deps({ fetch, env: { VERCEL_TOKEN: vercelToken } }))).status,
    ).toBe('unknown');
  });

  it('fails step 1 when INNGEST_DEV is set for Production', async () => {
    const { fetch } = vercel([...allOf(1), entry('INNGEST_DEV')]);
    const r = await vercelEnvProbe(1)(deps({ fetch, env: { VERCEL_TOKEN: vercelToken } }));
    expect(r).toEqual({ status: 'fail', reason: 'must not be set for Production: INNGEST_DEV' });
  });

  it('answers unknown on an HTTP error, naming only the status', async () => {
    const { fetch } = scriptedFetch(() =>
      json({ error: { message: 'a body that must not be printed' } }, 403),
    );
    const r = await vercelEnvProbe(1)(deps({ fetch, env: { VERCEL_TOKEN: vercelToken } }));
    expect(r).toEqual({ status: 'unknown', reason: 'Vercel env list answered HTTP 403' });
  });

  it('answers unknown for a required name with no update or creation time', async () => {
    const rows = allOf(4).map((e) => {
      if (e.key !== 'EMAIL_LINK_SECRET') return e;
      const { updatedAt: _u, ...rest } = e;
      return rest;
    });
    const r = await vercelEnvProbe(4)(
      deps({ fetch: vercel(rows).fetch, env: { VERCEL_TOKEN: vercelToken } }),
    );
    expect(r).toEqual({
      status: 'unknown',
      reason: 'no update time given for: EMAIL_LINK_SECRET',
    });
  });

  it('dates a name by createdAt when updatedAt is missing', async () => {
    const dated = (at: number) =>
      allOf(4).map((e) => {
        const { updatedAt: _u, ...rest } = e;
        return { ...rest, createdAt: at };
      });
    const env = { VERCEL_TOKEN: vercelToken };
    const before = await vercelEnvProbe(4)(deps({ fetch: vercel(dated(LIVE_AT - 1)).fetch, env }));
    expect(before.status).toBe('pass');
    const after = await vercelEnvProbe(4)(deps({ fetch: vercel(dated(LIVE_AT + 1)).fetch, env }));
    expect(after.status).toBe('fail');
  });

  it('answers unknown, never pass, when the listing has another page', async () => {
    for (const s of [1, 3, 4, 5] as const) {
      const { fetch } = scriptedFetch((url) =>
        url.pathname.endsWith('/env')
          ? json({
              envs: [...allOf(1), ...allOf(3), ...allOf(4), ...allOf(5)],
              pagination: { next: 1700000000000 },
            })
          : json({ targets: { production: { createdAt: LIVE_AT } } }),
      );
      const r = await vercelEnvProbe(s)(deps({ fetch, env: { VERCEL_TOKEN: vercelToken } }));
      expect(r, `step ${s}`).toEqual({
        status: 'unknown',
        reason: 'the Vercel env list has another page, which the check does not read',
      });
    }
    const { fetch } = scriptedFetch((url) =>
      url.pathname.endsWith('/env')
        ? json({ envs: allOf(1), pagination: { next: null } })
        : json({ targets: { production: { createdAt: LIVE_AT } } }),
    );
    expect(
      (await vercelEnvProbe(1)(deps({ fetch, env: { VERCEL_TOKEN: vercelToken } }))).status,
    ).toBe('pass');
  });

  it('lists once for all five step rows', async () => {
    const { fetch, calls } = vercel([...allOf(1), ...allOf(3), ...allOf(4), ...allOf(5)]);
    const d = deps({ fetch, env: { VERCEL_TOKEN: vercelToken } });
    for (const s of [1, 2, 3, 4, 5] as const)
      expect((await vercelEnvProbe(s)(d)).status).toBe('pass');
    expect(calls).toHaveLength(2);
  });
});

describe('targets are code constants, not the environment (plan review B4)', () => {
  it('reads production Supabase, the production worker and the fixed Vercel project whatever the env names', async () => {
    const planted = {
      CRAWL_WORKER_URL: 'https://crawlmouse-worker-staging.fly.dev',
      SUPABASE_PROJECT_REF: 'zzzzzzzzzzzzzzzzzzzz',
      NEXT_PUBLIC_SUPABASE_URL: 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co',
      VERCEL_PROJECT_ID: 'prj_other',
      FLY_APP: 'crawlmouse-worker-staging',
      VERCEL_TOKEN: vercelToken,
      SUPABASE_ACCESS_TOKEN: fakeToken(['sbp', 'test']),
      FLY_READ_TOKEN: fakeToken(['fo1']),
    };
    const { fetch, calls } = scriptedFetch(() => json([], 500));
    const d = deps({ fetch, env: planted });
    await vercelEnvProbe(1)(d);
    await migrationsProbe()(d);
    await healthzProbe(d);
    await releaseProbe(() => ['packages/**'])(d);
    const urls = calls.map((c) => c.url);
    expect(urls).toEqual([
      `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env?teamId=${VERCEL_TEAM_ID}`,
      `https://api.supabase.com/v1/projects/${PRODUCTION_REF}/database/query/read-only`,
      `${WORKER_URL}/healthz`,
      'https://api.machines.dev/v1/apps/crawlmouse-worker/machines',
    ]);
    expect(urls.join(' ')).not.toMatch(/staging|zzzz|prj_other/);
  });
});

describe('worker', () => {
  it('passes /healthz on 200 {"ok":true} only', async () => {
    const answer = (body: unknown, status = 200) => scriptedFetch(() => json(body, status)).fetch;
    expect((await healthzProbe(deps({ fetch: answer({ ok: true }) }))).status).toBe('pass');
    expect((await healthzProbe(deps({ fetch: answer({ ok: false }) }))).status).toBe('fail');
    expect((await healthzProbe(deps({ fetch: answer({ ok: true }, 503) }))).status).toBe('fail');
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    expect((await healthzProbe(deps({ fetch: down }))).status).toBe('fail');
  });

  it('sends a FlyV1 token as given and any other token as a Bearer token', async () => {
    const flyV1 = ['FlyV1', fakeToken(['fm2'])].join(' ');
    const plain = fakeToken(['fo1']);
    for (const [t, header] of [
      [flyV1, flyV1],
      [plain, `Bearer ${plain}`],
    ] as const) {
      const { fetch, calls } = scriptedFetch(() => json([]));
      await releaseProbe(() => [])(deps({ fetch, env: { FLY_READ_TOKEN: t } }));
      expect(calls[0]!.headers.authorization).toBe(header);
    }
  });
  it("takes the paths from worker-staging.yml's push trigger", () => {
    expect(workerInputPaths()).toContain('packages/**');
    expect(workerInputPaths()).toContain('pnpm-lock.yaml');
  });
});

describe('resend', () => {
  const key = { RESEND_API_KEY: fakeToken(['re', 'test']) };
  const domains = (data: unknown[]) => scriptedFetch(() => json({ data })).fetch;
  it('passes only a verified crawlmouse.com', async () => {
    expect(
      (
        await resendProbe(
          deps({ env: key, fetch: domains([{ name: SENDING_DOMAIN, status: 'verified' }]) }),
        )
      ).status,
    ).toBe('pass');
    expect(
      (
        await resendProbe(
          deps({ env: key, fetch: domains([{ name: SENDING_DOMAIN, status: 'pending' }]) }),
        )
      ).status,
    ).toBe('fail');
    expect(
      (
        await resendProbe(
          deps({ env: key, fetch: domains([{ name: 'other.example', status: 'verified' }]) }),
        )
      ).status,
    ).toBe('fail');
  });
  it('answers unknown without a key', async () => {
    expect((await resendProbe(deps())).status).toBe('unknown');
  });
});

describe('inngest budget', () => {
  it('fails on Hobby at the D2 figures, and passes once the paid plan is ticked', async () => {
    const r = await inngestBudgetProbe(deps());
    expect(r.status).toBe('fail');
    expect(r.reason).toMatch(/40,000 line \(docs\/ops\/inngest-budget\.md\)/);
    expect((await inngestBudgetProbe(deps({ ticked: new Set([PAID_PLAN_TICK]) }))).status).toBe(
      'pass',
    );
  });
});
