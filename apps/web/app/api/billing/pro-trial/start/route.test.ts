import { beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/billing/pro-trial/start (CC-26b D7). The session client, the stores, the dispatcher and
// the event sender are fakes; the door's `decideTrial` and the state machine run for real. The SQL
// it drives is lib/v2/account/pro-trial.test.ts's, on PGlite.

const ACCOUNT = '7d2f1c4a-9e3b-4b8a-8c1d-5e6f7a8b9c0d';

const h = vi.hoisted(() => {
  const log: string[] = [];
  const state = {
    user: { id: 'u1', email: 'owner@example.com' } as unknown,
    role: 'owner' as unknown,
    accountState: 'free',
    trialUsedAt: null as string | null,
    decision: { outcome: 'started' } as unknown,
    snapshot: null as unknown,
  };
  const reads = (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      is: () => q,
      maybeSingle: async () => {
        log.push(`session.from ${table}`);
        return table === 'accounts'
          ? {
              data: {
                state: state.accountState,
                tier: state.accountState === 'free' ? 'free' : 'pro',
                trial_variant: null,
                trial_ends_at: null,
                trial_used_at: state.trialUsedAt,
                past_due_tier: null,
                past_due_since: null,
                site_limit: 1,
                timezone: 'UTC',
              },
              error: null,
            }
          : { data: { id: 'seat-owner' }, error: null };
      },
    };
    return q;
  };
  const session = {
    auth: {
      getUser: async () => {
        log.push('getUser');
        return { data: { user: state.user }, error: null };
      },
    },
    from: reads,
    rpc: async (fn: string) => {
      log.push(`rpc ${fn}`);
      return { data: state.role, error: null };
    },
  };
  return {
    log,
    state,
    session,
    startTrial: vi.fn(),
    dispatch: vi.fn(async () => undefined),
    capture: vi.fn(async () => undefined),
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => h.session }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    return { tag: 'admin' };
  },
}));
vi.mock('@/lib/auth/stores', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/stores')>()),
  supabaseDoorStore: () => ({
    startTrial: async (...args: unknown[]) => {
      h.log.push('startTrial');
      h.startTrial(...args);
      return h.state.decision;
    },
  }),
}));
vi.mock('@/lib/billing/state-machine-apply', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/state-machine-apply')>()),
  supabaseEntitlementStore: () => ({
    load: async () => ({ snapshot: h.state.snapshot, version: 3 }),
  }),
}));
vi.mock('@/lib/billing/effect-sinks', () => ({ billingDispatcher: () => h.dispatch }));
vi.mock('@/lib/v2/account/events', () => ({ captureFor: () => h.capture }));

import { FREE_START } from '@/lib/billing/state-machine';
import { POST } from './route';

const SITE = 'https://crawlmouse.com';
const post = (body: string, type = 'application/x-www-form-urlencoded', cookie = '') =>
  POST(
    new Request(`${SITE}/api/billing/pro-trial/start`, {
      method: 'POST',
      headers: {
        origin: SITE,
        'content-type': type,
        'x-forwarded-for': '203.0.113.9',
        ...(cookie ? { cookie } : {}),
      },
      body,
    }),
  );
const form = `accountId=${ACCOUNT}`;
const asJson = () => post(JSON.stringify({ accountId: ACCOUNT }), 'application/json');

beforeEach(() => {
  h.log.length = 0;
  h.state.user = { id: 'u1', email: 'owner@example.com' };
  h.state.role = 'owner';
  h.state.accountState = 'free';
  h.state.trialUsedAt = null;
  h.state.decision = { outcome: 'started' };
  h.state.snapshot = FREE_START;
  h.startTrial.mockClear();
  h.dispatch.mockClear();
  h.capture.mockClear();
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('TRIAL_LEDGER_PEPPER', 'p'.repeat(40));
});

describe('the flag and the session', () => {
  it('is a 404 with V2_CHECKS_PUBLIC off, before anything else runs', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    const res = await post(form);
    expect(res.status).toBe(404);
    expect(h.log).toEqual([]);
  });

  it('answers 401 to a signed-out caller, before reading the body or the database', async () => {
    h.state.user = null;
    const res = await post(form);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'auth_required' });
    expect(h.log).toEqual(['getUser']);
  });
});

describe('membership', () => {
  it('a stranger (no seat on the account) gets a 404, and no service-role client is made', async () => {
    h.state.role = null;
    const res = await post(form);
    expect(res.status).toBe(404);
    expect(h.log).not.toContain('supabaseAdmin');
  });

  it('a malformed account id is the same 404, asked nothing', async () => {
    const res = await post('accountId=not-an-id');
    expect(res.status).toBe(404);
    expect(h.log).toEqual(['getUser']);
  });

  it.each(['developer', 'account_manager'])('a %s is refused: owners only', async (role) => {
    h.state.role = role;
    const res = await asJson();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: 'not_owner' });
    expect(h.log).not.toContain('supabaseAdmin');
    expect(h.startTrial).not.toHaveBeenCalled();
  });

  it('checks the role through the caller’s session before the service-role client', async () => {
    await post(form);
    expect(h.log.indexOf('rpc member_role')).toBeGreaterThan(h.log.indexOf('getUser'));
    expect(h.log.indexOf('supabaseAdmin')).toBeGreaterThan(h.log.indexOf('rpc member_role'));
  });
});

describe('the owner', () => {
  it('starts the trial: a form goes to the dashboard, the dispatcher and the event once each', async () => {
    const res = await post(form, undefined, 'cm_auth_device=dev-123');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/dashboard');
    expect(h.startTrial).toHaveBeenCalledTimes(1);
    const [accountId, hashes, transition] = h.startTrial.mock.calls[0]!;
    expect(accountId).toBe(ACCOUNT);
    expect((hashes as { kind: string }[]).map((x) => x.kind)).toEqual(['email', 'device', 'ip24']);
    expect(transition).toMatchObject({ event: 'trial_started' });
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.capture).toHaveBeenCalledTimes(1);
    expect(h.capture).toHaveBeenCalledWith('trial_started', ACCOUNT, {
      kind: 'pro',
      variant: 'no_card',
    });
  });

  it('a JSON request gets the dashboard’s url', async () => {
    const res = await post(JSON.stringify({ accountId: ACCOUNT }), 'application/json');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: '/dashboard' });
  });

  it('with no device cookie the ledger is asked with the email and network only', async () => {
    await post(form);
    const hashes = h.startTrial.mock.calls[0]![1] as { kind: string }[];
    expect(hashes.map((x) => x.kind)).toEqual(['email', 'ip24']);
  });

  it('an account that already had its trial is not eligible: 409, nothing applied or sent', async () => {
    h.state.trialUsedAt = '2026-10-01T00:00:00.000Z';
    const res = await asJson();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'not_eligible' });
    expect(h.startTrial).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('the ledger’s refusal is a 409 refused, with nothing dispatched or sent', async () => {
    h.state.decision = { outcome: 'refused', hits: ['device'] };
    const res = await asJson();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'refused' });
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('without the ledger pepper nothing is asked: 503', async () => {
    vi.stubEnv('TRIAL_LEDGER_PEPPER', '');
    const res = await asJson();
    expect(res.status).toBe(503);
    expect(h.startTrial).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('a refused form goes back to the dashboard with its notice, naming nothing it was sent', async () => {
    h.state.trialUsedAt = '2026-10-01T00:00:00.000Z';
    const res = await post(form);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/dashboard?notice=not_eligible');
  });

  it('a body that is neither a form nor JSON is a 400', async () => {
    const res = await post(form, 'text/plain');
    expect(res.status).toBe(400);
  });
});
