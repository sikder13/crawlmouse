/**
 * Row 18: what production wires into the competitor work. Two of its rules are security rules, so they
 * are pinned at the wiring, not only in the work's own tests with fakes: a competitor host goes
 * through the SSRF guard (`admitSiteHost`), and the account's daily bucket fails closed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const admitSiteHost = vi.fn(async (_host: string) => false);
vi.mock('../../auth/admit-site', () => ({
  admitSiteHost: (host: string) => admitSiteHost(host),
}));

const checkRateLimit = vi.fn(async (..._a: unknown[]) => ({ allowed: true, resetAt: new Date() }));
vi.mock('../../rate-limit', () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
}));

const { competitorDeps } = await import('./functions');

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'placeholder',
};

beforeEach(() => {
  admitSiteHost.mockClear();
  checkRateLimit.mockClear();
});

describe('competitorDeps', () => {
  it('admits a competitor host only through the SSRF guard, and refuses what it refuses', async () => {
    const deps = competitorDeps(ENV);
    expect(await deps.admit('rival.example')).toBe(false);
    expect(admitSiteHost).toHaveBeenCalledWith('rival.example');
    admitSiteHost.mockResolvedValueOnce(true);
    expect(await deps.admit('rival.example')).toBe(true);
  });

  it("counts the account's bucket per account per day, and fails closed", async () => {
    const deps = competitorDeps(ENV);
    expect(await deps.limits.account('acct-1', 75)).toBe(true);
    expect(checkRateLimit).toHaveBeenCalledWith(
      'competitors:account:acct-1',
      75,
      24 * 60 * 60 * 1000,
      { failClosed: true },
    );
    checkRateLimit.mockResolvedValueOnce({ allowed: false, resetAt: new Date() });
    expect(await deps.limits.account('acct-1', 75)).toBe(false);
  });
});
