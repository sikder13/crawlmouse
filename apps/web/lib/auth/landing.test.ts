import { beforeEach, describe, expect, it, vi } from 'vitest';

const runFirstLogin = vi.fn();
const claimCheck = vi.fn();
vi.mock('./first-login', () => ({ runFirstLogin: (...a: unknown[]) => runFirstLogin(...a) }));
vi.mock('./claim', () => ({ claimCheck: (...a: unknown[]) => claimCheck(...a) }));

import { afterSignIn } from './landing';
import { claimFromNext, claimNext, decodeOtp, decodeSignup } from './continue-intent';

const CHECK = '0b8c6f8e-3c55-4d1b-9a7a-2f0c4f9d6c11';
const user = {
  id: 'u1',
  email: 'ada@example.com',
  email_confirmed_at: '2026-11-05T12:00:00Z',
  last_sign_in_at: '2026-11-05T12:00:01Z',
};
const report = vi.fn();
const deps = { firstLogin: {} as never, claim: {} as never, report };
const base = { user, next: undefined, signup: null, device: 'd', ip: '203.0.113.1' };

beforeEach(() => {
  runFirstLogin.mockReset().mockResolvedValue({ trial: 'started', siteId: null, events: [] });
  claimCheck.mockReset().mockResolvedValue({ ok: true, siteId: 's' });
  report.mockReset();
});

describe('afterSignIn', () => {
  it('runs the first-login hook with the verified user and the carried values', async () => {
    await afterSignIn(deps, { ...base, signup: { site: 'acme.com' } });
    expect(runFirstLogin).toHaveBeenCalledWith(deps.firstLogin, {
      userId: 'u1',
      email: 'ada@example.com',
      emailConfirmedAt: user.email_confirmed_at,
      lastSignInAt: user.last_sign_in_at,
      device: 'd',
      ip: '203.0.113.1',
      signup: { site: 'acme.com' },
    });
  });

  it('leaves the destination to the v1 rule when the link was not a Keep', async () => {
    expect(await afterSignIn(deps, { ...base, next: '/r/abc' })).toEqual({
      dest: null,
      events: [],
    });
    expect(claimCheck).not.toHaveBeenCalled();
  });

  it('claims the check a Keep named, after the hook, and lands on the dashboard', async () => {
    const order: string[] = [];
    runFirstLogin.mockImplementation(async () => {
      order.push('hook');
      return { trial: 'started', siteId: null, events: [] };
    });
    claimCheck.mockImplementation(async () => {
      order.push('claim');
      return { ok: true, siteId: 's' };
    });
    const r = await afterSignIn(deps, { ...base, next: claimNext(CHECK) });
    expect(claimCheck).toHaveBeenCalledWith(deps.claim, { checkId: CHECK, userId: 'u1' });
    expect(order).toEqual(['hook', 'claim']);
    expect(r.dest).toBe('/dashboard');
  });

  it('a refused claim lands on the dashboard with its code', async () => {
    claimCheck.mockResolvedValue({ ok: false, status: 409, code: 'site_limit' });
    expect((await afterSignIn(deps, { ...base, next: claimNext(CHECK) })).dest).toBe(
      '/dashboard?claim=site_limit',
    );
  });

  it('a hook or claim that throws is reported with ids only and never fails the sign-in', async () => {
    runFirstLogin.mockRejectedValue(new Error('db'));
    claimCheck.mockRejectedValue(new Error('db'));
    const r = await afterSignIn(deps, { ...base, next: claimNext(CHECK) });
    expect(r.dest).toBe('/dashboard?claim=failed');
    expect(report.mock.calls).toEqual([
      ['first-login-failed', { userId: 'u1' }],
      ['claim-failed', { userId: 'u1' }],
    ]);
  });

  it('passes the events the hook produced', async () => {
    const events = [{ name: 'site_added', props: { n: 1 } }];
    runFirstLogin.mockResolvedValue({ trial: 'denied', siteId: 's', events });
    expect((await afterSignIn(deps, base)).events).toEqual(events);
  });
});

describe('continue-intent', () => {
  it('claimFromNext accepts only the exact claim target with a uuid and then=/dashboard', () => {
    expect(claimFromNext(claimNext(CHECK))).toBe(CHECK);
    for (const v of [
      `/api/checks/${CHECK}/claim?then=/r/x`,
      `/api/checks/${CHECK}/claim?then=https://evil.com`,
      `/api/checks/${CHECK}/claim`,
      `/api/checks/not-a-uuid-xxxxxxxxxxxxxxxxxxxxxxxxxxx/claim?then=/dashboard`,
      `//evil.com/api/checks/${CHECK}/claim?then=/dashboard`,
      `/api/checks/${CHECK}/claim?then=/dashboard&x=1`,
      undefined,
      '',
    ]) {
      expect(claimFromNext(v)).toBeNull();
    }
    expect(() => claimNext('x')).toThrow(RangeError);
  });

  it('decodeOtp keeps a well-formed carry, defaults an unknown type, and refuses the rest', () => {
    expect(decodeOtp(JSON.stringify({ kind: 'token_hash', value: 't', type: 'recovery' }))).toEqual(
      {
        kind: 'token_hash',
        value: 't',
        type: 'magiclink',
      },
    );
    expect(decodeOtp(JSON.stringify({ kind: 'code', value: 'c' }))).toEqual({
      kind: 'code',
      value: 'c',
    });
    for (const v of [
      undefined,
      '',
      'nope',
      '[]',
      '{"kind":"x","value":"t"}',
      '{"kind":"code","value":""}',
    ]) {
      expect(decodeOtp(v)).toBeNull();
    }
    expect(decodeOtp(JSON.stringify({ kind: 'code', value: 'x'.repeat(2049) }))).toBeNull();
  });

  it('decodeSignup keeps short strings only', () => {
    expect(decodeSignup(JSON.stringify({ site: 'a.com', tz: 'UTC', extra: 1 }))).toEqual({
      site: 'a.com',
      tz: 'UTC',
    });
    expect(decodeSignup(JSON.stringify({ site: 5, tz: 'x'.repeat(257) }))).toEqual({});
    expect(decodeSignup('not json')).toBeNull();
  });
});

describe('requestCookie', () => {
  it('reads one cookie, decoded, and leaves the body alone', async () => {
    const { requestCookie } = await import('./request-cookie');
    const req = new Request('https://x.test/', {
      method: 'POST',
      headers: { cookie: 'a=1; cm_auth_device=ab%3Dc; b' },
      body: '{"k":1}',
    });
    expect(requestCookie(req, 'cm_auth_device')).toBe('ab=c');
    expect(requestCookie(req, 'missing')).toBeUndefined();
    expect(await req.json()).toEqual({ k: 1 });
  });
});
