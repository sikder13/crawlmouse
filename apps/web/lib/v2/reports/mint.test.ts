import { beforeEach, describe, expect, it } from 'vitest';
import { fixture } from '../fixtures';
import { FIRST_AUDIT } from '../view/segment/test-helpers';
import { buildPublicSnapshot } from './build-snapshot';
import { mintV2, type MintV2Deps, type WriteError } from './mint';

const CHECK = FIRST_AUDIT['bad-site'];
const SITE = 'site-1';
const ACCOUNT = 'acct-1';
const NOW = new Date('2026-11-12T18:00:00.000Z');
const snapshot = buildPublicSnapshot(fixture('bad-site'), CHECK, NOW.toISOString());

/** Each dependency call, in order, by name: the order is what the guards are about. */
let calls: string[];
let state: {
  user: { id: string } | null;
  check: { siteId: string; status: string } | null;
  member: boolean;
  capAllowed: boolean;
  turnstileOk: boolean;
  existing: (string | null)[];
  insertErrors: (WriteError | null)[];
  accountId: string | null;
};
let slugs: string[];
let inserted: Record<string, unknown>[];
let verified: [string, string | undefined][];
let limits: [string, number, number][];

function deps(): MintV2Deps {
  const log =
    <A extends unknown[], R>(name: string, fn: (...a: A) => R) =>
    (...a: A): R => {
      calls.push(name);
      return fn(...a);
    };
  return {
    user: log('user', async () => state.user),
    checkAsCaller: log('checkAsCaller', async () => state.check),
    isMemberForSite: log('isMemberForSite', async () => state.member),
    checkRateLimit: log('checkRateLimit', async (key: string, limit: number, windowMs: number) => {
      limits.push([key, limit, windowMs]);
      return { allowed: state.capAllowed };
    }),
    verifyTurnstile: log('verifyTurnstile', async (token: string, ip?: string) => {
      verified.push([token, ip]);
      return state.turnstileOk;
    }),
    slugForCheck: log('slugForCheck', async () => state.existing.shift() ?? null),
    snapshotOf: log('snapshotOf', async () => ({ snapshot, accountId: state.accountId })),
    insert: log('insert', async (row: Record<string, unknown>) => {
      inserted.push(row);
      return { error: state.insertErrors.shift() ?? null };
    }),
    reportMinted: log('reportMinted', async () => {}),
    newSlug: () => slugs.shift()!,
    now: () => NOW,
  };
}

/** The service-role dependencies: none may run before the caller's membership is known. */
const SERVICE_ROLE = ['slugForCheck', 'snapshotOf', 'insert'];

const mint = (token?: string, ip = '9.9.9.9') =>
  mintV2(deps(), token ? { checkId: CHECK, turnstileToken: token } : { checkId: CHECK }, ip);

beforeEach(() => {
  calls = [];
  state = {
    user: { id: 'u-1' },
    check: { siteId: SITE, status: 'finished' },
    member: true,
    capAllowed: true,
    turnstileOk: true,
    existing: [],
    insertErrors: [],
    accountId: ACCOUNT,
  };
  slugs = ['slug-a', 'slug-b', 'slug-c', 'slug-d'];
  inserted = [];
  verified = [];
  limits = [];
});

describe('mintV2', () => {
  it('mints a finished check of the caller’s site: one row, unlisted and noindex by default', async () => {
    expect(await mint()).toEqual({ status: 200, body: { slug: 'slug-a', alreadyPublic: false } });
    expect(inserted).toEqual([
      {
        slug: 'slug-a',
        audit_id: null,
        check_id: CHECK,
        site_id: SITE,
        account_id: ACCOUNT,
        domain: 'example-outfitter.com',
        report_snapshot: snapshot,
        minted_by: 'u-1',
      },
    ]);
    // The defaults decide visibility: the row names neither column (mint.db.test.ts reads them).
    expect(Object.keys(inserted[0]!)).not.toContain('listed');
    expect(Object.keys(inserted[0]!)).not.toContain('indexable');
    expect(calls.filter((c) => c === 'reportMinted')).toHaveLength(1);
  });

  it('needs a signed-in caller: 401 before anything else', async () => {
    state.user = null;
    expect(await mint()).toEqual({ status: 401, body: { error: 'auth_required' } });
    expect(calls).toEqual(['user']);
  });

  it('another account’s check is a 404, and nothing is read with the service role', async () => {
    state.member = false;
    expect(await mint()).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(calls.filter((c) => SERVICE_ROLE.includes(c))).toEqual([]);
    expect(calls).toContain('isMemberForSite');
  });

  it('a check the caller’s session cannot see is the same 404', async () => {
    state.check = null;
    expect(await mint()).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(calls.filter((c) => SERVICE_ROLE.includes(c))).toEqual([]);
  });

  it('the membership check runs before any service-role read', async () => {
    await mint();
    const member = calls.indexOf('isMemberForSite');
    expect(member).toBeGreaterThan(-1);
    for (const name of SERVICE_ROLE) expect(calls.indexOf(name)).toBeGreaterThan(member);
  });

  it('a partial check is 409 check_partial; one not finished is 409 check_not_finished', async () => {
    state.check = { siteId: SITE, status: 'partial' };
    expect(await mint()).toEqual({ status: 409, body: { error: 'check_partial' } });
    for (const status of ['queued', 'running', 'failed', 'deferred']) {
      state.check = { siteId: SITE, status };
      expect(await mint()).toEqual({ status: 409, body: { error: 'check_not_finished' } });
    }
    expect(inserted).toEqual([]);
  });

  it('a check already minted answers its slug, with no second row', async () => {
    state.existing = ['first'];
    expect(await mint()).toEqual({ status: 200, body: { slug: 'first', alreadyPublic: true } });
    expect(inserted).toEqual([]);
    expect(calls).not.toContain('reportMinted');
  });

  it('a double mint answers the same slug both times', async () => {
    const first = await mint();
    state.existing = ['slug-a'];
    const second = await mint();
    expect([first.body, second.body]).toEqual([
      { slug: 'slug-a', alreadyPublic: false },
      { slug: 'slug-a', alreadyPublic: true },
    ]);
    expect(inserted).toHaveLength(1);
  });

  it('a concurrent mint that won the unique check index is answered with its slug', async () => {
    state.existing = [null, 'winner'];
    state.insertErrors = [{ code: '23505', message: 'public_reports_check_uq' }];
    expect(await mint()).toEqual({ status: 200, body: { slug: 'winner', alreadyPublic: true } });
    expect(calls).not.toContain('reportMinted');
  });

  it('a slug collision is retried with a fresh slug', async () => {
    state.insertErrors = [{ code: '23505', message: 'public_reports_pkey' }];
    expect(await mint()).toEqual({ status: 200, body: { slug: 'slug-b', alreadyPublic: false } });
    expect(inserted.map((r) => r.slug)).toEqual(['slug-a', 'slug-b']);
  });

  it('three collisions, an unknown column and any other write error are refused', async () => {
    const dup = { code: '23505' };
    state.insertErrors = [dup, dup, dup];
    expect((await mint()).status).toBe(500);
    state.insertErrors = [{ code: 'PGRST204', message: "Could not find the 'check_id' column" }];
    expect(await mint()).toEqual({ status: 503, body: { error: 'minting_unavailable' } });
    state.insertErrors = [{ code: '42501', message: 'permission denied' }];
    expect((await mint()).status).toBe(500);
  });
});

describe('mintV2’s cap and Turnstile: v1’s authed path', () => {
  it('counts the caller’s own bucket at v1’s per-user cap', async () => {
    await mint();
    expect(limits).toEqual([['mint:u-1', 20, 24 * 60 * 60 * 1000]]);
  });

  it('cap spent and no token: 429 captcha_required, before the check is read', async () => {
    state.capAllowed = false;
    expect(await mint()).toEqual({ status: 429, body: { error: 'captcha_required' } });
    expect(calls).toEqual(['user', 'checkRateLimit']);
  });

  it('cap spent and a bad token: 429 captcha_failed; a good one passes', async () => {
    state.capAllowed = false;
    state.turnstileOk = false;
    expect(await mint('spent')).toEqual({ status: 429, body: { error: 'captcha_failed' } });
    state.turnstileOk = true;
    expect((await mint('tok', 'unknown')).status).toBe(200);
    expect(verified).toEqual([
      ['spent', '9.9.9.9'],
      ['tok', undefined],
    ]);
  });

  it('a token is not checked while the cap holds', async () => {
    expect((await mint('tok')).status).toBe(200);
    expect(verified).toEqual([]);
  });
});

describe('mintV2 with a site that has no account', () => {
  it('is a 404 and inserts nothing', async () => {
    state.accountId = null;
    expect(await mint()).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(inserted).toEqual([]);
  });
});
