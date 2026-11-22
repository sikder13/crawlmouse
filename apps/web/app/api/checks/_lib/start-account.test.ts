import { describe, expect, it } from 'vitest';
import { GATES } from '../../../../lib/entitlement-v2';
import type { AccountViewer } from '../../../../lib/v2/account/viewer-read';
import type { AddSiteOutcome } from '../../../../lib/v2/account/sites-store';
import type { RecheckOutcome } from '../../../../lib/v2/account/recheck';
import { START_COPY, START_REFUSALS } from '../../../../components/v2/screens/home/start-check';
import {
  ACCOUNT_SENTENCES,
  siteLimitSentence,
  startAccountCheck,
  type AccountStartDeps,
  type CoveredSite,
} from './start-account';

// Every outcome of a signed-in start, over fakes (RC-02). route.account.test.ts runs the same start
// over a migrated database; this file reaches the outcomes that need a race or a full day to happen
// there. Each sentence is written out as the person reads it.

const VIEWER = {
  userId: 'u-1',
  email: 'p@example.com',
  seat: { id: 'seat-1', role: 'owner', theme: 'system' },
  account: {
    id: 'acct-1',
    kind: 'personal',
    name: null,
    state: 'free',
    timezone: 'UTC',
    trialEndsAt: null,
    trialUsedAt: null,
    stateHistory: [],
  },
  tier: 'free',
  gates: GATES.free,
  limits: { sites: 1, seats: 1, competitorsPerSite: 0 },
  accounts: [],
} as unknown as AccountViewer;

const INPUT = { url: 'https://shop.example/', requestId: 'r', ip: '203.0.113.9' };
const LATER = '2026-11-23T06:00:00.000Z';

function deps(
  over: {
    site?: CoveredSite | null;
    mayAdd?: boolean;
    added?: AddSiteOutcome;
    rechecks?: RecheckOutcome[];
  } = {},
) {
  const calls: string[] = [];
  const rechecks = [...(over.rechecks ?? [])];
  const d: AccountStartDeps = {
    admit: async () => true,
    limits: {
      global: async () => true,
      ip: async () => ({ allowed: true, resetAt: new Date(0) }),
      domain: async () => true,
      replay: async () => true,
    },
    verifyTurnstile: async () => false,
    coveredSite: async () => {
      calls.push('coveredSite');
      return over.site === undefined ? null : over.site;
    },
    mayAdd: async () => {
      calls.push('mayAdd');
      return over.mayAdd ?? true;
    },
    liveSites: async () => 0,
    schedule: () => null,
    addSite: async () => {
      calls.push('addSite');
      return over.added ?? { outcome: 'created', siteId: 's-new', checkId: 'c-new', n: 1 };
    },
    recheck: async (req) => {
      calls.push(`recheck ${req.siteId} cap=${req.cap}`);
      return rechecks.shift() ?? { queued: true, checkId: 'c-again', created: true };
    },
    now: () => new Date(Date.UTC(2026, 10, 22)),
  };
  return { d, calls };
}

const site = (over: Partial<CoveredSite> = {}): CoveredSite => ({
  id: 's-1',
  pausedReason: null,
  latest: { id: 'c-old', status: 'finished' },
  ...over,
});

describe('a new host', () => {
  it.each<[AddSiteOutcome, number, string, string, string | undefined]>([
    [
      { outcome: 'exists', siteId: 's-hidden' },
      409,
      'site_exists',
      'This account already keeps that site. Open it from your dashboard.',
      undefined,
    ],
    [
      { outcome: 'adds_capped', nextAllowedAt: LATER },
      429,
      'adds_capped',
      'This account has added as many sites as it may today. Try again tomorrow.',
      LATER,
    ],
    [
      { outcome: 'domain_capped', nextAllowedAt: LATER },
      429,
      'domain_limit',
      'Another audit for this domain ran in the last hour. Try again soon.',
      LATER,
    ],
    [
      { outcome: 'capacity' },
      503,
      'capacity',
      'We’re at capacity right now. Please try again tomorrow.',
      undefined,
    ],
  ])('add_site’s %o is answered %i %s', async (added, status, code, error, next) => {
    const { d } = deps({ added });
    const out = await startAccountCheck(d, VIEWER, INPUT);
    expect(out).toEqual({
      ok: false,
      status,
      body: { code, error, ...(next ? { nextAllowedAt: next } : {}) },
    });
    // No answer to a refusal names a site or a check, of this account or another.
    expect(JSON.stringify(out)).not.toContain('s-hidden');
  });

  it('a seat that may not add is refused before add_site is called', async () => {
    const { d, calls } = deps({ mayAdd: false });
    expect(await startAccountCheck(d, VIEWER, INPUT)).toMatchObject({
      status: 403,
      body: { code: 'role_refused' },
    });
    expect(calls).toEqual(['coveredSite', 'mayAdd']);
  });
});

describe('a host the account keeps', () => {
  it('is re-checked under the plan’s own cap of manual checks a site a day', async () => {
    const { d, calls } = deps({ site: site() });
    expect(await startAccountCheck(d, VIEWER, INPUT)).toEqual({
      ok: true,
      checkId: 'c-again',
      created: true,
      started: { trigger: 'manual', siteId: 's-1' },
    });
    expect(calls).toEqual(['coveredSite', `recheck s-1 cap=${GATES.free.manualChecksPerSiteDay}`]);
  });

  it('a paused site is refused without a request', async () => {
    const { d, calls } = deps({ site: site({ pausedReason: 'staging_not_in_plan' }) });
    expect(await startAccountCheck(d, VIEWER, INPUT)).toEqual({
      ok: false,
      status: 409,
      body: {
        code: 'site_paused',
        error: 'Checks of this site are paused. Its page on your dashboard says why.',
      },
    });
    expect(calls).toEqual(['coveredSite']);
  });

  it.each<[RecheckOutcome, object]>([
    [
      { queued: false, reason: 'capped', nextAllowedAt: LATER },
      {
        ok: false,
        status: 429,
        body: {
          code: 'recently_checked',
          error:
            'This site was checked as often as its plan allows for now. Its latest audit is on your dashboard.',
          nextAllowedAt: LATER,
        },
      },
    ],
    [
      { queued: false, reason: 'recently_checked', nextAllowedAt: LATER },
      { ok: false, status: 429, body: expect.objectContaining({ code: 'recently_checked' }) },
    ],
    [
      { queued: false, reason: 'check_running', checkId: 'c-running' },
      { ok: true, checkId: 'c-running', created: false, started: null },
    ],
    [
      { queued: true, checkId: 'c-bucket', created: false },
      { ok: true, checkId: 'c-bucket', created: false, started: null },
    ],
    [
      { queued: false, reason: 'capacity' },
      { ok: false, status: 503, body: expect.objectContaining({ code: 'capacity' }) },
    ],
    [
      { queued: false, reason: 'paused' },
      { ok: false, status: 409, body: expect.objectContaining({ code: 'site_paused' }) },
    ],
  ])('the re-check’s %o is answered as %o', async (recheck, answer) => {
    const { d } = deps({ site: site(), rechecks: [recheck] });
    expect(await startAccountCheck(d, VIEWER, INPUT)).toEqual(answer);
  });

  it('a site removed between the read and the request is added again as a new site', async () => {
    const { d, calls } = deps({ site: site(), rechecks: [{ queued: false, reason: 'removed' }] });
    expect(await startAccountCheck(d, VIEWER, INPUT)).toEqual({
      ok: true,
      checkId: 'c-new',
      created: true,
      started: { trigger: 'first_audit', siteId: 's-new', n: 1 },
    });
    expect(calls).toEqual([
      'coveredSite',
      `recheck s-1 cap=${GATES.free.manualChecksPerSiteDay}`,
      'mayAdd',
      'addSite',
    ]);
  });
});

describe('the home form’s words', () => {
  it('the form knows every account refusal, and says the route’s own sentence for each', () => {
    for (const [code, sentence] of Object.entries(ACCOUNT_SENTENCES)) {
      expect(START_REFUSALS).toContain(code);
      expect(START_COPY[code as keyof typeof ACCOUNT_SENTENCES]).toBe(sentence);
    }
    expect(START_REFUSALS).toContain('site_limit');
    // A plan's limit is the account's: the form's sentence names no count of sites.
    expect(START_COPY.site_limit).not.toMatch(/\d|\b(one|two|three|four|five|ten) sites?\b/i);
  });
});

describe('siteLimitSentence', () => {
  it('says how many an account over its limit keeps (a lapsed plan’s sites)', () => {
    expect(siteLimitSentence('free', GATES.free.sites, 5)).toBe(
      'Your Free plan keeps one site, and this account keeps five sites now. Open your dashboard to check one of them again.',
    );
  });

  it('names the plan and its limit in words, for each tier’s own limit', () => {
    expect(siteLimitSentence('free', GATES.free.sites)).toBe(
      'Your Free plan keeps one site, and this account keeps it already. Open your dashboard to check it again.',
    );
    expect(siteLimitSentence('pro', GATES.pro.sites)).toBe(
      'Your Pro plan keeps five sites, and this account keeps them already. Open your dashboard to check one of them again.',
    );
    expect(siteLimitSentence('agency', GATES.agency.sites)).toBe(
      'Your Agency plan keeps 25 sites, and this account keeps them already. Open your dashboard to check one of them again.',
    );
  });
});
