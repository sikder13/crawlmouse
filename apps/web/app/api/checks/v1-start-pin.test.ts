import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/audits/start does not read V2_CHECKS_PUBLIC or V2_PIPELINE (CC-22b D1): for each request
// below, its status, its body and the calls it makes are the same with the flags unset and set. The
// first scenario is also pinned to what main's route does, so "the same" is not "the same nothing".

const calls = vi.hoisted(() => [] as string[]);
const state = vi.hoisted(() => ({ guard: null as string | null, allowed: true }));
const recorder = vi.hoisted(() => (name: string): unknown => {
  const chain: unknown = new Proxy(() => undefined, {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve({ data: { id: 'audit-1' }, error: null });
      }
      return (...args: unknown[]) => {
        calls.push(`${name}.${String(prop)}(${JSON.stringify(args)})`);
        return chain;
      };
    },
  });
  return chain;
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (...args: unknown[]) => {
    calls.push(`rateLimit(${JSON.stringify(args)})`);
    return { allowed: state.allowed, resetAt: new Date(0) };
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => recorder('admin') }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock('@/lib/inngest', () => ({ inngest: recorder('inngest') }));
vi.mock('@/lib/anon-session', () => ({ getOrCreateAnonSessionId: async () => 'anon-1' }));
vi.mock('@crawlmouse/engine', () => ({
  validateUrlOrThrow: async () => {
    if (state.guard) throw new Error(state.guard);
  },
}));

import { POST } from '../audits/start/route';

const NOW = new Date('2026-11-10T12:00:00.000Z');

async function run(body: unknown) {
  calls.length = 0;
  const res = await POST(
    new Request('https://crawlmouse.com/api/audits/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.text(), calls: [...calls] };
}

const SCENARIOS: Array<[string, () => void, unknown]> = [
  ['a start', () => {}, { url: 'https://example.com' }],
  ['a body that does not parse', () => {}, { url: 'not a url' }],
  ['a URL the guard refuses', () => (state.guard = 'private address'), { url: 'http://10.0.0.1' }],
  ['a spent bucket', () => (state.allowed = false), { url: 'https://example.com' }],
  ['a pause', () => vi.stubEnv('CRAWL_PAUSED', '1'), { url: 'https://example.com' }],
];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  state.guard = null;
  state.allowed = true;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('POST /api/audits/start with the v2 flags unset and set', () => {
  it.each(SCENARIOS)('%s is answered the same way', async (_, arrange, body) => {
    arrange();
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    vi.stubEnv('V2_PIPELINE', '');
    const off = await run(body);
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    vi.stubEnv('V2_PIPELINE', '1');
    const on = await run(body);
    expect(on).toEqual(off);
  });

  it('a start, with the flags set, is main’s: its answer, its three buckets, its row, its event', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '1');
    vi.stubEnv('V2_PIPELINE', '1');
    const { status, body, calls: made } = await run({ url: 'https://example.com' });
    expect({ status, body }).toEqual({ status: 200, body: '{"auditId":"audit-1"}' });
    expect(made).toEqual([
      'rateLimit(["global:audits:day",5000,86400000,{"failClosed":true}])',
      'rateLimit(["ip:203.0.113.9",20,86400000])',
      'rateLimit(["domain:example.com",5,3600000])',
      'admin.from(["audits"])',
      'admin.insert([{"user_id":null,"anonymous_session_id":"anon-1","url":"https://example.com","status":"pending","settings":{"pageCap":500},"expires_at":"2026-12-10T12:00:00.000Z"}])',
      'admin.select(["id"])',
      'admin.single([])',
      'inngest.send([{"name":"audit.requested","data":{"auditId":"audit-1","url":"https://example.com","pageCap":500,"perHostConcurrency":1}}])',
    ]);
  });
});
