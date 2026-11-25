import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  UNCONFIGURED,
  vercelConfigured,
  vercelDomains,
  vercelDomainsFromEnv,
  VERCEL_PROJECT_ID,
  VERCEL_TEAM_ID,
} from './vercel-domains';

const HOST = 'reports.agency-example.com';
const TOKEN = 'test-token-value';

function recorder(answer: (url: string, init: RequestInit) => [number, unknown]) {
  const calls: { method: string; url: URL; auth: string | null; body: unknown }[] = [];
  const fetchImpl = async (input: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    calls.push({
      method: init.method ?? 'GET',
      url: new URL(input),
      auth: headers.get('authorization'),
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const [status, json] = answer(input, init);
    return new Response(json === undefined ? '' : JSON.stringify(json), { status });
  };
  return { calls, fetchImpl };
}

describe('the Vercel domain port (row 25)', () => {
  it('refuses every call with no token, and sends nothing', async () => {
    const fetchImpl = vi.fn();
    for (const env of [{}, { VERCEL_DOMAINS_TOKEN: '' }, { VERCEL_DOMAINS_TOKEN: '   ' }]) {
      expect(vercelConfigured(env)).toBe(false);
      const port = vercelDomainsFromEnv(env, fetchImpl);
      expect(port).toBe(UNCONFIGURED);
      for (const r of await Promise.all([
        port.add(HOST),
        port.get(HOST),
        port.verify(HOST),
        port.config(HOST),
        port.remove(HOST),
      ])) {
        expect(r).toEqual({ ok: false, failure: 'not_configured' });
      }
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('calls the documented endpoints, on the project and team, with the bearer token', async () => {
    const { calls, fetchImpl } = recorder((url) =>
      url.includes('/config')
        ? [
            200,
            {
              misconfigured: false,
              recommendedCNAME: [
                { rank: 2, value: 'b.' },
                { rank: 1, value: 'a.vercel-dns-017.com.' },
              ],
            },
          ]
        : [200, { name: HOST, verified: true, verification: [] }],
    );
    const port = vercelDomains(TOKEN, fetchImpl);
    await port.add(HOST);
    await port.get(HOST);
    await port.verify(HOST);
    expect(await port.config(HOST)).toEqual({
      ok: true,
      value: { configured: true, cname: 'a.vercel-dns-017.com' },
    });
    await port.remove(HOST);
    const project = `/projects/${VERCEL_PROJECT_ID}/domains`;
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      `POST /v10${project}`,
      `GET /v9${project}/${HOST}`,
      `POST /v9${project}/${HOST}/verify`,
      `GET /v6/domains/${HOST}/config`,
      `DELETE /v9${project}/${HOST}`,
    ]);
    for (const c of calls) {
      expect(c.url.origin).toBe('https://api.vercel.com');
      expect(c.url.searchParams.get('teamId')).toBe(VERCEL_TEAM_ID);
      expect(c.auth).toBe(`Bearer ${TOKEN}`);
    }
    expect(calls[0]!.body).toEqual({ name: HOST });
    expect(calls[3]!.url.searchParams.get('projectIdOrName')).toBe(VERCEL_PROJECT_ID);
  });

  it('reads Vercel’s challenge when it has not verified the host', async () => {
    const { fetchImpl } = recorder(() => [
      200,
      {
        verified: false,
        verification: [
          { type: 'TXT', domain: '_vercel.agency-example.com', value: 'vc=1', reason: 'pending' },
          { type: 'TXT', domain: 7 },
        ],
      },
    ]);
    expect(await vercelDomains(TOKEN, fetchImpl).add(HOST)).toEqual({
      ok: true,
      value: {
        verified: false,
        challenges: [{ type: 'TXT', domain: '_vercel.agency-example.com', value: 'vc=1' }],
      },
    });
  });

  it('names the failures: 409 in use, 404, 429, anything else, and a network error', async () => {
    for (const [status, failure] of [
      [409, 'in_use'],
      [404, 'not_found'],
      [429, 'rate_limited'],
      [500, 'failed'],
      [403, 'failed'],
    ] as const) {
      const { fetchImpl } = recorder(() => [status, { error: { code: 'x' } }]);
      expect(await vercelDomains(TOKEN, fetchImpl).add(HOST)).toEqual({ ok: false, failure });
    }
    const thrown = vercelDomains(TOKEN, async () => {
      throw new Error('ECONNRESET');
    });
    expect(await thrown.get(HOST)).toEqual({ ok: false, failure: 'failed' });
    const { fetchImpl } = recorder(() => [200, { unexpected: true }]);
    expect(await vercelDomains(TOKEN, fetchImpl).get(HOST)).toEqual({
      ok: false,
      failure: 'failed',
    });
  });

  it('counts a host the project does not hold as removed', async () => {
    const { fetchImpl } = recorder(() => [404, undefined]);
    expect(await vercelDomains(TOKEN, fetchImpl).remove(HOST)).toEqual({ ok: true, value: null });
  });

  it('never puts the token in an answer', async () => {
    const { fetchImpl } = recorder(() => [500, { echoed: TOKEN }]);
    const port = vercelDomains(TOKEN, fetchImpl);
    const answers = await Promise.all([port.add(HOST), port.config(HOST), port.remove(HOST)]);
    expect(JSON.stringify(answers)).not.toContain(TOKEN);
  });
});
