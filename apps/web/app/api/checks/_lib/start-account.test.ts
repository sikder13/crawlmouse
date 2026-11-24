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
    live?: number;
  } = {},
) {
  const calls: string[] = [];
  const added: unknown[] = [];
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
    liveSites: async () => over.live ?? 0,
    schedule: () => null,
    addSite: async (site) => {
      calls.push('addSite');
      added.push(site);
      return over.added ?? { outcome: 'created', siteId: 's-new', checkId: 'c-new', n: 1 };
    },
    recheck: async (req) => {
      calls.push(`recheck ${req.siteId} cap=${req.cap}`);
      return rechecks.shift() ?? { queued: true, checkId: 'c-again', created: true };
    },
    resendQueued: async () => {
      calls.push('resendQueued');
      return true;
    },
    now: () => new Date(Date.UTC(2026, 10, 22)),
  };
  return { d, calls, added };
}

const site = (over: Partial<CoveredSite> = {}): CoveredSite => ({
  id: 's-1',
  pausedReason: null,
  latest: {
    id: 'c-old',
    status: 'finished',
    trigger: 'manual',
    queued_at: '2026-11-20T10:00:00.000Z',
  },
  ...over,
});

describe('a new host', () => {
  it('asks add_site for the account, its seat, the host, the plan’s limit, the domain bucket on Free only, and the person', async () => {
    const free = deps();
    await startAccountCheck(free.d, VIEWER, INPUT);
    const pro = deps();
    const proViewer = {
      ...VIEWER,
      tier: 'pro',
      gates: GATES.pro,
      limits: { ...VIEWER.limits, sites: GATES.pro.sites },
    } as AccountViewer;
    await startAccountCheck(pro.d, proViewer, INPUT);
    const common = {
      accountId: 'acct-1',
      ownerSeatId: 'seat-1',
      host: 'shop.example',
      schedule: null,
      requestedByUserId: 'u-1',
    };
    expect(free.added).toEqual([{ ...common, limit: GATES.free.sites, perDomain: true }]);
    expect(pro.added).toEqual([{ ...common, limit: GATES.pro.sites, perDomain: false }]);
  });

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
  it('tells an account manager the limit of the account they act in, not “your” plan', async () => {
    const manager = {
      ...VIEWER,
      seat: { ...VIEWER.seat, role: 'account_manager' },
      tier: 'agency',
      gates: GATES.agency,
      limits: { ...VIEWER.limits, sites: GATES.agency.sites },
    } as unknown as AccountViewer;
    const { d } = deps({ live: GATES.agency.sites });
    const out = await startAccountCheck(d, manager, INPUT);
    expect(out).toMatchObject({
      ok: false,
      status: 409,
      body: {
        code: 'site_limit',
        error:
          'This account’s Agency plan keeps 25 sites, and they are already taken. Open your dashboard to check one of them again.',
      },
    });
  });

  it('says how many an account over its limit keeps (a lapsed plan’s sites)', () => {
    expect(siteLimitSentence('free', GATES.free.sites, 5)).toBe(
      'This account’s Free plan keeps one site, and the account has five sites now. Open your dashboard to check one of them again.',
    );
  });

  it.each([
    ['free', 0],
    ['pro', 3],
    ['agency', 24],
  ] as const)(
    'with fewer kept than %s’s limit (a removal raced the add) names no count',
    (tier, kept) => {
      const sentence = siteLimitSentence(tier, GATES[tier].sites, kept);
      expect(sentence).toBe('A site on this account was just removed. Try again.');
    },
  );

  it('when the add answers full but a removal has freed a site, names no count', async () => {
    const { d, calls } = deps({ added: { outcome: 'full' }, live: 0 });
    const out = await startAccountCheck(d, VIEWER, INPUT);
    expect(calls).toContain('addSite');
    expect(out).toMatchObject({
      ok: false,
      status: 409,
      body: { code: 'site_limit', error: 'A site on this account was just removed. Try again.' },
    });
  });

  it('never calls the plan the reader’s own, since a manager acts in a client’s account', () => {
    for (const tier of ['free', 'pro', 'agency'] as const) {
      for (const kept of [0, GATES[tier].sites, GATES[tier].sites + 1]) {
        expect(siteLimitSentence(tier, GATES[tier].sites, kept)).not.toMatch(/\byour \w+ plan\b/i);
      }
    }
  });

  it('names the plan and its limit in words, for each tier’s own limit', () => {
    expect(siteLimitSentence('free', GATES.free.sites)).toBe(
      'This account’s Free plan keeps one site, and it is already taken. Open your dashboard to check it again.',
    );
    expect(siteLimitSentence('pro', GATES.pro.sites)).toBe(
      'This account’s Pro plan keeps five sites, and they are already taken. Open your dashboard to check one of them again.',
    );
    expect(siteLimitSentence('agency', GATES.agency.sites)).toBe(
      'This account’s Agency plan keeps 25 sites, and they are already taken. Open your dashboard to check one of them again.',
    );
  });
});
