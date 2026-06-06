import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `rate-limit.ts` is a server-only module that talks to the atomic increment RPC. Two collaborators
// must be stubbed for it to load + be driven deterministically under Vitest:
//  - `server-only` is a Next-bundled marker package with no resolvable entry outside the Next
//    build, so a bare `import 'server-only'` throws here unless it's stubbed to a no-op module.
//  - `@/lib/supabase/admin` pulls in the real Supabase client (and its own `server-only`); we
//    replace `supabaseAdmin()` with a hoisted fake whose single `rpc` mock lets each test decide
//    whether the increment RPC succeeds (returns a count) or errors (the fail-open/closed fork).
vi.mock('server-only', () => ({}));
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc }) }));

import { checkRateLimit } from './rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    rpc.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows when the RPC reports a count at or below the limit', async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    const res = await checkRateLimit('bucket', 5, 60_000);
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(2);
  });

  it('denies when the RPC reports a count above the limit', async () => {
    rpc.mockResolvedValue({ data: 6, error: null });
    const res = await checkRateLimit('bucket', 5, 60_000);
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
  });

  it('fails OPEN by default (no opts) on an RPC error — a transient blip must not block traffic', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
    const res = await checkRateLimit('ip:203.0.113.7', 5, 60_000);
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(5);
  });

  it('fails CLOSED on an RPC error when { failClosed: true } — the global cost ceiling must never uncap', async () => {
    // The 18%-MRR global backstop is the ONE bucket where an RPC blip must NOT silently disable
    // the limit: a fail-open there would uncap platform-wide spend during a Supabase outage.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
    const res = await checkRateLimit('global:audits:day', 5000, 86_400_000, { failClosed: true });
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
    expect(err).toHaveBeenCalled(); // the closed-fail is logged loudly, not swallowed
  });

  it('fails OPEN on an RPC error when { failClosed: false } is passed explicitly', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
    const res = await checkRateLimit('domain:example.com', 1, 3_600_000, { failClosed: false });
    expect(res.allowed).toBe(true);
  });
});
