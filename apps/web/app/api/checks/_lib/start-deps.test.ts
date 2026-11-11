/**
 * `startDeps` executed: what POST /api/checks runs a start on in production. Replaced at the module
 * boundary: the engine's URL guard, Turnstile's verifier, the limiter's database call, the
 * service-role client and Inngest. `admitSiteHost` and `startLimits` are the real modules.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  guarded: [] as string[],
  guardRefuses: false,
  turnstile: [] as unknown[][],
  limited: [] as unknown[][],
  sent: [] as unknown[],
  admin: { rpc: () => undefined, from: () => undefined },
  stores: [] as [string, unknown][],
}));

vi.mock('server-only', () => ({}));
vi.mock('@crawlmouse/engine', () => ({
  validateUrlOrThrow: async (url: string) => {
    h.guarded.push(url);
    if (h.guardRefuses) throw new Error('resolves to a private address');
  },
}));
vi.mock('../../../../lib/turnstile', () => ({
  verifyTurnstileToken: async (...args: unknown[]) => {
    h.turnstile.push(args);
    return args[0] === 'good';
  },
}));
vi.mock('../../../../lib/rate-limit', () => ({
  checkRateLimit: async (...args: unknown[]) => {
    h.limited.push(args);
    return { allowed: args[0] !== 'domain:refused.example', remaining: 0, resetAt: new Date(7) };
  },
}));
vi.mock('../../../../lib/supabase/admin', () => ({ supabaseAdmin: () => h.admin }));
vi.mock('../../../../lib/inngest', () => ({
  inngest: { send: async (event: unknown) => void h.sent.push(event) },
}));
vi.mock('../../../../lib/v2/pipeline/store', () => ({
  supabasePipelineStore: (client: unknown) => {
    h.stores.push(['pipeline', client]);
    return { name: 'pipeline-store' };
  },
}));
vi.mock('./start-store', () => ({
  supabaseStartStore: (client: unknown) => {
    h.stores.push(['start', client]);
    return { name: 'start-store' };
  },
}));

import { startDeps } from './start-deps';
import { startLimits } from './start-limits';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const signedIn = async () => true;

beforeEach(() => {
  h.guarded.length = 0;
  h.guardRefuses = false;
  h.turnstile.length = 0;
  h.limited.length = 0;
  h.sent.length = 0;
  h.stores.length = 0;
});

describe('startDeps', () => {
  it('`admit` is admitSiteHost over the engine’s guard: https://{host}/, false when the guard throws', async () => {
    const deps = startDeps(signedIn);
    expect(await deps.admit('example.com')).toBe(true);
    h.guardRefuses = true;
    expect(await deps.admit('intranet.example')).toBe(false);
    expect(h.guarded).toEqual(['https://example.com/', 'https://intranet.example/']);
  });

  it('`verifyTurnstile` is Turnstile’s verifier, with the token and the address', async () => {
    const deps = startDeps(signedIn);
    expect(await deps.verifyTurnstile('good', '203.0.113.7')).toBe(true);
    expect(await deps.verifyTurnstile('bad', '203.0.113.7')).toBe(false);
    expect(h.turnstile).toEqual([
      ['good', '203.0.113.7'],
      ['bad', '203.0.113.7'],
    ]);
  });

  it('both stores are built on the service-role client, and the session test is the caller’s', () => {
    const deps = startDeps(signedIn);
    expect(h.stores).toEqual([
      ['start', h.admin],
      ['pipeline', h.admin],
    ]);
    expect(deps.store).toEqual({ name: 'start-store' });
    expect(deps.pipeline.store).toEqual({ name: 'pipeline-store' });
    expect(deps.signedIn).toBe(signedIn);
  });

  it('the pipeline’s events go to Inngest, and its clock is the system’s', async () => {
    const deps = startDeps(signedIn);
    const event = { id: 'check:anon:c', name: 'check.requested', data: {} };
    await deps.pipeline.send(event as Parameters<typeof deps.pipeline.send>[0]);
    expect(h.sent).toEqual([event]);
    expect(Math.abs(deps.pipeline.now() - Date.now())).toBeLessThan(1000);
  });

  it('`limits` is startLimits, and each calls checkRateLimit with its key, number and window', async () => {
    const { limits } = startDeps(signedIn);
    expect(limits).toBe(startLimits);
    expect(await limits.global()).toBe(true);
    expect(await limits.ip('203.0.113.7', false)).toEqual({ allowed: true, resetAt: new Date(7) });
    await limits.ip('203.0.113.7', true);
    expect(await limits.domain('example.com')).toBe(true);
    expect(await limits.domain('refused.example')).toBe(false);
    expect(await limits.replay('203.0.113.7')).toBe(true);
    // The day's ceiling is the one call with `failClosed`; the others fail open.
    expect(h.limited).toEqual([
      ['global:audits:day', 5000, DAY_MS, { failClosed: true }],
      ['ip:203.0.113.7', 20, DAY_MS],
      ['ip:203.0.113.7', 40, DAY_MS],
      ['domain:example.com', 5, HOUR_MS],
      ['domain:refused.example', 5, HOUR_MS],
      ['start-replay:ip:203.0.113.7', 30, HOUR_MS],
    ]);
  });
});
