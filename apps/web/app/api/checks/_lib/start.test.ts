import net from 'node:net';
import type { PGlite } from '@electric-sql/pglite';
import { validateUrlOrThrow, type DnsResolver } from '@crawlmouse/engine';
import fc from 'fast-check';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { postgrestOver } from '../../../../__tests__/helpers/postgrest-pglite';
import { accountOf, doorDb, signUp } from '../../../../__tests__/v2/_lib/door-pglite';
import { admitSiteHost } from '../../../../lib/auth/admit-site';
import { publicCheckId, publicSiteId } from '../../../../lib/v2/pipeline/public';
import { sqlPipelineStore } from '../../../../lib/v2/pipeline/test-support/sql-store';
import { startPublicCheck, type StartDeps, type StartInput, type StartLimits } from './start';
import { sqlStartStore } from './start-store-sql';

// The limiter under test is the one production uses; its service-role client is PGlite here.
const admin = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => admin.client }));
import { startLimits } from './start-limits';

const REQUEST = '0b9d3c52-7c1e-4f0a-9a44-1f2e3d4c5b6a';
// stableId('public_check' | 'public_site', REQUEST, 'example.com'), computed outside this codebase:
// sha256 of the length-prefixed parts, version 8, RFC 9562 variant.
const CHECK = '171e539a-b989-8cdd-9aa7-3245efaf29a2';
const SITE = '94a4ebe1-91e0-8ce4-9ff3-11c585f13b18';
const IP = '203.0.113.9';
const NOON = Date.UTC(2026, 10, 10, 12, 0, 0);
const DAY_MS = 86_400_000;
const PUBLIC_ADDRESS = '93.184.216.34';

/** What each name resolves to in a test; a name it does not hold does not resolve. */
const dns = new Map<string, string[]>();
const resolver: DnsResolver = async (host) => (net.isIP(host) ? [host] : (dns.get(host) ?? []));

const INVALID_URL = {
  status: 400,
  body: { code: 'invalid_url', error: 'Enter the address of a public website.' },
};

type Sent = Parameters<StartDeps['pipeline']['send']>[0];

function harness(db: PGlite, over: Partial<StartDeps> = {}) {
  const sent: Sent[] = [];
  const deps: StartDeps = {
    admit: (host) => admitSiteHost(host, (url) => validateUrlOrThrow(url, { resolver })),
    store: sqlStartStore(db),
    limits: startLimits,
    signedIn: async () => false,
    verifyTurnstile: async () => false,
    pipeline: {
      store: sqlPipelineStore(db),
      send: async (event) => void sent.push(event),
      now: () => NOON,
    },
    ...over,
  };
  const start = (input: Partial<StartInput> = {}) =>
    startPublicCheck(deps, { url: 'https://example.com/', requestId: REQUEST, ip: IP, ...input });
  return { deps, sent, start };
}

/** `deps` with each call recorded by name, in the order it was made. */
function traced(deps: StartDeps, trace: string[]): StartDeps {
  const named =
    <A extends unknown[], R>(name: string, fn: (...args: A) => R) =>
    (...args: A): R => {
      trace.push(name);
      return fn(...args);
    };
  return {
    admit: named('admit', deps.admit),
    store: {
      derived: named('derived', deps.store.derived),
      insertUnkeptSite: named('insertUnkeptSite', deps.store.insertUnkeptSite),
    },
    limits: {
      global: named('global', deps.limits.global),
      ip: named('ip', deps.limits.ip),
      domain: named('domain', deps.limits.domain),
    },
    signedIn: named('signedIn', deps.signedIn),
    verifyTurnstile: named('turnstile', deps.verifyTurnstile),
    pipeline: {
      store: {
        requestSite: named('requestSite', deps.pipeline.store.requestSite),
        insertQueued: named('insertQueued', deps.pipeline.store.insertQueued),
      },
      send: named('send', deps.pipeline.send),
      now: deps.pipeline.now,
    },
  };
}

const OPEN: StartLimits = {
  global: async () => true,
  ip: async () => ({ allowed: true, resetAt: new Date(NOON + DAY_MS) }),
  domain: async () => true,
};

const rowsOf = async (db: PGlite) => {
  const one = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0]!.n;
  return {
    sites: await one('select count(*)::int as n from public.sites'),
    checks: await one('select count(*)::int as n from public.checks'),
    rateLimits: await one('select count(*)::int as n from public.rate_limits'),
  };
};
const NOTHING = { sites: 0, checks: 0, rateLimits: 0 };

const buckets = async (db: PGlite) =>
  (
    await db.query<{ bucket_key: string; request_count: number }>(
      'select bucket_key, request_count from public.rate_limits order by bucket_key',
    )
  ).rows.map((r) => `${r.bucket_key}=${r.request_count}`);

/** Fills a bucket's current window, as that many earlier calls would have. */
async function spend(db: PGlite, key: string, windowMs: number, count: number) {
  const window = new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString();
  await db.query(
    'insert into public.rate_limits (bucket_key, window_start, request_count) values ($1, $2, $3)',
    [key, window, count],
  );
}

let db: PGlite;
beforeEach(async () => {
  db = await doorDb();
  admin.client = postgrestOver(db);
  dns.clear();
  dns.set('example.com', [PUBLIC_ADDRESS]);
  dns.set('www.example.com', [PUBLIC_ADDRESS]);
  dns.set('other.example', ['198.51.100.7']);
});

describe('a first start', () => {
  it('makes one unkept site and one queued check under the derived ids, and sends one event', async () => {
    const h = harness(db);
    expect(await h.start()).toEqual({ ok: true, checkId: CHECK, created: true });

    const sites = await db.query('select id, host, account_id from public.sites');
    expect(sites.rows).toEqual([{ id: SITE, host: 'example.com', account_id: null }]);
    const checks = await db.query<{ expires_at: Date; queued_at: Date }>(
      'select id, site_id, status, trigger, expires_at, queued_at from public.checks',
    );
    expect(checks.rows).toEqual([
      {
        id: CHECK,
        site_id: SITE,
        status: 'queued',
        trigger: 'first_audit',
        // 24 hours after the request (D8).
        expires_at: new Date('2026-11-11T12:00:00.000Z'),
        queued_at: new Date('2026-11-10T12:00:00.000Z'),
      },
    ]);
    expect(h.sent).toEqual([
      {
        id: `check:anon:${CHECK}`,
        name: 'check.requested',
        data: {
          checkId: CHECK,
          siteId: SITE,
          accountId: null,
          host: 'example.com',
          homepageUrl: 'https://example.com',
          trigger: 'first_audit',
          pageCap: 500,
        },
      },
    ]);
  });

  it('counts once against the day’s ceiling, the caller’s address and the domain', async () => {
    await harness(db).start({ url: 'https://www.example.com/' });
    expect(await buckets(db)).toEqual([
      'domain:example.com=1',
      'global:audits:day=1',
      `ip:${IP}=1`,
    ]);
  });

  it('keeps `www.` in the stored host, as a named site’s host keeps it', async () => {
    await harness(db).start({ url: 'https://WWW.Example.com./pricing' });
    expect((await db.query('select host from public.sites')).rows).toEqual([
      { host: 'www.example.com' },
    ]);
  });

  it('the derived ids are the seam’s, of the request id and the stored host', () => {
    expect(publicCheckId(REQUEST, 'example.com')).toBe(CHECK);
    expect(publicSiteId(REQUEST, 'example.com')).toBe(SITE);
  });
});

describe('the order of a start', () => {
  const FULL = [
    'admit',
    'derived',
    'global',
    'signedIn',
    'ip',
    'domain',
    'insertUnkeptSite',
    'requestSite',
    'insertQueued',
    'send',
  ];
  const run = async (over: Partial<StartDeps>, input: Partial<StartInput> = {}) => {
    const trace: string[] = [];
    const h = harness(db, { limits: OPEN, ...over });
    const outcome = await startPublicCheck(traced(h.deps, trace), {
      url: 'https://example.com/',
      requestId: REQUEST,
      ip: IP,
      ...input,
    });
    return { outcome, trace, sent: h.sent };
  };
  const refusal = (status: number, code: string) =>
    expect.objectContaining({ ok: false, status, body: expect.objectContaining({ code }) });

  it('guard, the derived rows, the ceiling, the address, the domain, then the writes', async () => {
    const { outcome, trace } = await run({});
    expect(outcome).toEqual({ ok: true, checkId: CHECK, created: true });
    expect(trace).toEqual(FULL);
  });

  it('a host the guard refuses ends the start at the guard', async () => {
    const { outcome, trace } = await run({ admit: async () => false });
    expect(outcome).toEqual({ ok: false, ...INVALID_URL });
    expect(trace).toEqual(['admit']);
  });

  it('a URL that names no host does not reach the guard', async () => {
    const { outcome, trace } = await run({}, { url: 'https://example.com:8443/' });
    expect(outcome).toEqual({ ok: false, ...INVALID_URL });
    expect(trace).toEqual([]);
  });

  it('a ceiling that is reached ends the start before the session or an address bucket is read', async () => {
    const { outcome, trace } = await run({ limits: { ...OPEN, global: async () => false } });
    expect(outcome).toEqual({
      ok: false,
      status: 503,
      body: { code: 'capacity', error: 'We’re at capacity right now. Please try again tomorrow.' },
    });
    expect(trace).toEqual(FULL.slice(0, 3));
  });

  const spentIp: StartLimits = {
    ...OPEN,
    ip: async () => ({ allowed: false, resetAt: new Date('2026-11-11T00:00:00.000Z') }),
  };

  it('an address over its limit with no token is asked for one, before the domain bucket', async () => {
    const { outcome, trace } = await run({ limits: spentIp });
    expect(outcome).toEqual({
      ok: false,
      status: 429,
      body: {
        code: 'captcha_required',
        error: 'Confirm you are not a robot to start another audit.',
        resetAt: '2026-11-11T00:00:00.000Z',
      },
    });
    expect(trace).toEqual(FULL.slice(0, 5));
  });

  it('a token that does not verify ends the start before the domain bucket', async () => {
    const seen: unknown[][] = [];
    const { outcome, trace } = await run(
      {
        limits: spentIp,
        verifyTurnstile: async (...args) => {
          seen.push(args);
          return false;
        },
      },
      { turnstileToken: 'tok' },
    );
    expect(outcome).toEqual(refusal(429, 'captcha_failed'));
    expect(trace).toEqual([...FULL.slice(0, 5), 'turnstile']);
    expect(seen).toEqual([['tok', IP]]);
  });

  it('a token that verifies lets the start go on', async () => {
    const { outcome, trace } = await run(
      { limits: spentIp, verifyTurnstile: async () => true },
      { turnstileToken: 'tok' },
    );
    expect(outcome).toEqual({ ok: true, checkId: CHECK, created: true });
    expect(trace).toEqual([...FULL.slice(0, 5), 'turnstile', ...FULL.slice(5)]);
  });

  it('a token is not verified while the address is under its limit', async () => {
    const { trace } = await run({ verifyTurnstile: async () => false }, { turnstileToken: 'tok' });
    expect(trace).toEqual(FULL);
  });

  it('a domain over its limit ends the start before any write', async () => {
    const { outcome, trace, sent } = await run({ limits: { ...OPEN, domain: async () => false } });
    expect(outcome).toEqual({
      ok: false,
      status: 429,
      body: {
        code: 'domain_limit',
        error: 'Another audit for this domain ran in the last hour. Try again soon.',
      },
    });
    expect(trace).toEqual(FULL.slice(0, 6));
    expect(sent).toEqual([]);
    expect(await rowsOf(db)).toEqual(NOTHING);
  });

  it('a caller with no known address skips the address bucket and the session read', async () => {
    const { outcome, trace } = await run({}, { ip: 'unknown' });
    expect(outcome).toEqual({ ok: true, checkId: CHECK, created: true });
    expect(trace).toEqual(FULL.filter((step) => step !== 'signedIn' && step !== 'ip'));
  });

  it('the address bucket is asked for the caller’s address and whether they are signed in', async () => {
    const asked: unknown[][] = [];
    const limits: StartLimits = {
      ...OPEN,
      ip: async (...args) => {
        asked.push(args);
        return OPEN.ip(...args);
      },
      domain: async (...args) => {
        asked.push(args);
        return true;
      },
    };
    await run({ limits, signedIn: async () => true }, { url: 'https://www.example.com/' });
    expect(asked).toEqual([[IP, true], ['example.com']]);
  });
});

describe('the limits, counted in the database', () => {
  it('the ceiling: start 5,001 of a day is refused', async () => {
    await spend(db, 'global:audits:day', DAY_MS, 5000);
    expect(await harness(db).start()).toEqual(
      expect.objectContaining({
        ok: false,
        status: 503,
        body: expect.objectContaining({ code: 'capacity' }),
      }),
    );
    expect((await rowsOf(db)).checks).toBe(0);
  });

  it('the ceiling is closed when it cannot be counted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    admin.client = { rpc: async () => ({ data: null, error: { message: 'down' } }) };
    const outcome = await harness(db, {
      limits: { ...startLimits, ip: OPEN.ip, domain: OPEN.domain },
    }).start();
    expect(outcome).toEqual(
      expect.objectContaining({
        ok: false,
        status: 503,
        body: expect.objectContaining({ code: 'capacity' }),
      }),
    );
    vi.restoreAllMocks();
  });

  it('an address: start 21 of a day needs a token from a visitor, and start 41 from a signed-in caller', async () => {
    await spend(db, `ip:${IP}`, DAY_MS, 20);
    const visitor = await harness(db).start();
    expect(visitor).toEqual(
      expect.objectContaining({
        status: 429,
        body: expect.objectContaining({ code: 'captcha_required' }),
      }),
    );
    const member = harness(db, { signedIn: async () => true });
    expect(await member.start({ requestId: '3c2b1a09-8f7e-4d6c-9b5a-4a3b2c1d0e9f' })).toEqual(
      expect.objectContaining({ ok: true }),
    );
    await db.query(`update public.rate_limits set request_count = 40 where bucket_key = $1`, [
      `ip:${IP}`,
    ]);
    expect(await member.start({ requestId: '4d3c2b1a-9f8e-4e7d-8c6b-5b4c3d2e1f0a' })).toEqual(
      expect.objectContaining({
        status: 429,
        body: expect.objectContaining({ code: 'captcha_required' }),
      }),
    );
  });

  it('a domain: start 6 of an hour is refused, with or without `www.`', async () => {
    await spend(db, 'domain:example.com', 3_600_000, 5);
    for (const url of ['https://example.com/', 'https://www.example.com/']) {
      expect(await harness(db).start({ url })).toEqual(
        expect.objectContaining({
          status: 429,
          body: expect.objectContaining({ code: 'domain_limit' }),
        }),
      );
    }
    expect(await rowsOf(db)).toEqual(expect.objectContaining({ sites: 0, checks: 0 }));
  });
});

describe('a start that is sent again', () => {
  const EVENT = `check:anon:${CHECK}`;

  it('while the check is queued: the same check, the same event id again, one row, no bucket counted', async () => {
    const h = harness(db);
    const first = await h.start();
    const counted = await buckets(db);
    const again = await h.start();
    expect(first).toEqual({ ok: true, checkId: CHECK, created: true });
    expect(again).toEqual({ ok: true, checkId: CHECK, created: false });
    expect(await rowsOf(db)).toEqual({ sites: 1, checks: 1, rateLimits: 3 });
    expect(await buckets(db)).toEqual(counted);
    expect(h.sent.map((e) => e.id)).toEqual([EVENT, EVENT]);
    expect(h.sent[1]).toEqual(h.sent[0]);
  });

  it('while the check is queued: asks no limit, and calls the pipeline for the event', async () => {
    const h = harness(db);
    await h.start();
    const trace: string[] = [];
    await startPublicCheck(traced(h.deps, trace), {
      url: 'http://EXAMPLE.com/another/page',
      requestId: REQUEST.toUpperCase(),
      ip: IP,
    });
    expect(trace).toEqual(['admit', 'derived', 'requestSite', 'insertQueued', 'send']);
  });

  it('after a send that failed: the retry sends the event once, with no second row or bucket count', async () => {
    const failing = harness(db);
    failing.deps.pipeline.send = async () => {
      throw new Error('event service down');
    };
    await expect(failing.start()).rejects.toThrow('event service down');
    expect((await db.query('select id, status from public.checks')).rows).toEqual([
      { id: CHECK, status: 'queued' },
    ]);
    const counted = await buckets(db);

    const h = harness(db);
    expect(await h.start()).toEqual({ ok: true, checkId: CHECK, created: false });
    expect(h.sent.map((e) => e.id)).toEqual([EVENT]);
    expect(await rowsOf(db)).toEqual({ sites: 1, checks: 1, rateLimits: 3 });
    expect(await buckets(db)).toEqual(counted);
  });

  const ENDED = `started_at = queued_at, finished_at = now(), coverage = '{}'::jsonb,
                 lineage_id = gen_random_uuid()`;
  // The start reads the check's status alone, so an ended check is written here without the
  // lineage row a real one refers to.
  const ended = async (set: string) => {
    await db.query('alter table public.checks drop constraint checks_lineage_id_fkey');
    await db.query(`update public.checks set ${set}`);
  };
  it.each<[string, (store: ReturnType<typeof sqlPipelineStore>) => Promise<unknown>]>([
    ['is running', (store) => store.claim(CHECK, 'run-1', null)],
    ['was canceled', (store) => store.fail(CHECK, 'canceled', null)],
    ['ended partial', () => ended(`status = 'partial', ${ENDED}`)],
    [
      'has finished',
      () =>
        ended(
          `status = 'finished', ${ENDED}, technical_seo = '{"refusal": {"refused": true}}'::jsonb,
           ai_readability = '{"withheld": true}'::jsonb`,
        ),
    ],
  ])('when the check %s: the same check, nothing sent, no pipeline call', async (_, change) => {
    const h = harness(db);
    await h.start();
    await change(sqlPipelineStore(db));
    const trace: string[] = [];
    expect(
      await startPublicCheck(traced(h.deps, trace), {
        url: 'https://example.com/',
        requestId: REQUEST,
        ip: IP,
      }),
    ).toEqual({ ok: true, checkId: CHECK, created: false });
    expect(trace).toEqual(['admit', 'derived']);
    expect(h.sent).toHaveLength(1);
    expect(await rowsOf(db)).toEqual({ sites: 1, checks: 1, rateLimits: 3 });
  });

  it('a queued check an account has kept: the same check, and the pipeline is sent nothing', async () => {
    const h = harness(db);
    await h.start();
    const account = await accountOf(db, await signUp(db, 'owner@example.org'));
    await db.query(`update public.sites set account_id = $1`, [account.id]);
    await db.query(`update public.checks set expires_at = null`);
    expect(await h.start()).toEqual({ ok: true, checkId: CHECK, created: false });
    expect(h.sent).toHaveLength(1);
    expect(await rowsOf(db)).toEqual({ sites: 1, checks: 1, rateLimits: 3 });
  });

  it('makes the check again, under the same id, once its rows were deleted', async () => {
    const h = harness(db);
    await h.start();
    await db.query('delete from public.sites');
    expect(await rowsOf(db)).toEqual(expect.objectContaining({ sites: 0, checks: 0 }));
    expect(await h.start()).toEqual({ ok: true, checkId: CHECK, created: true });
    expect(await rowsOf(db)).toEqual(expect.objectContaining({ sites: 1, checks: 1 }));
    expect(h.sent.map((e) => e.id)).toEqual([EVENT, EVENT]);
  });

  it('queues the check when only the site row was written the first time', async () => {
    await sqlStartStore(db).insertUnkeptSite(SITE, 'example.com');
    const h = harness(db);
    expect(await h.start()).toEqual({ ok: true, checkId: CHECK, created: true });
    expect(await rowsOf(db)).toEqual(expect.objectContaining({ sites: 1, checks: 1 }));
  });

  it('refuses when an account keeps the derived site and the derived check is gone', async () => {
    const account = await accountOf(db, await signUp(db, 'owner@example.org'));
    await db.query(`insert into public.sites (id, host, account_id) values ($1, $2, $3)`, [
      SITE,
      'example.com',
      account.id,
    ]);
    const h = harness(db);
    expect(await h.start()).toEqual({
      ok: false,
      status: 409,
      body: { code: 'request_spent', error: 'This request was already used. Start a new audit.' },
    });
    expect(h.sent).toEqual([]);
    expect(await rowsOf(db)).toEqual({ sites: 1, checks: 0, rateLimits: 0 });
  });
});

describe('two starts', () => {
  it('one request id and two hosts are two checks', async () => {
    const h = harness(db);
    const a = await h.start();
    const b = await h.start({ url: 'https://other.example/' });
    expect(b).toEqual({
      ok: true,
      checkId: publicCheckId(REQUEST, 'other.example'),
      created: true,
    });
    expect(b).not.toEqual(a);
    expect(await rowsOf(db)).toEqual(expect.objectContaining({ sites: 2, checks: 2 }));
  });

  it('two request ids and one host are two sites and two checks', async () => {
    const h = harness(db);
    const a = await h.start();
    const b = await h.start({ requestId: '3c2b1a09-8f7e-4d6c-9b5a-4a3b2c1d0e9f' });
    expect(a.ok && b.ok && a.checkId !== b.checkId).toBe(true);
    expect(await rowsOf(db)).toEqual(expect.objectContaining({ sites: 2, checks: 2 }));
    expect(new Set(h.sent.map((e) => e.id)).size).toBe(2);
  });
});

describe('hosts that are not public', () => {
  it.each([
    'http://127.0.0.1/',
    'http://localhost/',
    'http://10.1.2.3/',
    'http://192.168.0.10/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[::ffff:10.0.0.1]/',
    'http://2130706433/',
    'http://0x7f.1/',
    'https://user:pw@example.com/',
    'ftp://example.com/',
    'file:///etc/passwd',
    'https://does-not-resolve.example/',
  ])('%s is refused with the fixed answer and no row', async (url) => {
    const h = harness(db);
    expect(await h.start({ url })).toEqual({ ok: false, ...INVALID_URL });
    expect(await rowsOf(db)).toEqual(NOTHING);
    expect(h.sent).toEqual([]);
  });

  it.each([
    ['a loopback address', ['127.0.0.1']],
    ['a private address', ['10.0.0.5']],
    ['the metadata address', ['169.254.169.254']],
    ['a private address after a public one', [PUBLIC_ADDRESS, '192.168.1.1']],
    ['an IPv4-mapped private address', ['::ffff:10.0.0.1']],
    ['IPv6 loopback', ['::1']],
  ])('a name that resolves to %s is refused with no row', async (_, addresses) => {
    dns.set('intranet.example.com', addresses);
    const h = harness(db);
    expect(await h.start({ url: 'https://intranet.example.com/' })).toEqual({
      ok: false,
      ...INVALID_URL,
    });
    expect(await rowsOf(db)).toEqual(NOTHING);
    expect(h.sent).toEqual([]);
  });

  it('the same name resolving to a public address is started (the refusals above are the guard’s)', async () => {
    dns.set('intranet.example.com', [PUBLIC_ADDRESS]);
    expect(await harness(db).start({ url: 'https://intranet.example.com/' })).toEqual(
      expect.objectContaining({ ok: true, created: true }),
    );
  });

  describe('addresses generated from the private and reserved ranges, in several spellings', () => {
    // The ranges, written here from the RFCs and not read from the guard: 0/8, 10/8, 127/8,
    // 169.254/16, 172.16/12, 192.168/16 and 100.64/10.
    const RANGES: Array<[base: number, prefix: number]> = [
      [0x00000000, 8],
      [0x0a000000, 8],
      [0x7f000000, 8],
      [0xa9fe0000, 16],
      [0xac100000, 12],
      [0xc0a80000, 16],
      [0x64400000, 10],
    ];
    const v4 = fc
      .tuple(fc.constantFrom(...RANGES), fc.integer({ min: 0, max: 0xffffffff }))
      .map(([[base, prefix], bits]) => (base + (bits >>> prefix)) >>> 0);
    const dotted = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    const hexPair = (n: number) => `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
    const hex = (max: number) => fc.integer({ min: 0, max }).map((n) => n.toString(16));

    // The guard reads an IPv4-compatible, NAT64 or 6to4 address from two hex groups, and a group of
    // zeros can be written away (`2002:a00::1`, `64:ff9b::5`); those spellings are generated for
    // addresses whose two halves are both non-zero. The gap is the engine's and is in the report.
    const bothHalves = v4.filter((n) => n >>> 16 !== 0 && (n & 0xffff) !== 0);

    /** One resolved address of the class: an IPv4 one in a spelling that embeds it, or an IPv6 one. */
    const resolved = fc.oneof(
      v4.map(dotted),
      v4.map((n) => `::ffff:${dotted(n)}`),
      v4.map((n) => `::ffff:${hexPair(n)}`),
      v4.map((n) => `0:0:0:0:0:ffff:${hexPair(n)}`),
      bothHalves.map((n) => `::${dotted(n)}`),
      bothHalves.map((n) => `64:ff9b::${hexPair(n)}`),
      bothHalves.map((n) => `2002:${hexPair(n)}::1`),
      fc.constantFrom('::1', '::', '0:0:0:0:0:0:0:1'),
      fc
        .tuple(fc.integer({ min: 0xfe80, max: 0xfebf }), hex(0xffff))
        .map(([head, tail]) => `${head.toString(16)}::${tail}`),
      fc
        .tuple(fc.integer({ min: 0xfc00, max: 0xfdff }), hex(0xffff), hex(0xffff))
        .map(([head, mid, tail]) => `${head.toString(16)}:${mid}::${tail}`),
    );
    /** The same IPv4 address typed as the URL's host. */
    const typed = fc.oneof(
      v4.map((n) => `http://${dotted(n)}/`),
      v4.map((n) => `http://${n}/`),
      v4.map((n) => `https://0x${n.toString(16)}/`),
      v4.map((n) => `http://[::ffff:${hexPair(n)}]/`),
    );

    let shared: PGlite;
    beforeAll(async () => {
      shared = await doorDb();
    });

    it('a name resolving to it is refused and no site, check or bucket row is written', async () => {
      await fc.assert(
        fc.asyncProperty(resolved, fc.boolean(), async (address, behindPublic) => {
          expect(net.isIP(address)).not.toBe(0);
          dns.set('target.example.com', behindPublic ? [PUBLIC_ADDRESS, address] : [address]);
          admin.client = postgrestOver(shared);
          const h = harness(shared);
          expect(await h.start({ url: 'https://target.example.com/' })).toEqual({
            ok: false,
            ...INVALID_URL,
          });
          expect(await rowsOf(shared)).toEqual(NOTHING);
          expect(h.sent).toEqual([]);
        }),
        { numRuns: 300 },
      );
    });

    it('typed as the host, it is refused and no site, check or bucket row is written', async () => {
      await fc.assert(
        fc.asyncProperty(typed, async (url) => {
          admin.client = postgrestOver(shared);
          const h = harness(shared);
          expect(await h.start({ url })).toEqual({ ok: false, ...INVALID_URL });
          expect(await rowsOf(shared)).toEqual(NOTHING);
          expect(h.sent).toEqual([]);
        }),
        { numRuns: 200 },
      );
    });
  });
});
