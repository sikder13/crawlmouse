import { describe, expect, it } from 'vitest';
import { ALLOWED_HOSTS, RefusedRequest, guardedFetch, refusal, stringLeaves } from './http';
import { json, scriptedFetch } from './test-support';

describe('the outbound allow-list', () => {
  it.each([
    ['another host', 'https://example.com/x', 'GET'],
    ['a host that ends like an allowed one', 'https://evil-api.vercel.com/v10/projects', 'GET'],
    ['a subdomain of an allowed one', 'https://x.api.stripe.com/v1/prices', 'GET'],
    ['plain http', 'http://api.vercel.com/v10/projects/p/env', 'GET'],
    ['a non-default port', 'https://api.vercel.com:8443/v10/projects/p/env', 'GET'],
    ['credentials in the URL', 'https://u:p@api.vercel.com/v10/projects', 'GET'],
    ['a decrypt query', 'https://api.vercel.com/v10/projects/p/env?decrypt=true', 'GET'],
    ['a decrypt path', 'https://api.vercel.com/v1/projects/p/env/e/decrypt', 'GET'],
    ['a POST to Vercel', 'https://api.vercel.com/v10/projects/p/env', 'POST'],
    ['a DELETE to Fly', 'https://api.machines.dev/v1/apps/crawlmouse-worker/machines', 'DELETE'],
    ['a POST to Stripe', 'https://api.stripe.com/v1/prices', 'POST'],
    [
      'a POST to another Supabase path',
      'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query',
      'POST',
    ],
    ['a relative URL', '/v1/prices', 'GET'],
  ])('refuses %s', (_label, url, method) => {
    expect(refusal(url, method)).not.toBeNull();
  });

  it.each([['a GET to each allowed host', ALLOWED_HOSTS.map((h) => `https://${h}/x`)]])(
    'allows %s',
    (_label, urls) => {
      for (const u of urls) expect(refusal(u, 'GET'), u).toBeNull();
    },
  );

  it("allows Supabase's read-only query POST, and only on a project ref", () => {
    expect(
      refusal(
        'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query/read-only',
        'POST',
      ),
    ).toBeNull();
    expect(
      refusal('https://api.supabase.com/v1/projects/x/database/query/read-only', 'POST'),
    ).not.toBeNull();
  });

  it('throws before the inner fetch is called', async () => {
    const { fetch, calls } = scriptedFetch(() => json({}));
    const guarded = guardedFetch(fetch, () => {});
    await expect(guarded('https://example.com/', { method: 'GET' })).rejects.toBeInstanceOf(
      RefusedRequest,
    );
    await expect(guarded('https://api.vercel.com/x', { method: 'PATCH' })).rejects.toBeInstanceOf(
      RefusedRequest,
    );
    expect(calls).toEqual([]);
  });

  it('passes an allowed request through and hands every response string to onValue', async () => {
    const { fetch, calls } = scriptedFetch(() =>
      json({ envs: [{ key: 'A_NAME', value: 'a-value-long' }] }),
    );
    const seen: string[] = [];
    const res = await guardedFetch(fetch, (v) => seen.push(v))(
      'https://api.vercel.com/v10/projects/p/env',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
    expect(await res.json()).toEqual({ envs: [{ key: 'A_NAME', value: 'a-value-long' }] });
    expect(seen).toEqual(expect.arrayContaining(['A_NAME', 'a-value-long']));
  });

  it('hands a body that is not JSON to onValue whole', async () => {
    const { fetch } = scriptedFetch(() => new Response('plain text body', { status: 500 }));
    const seen: string[] = [];
    const res = await guardedFetch(fetch, (v) => seen.push(v))('https://api.resend.com/domains');
    expect(res.status).toBe(500);
    expect(seen).toEqual(['plain text body']);
  });

  it('collects nested leaves and keys', () => {
    expect(stringLeaves({ a: ['x', { b: 'y' }], c: 1 })).toEqual(['a', 'x', 'b', 'y', 'c']);
  });
});
