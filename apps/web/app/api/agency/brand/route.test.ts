import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_LOGO_BYTES } from '../../../../lib/logo-validation';

// POST /api/agency/brand (Goal 1 row 24): an Agency account's brand name and optional logo. Supabase
// is mocked at the client boundary. The session client answers `member_role` from `h.roles` and the
// `accounts` read from `h.accounts`, only for an account the caller sits on, as row security would.
// The service-role client records each storage upload and each `agency_brands` upsert; every refusal
// below asserts that neither happened.

const ACCOUNT = 'aaaaaaaa-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const URL_ = 'https://crawlmouse.com/api/agency/brand';
/** The route's address naming `account` in its query string, or naming none for null. */
const AT = (account: string | null = ACCOUNT) =>
  account === null ? URL_ : `${URL_}?account=${encodeURIComponent(account)}`;

const h = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  roles: {} as Record<string, string | null>,
  roleError: null as { message: string } | null,
  accounts: {} as Record<string, Record<string, unknown>>,
  log: [] as string[],
  rpcArgs: [] as unknown[],
  uploads: [] as {
    bucket: string;
    path: string;
    bytes: Uint8Array;
    opts: Record<string, unknown>;
  }[],
  uploadError: null as Record<string, unknown> | null,
  upserts: [] as { table: string; row: Record<string, unknown>; opts: unknown }[],
  upsertError: null as { message: string } | null,
  storedLogo: null as string | null,
  buckets: new Map<string, number>(),
  rateCalls: [] as { key: string; limit: number; windowMs: number; opts: unknown }[],
  validateCalls: 0,
}));

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: () => undefined }));

vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => {
    h.log.push('supabaseServer');
    return {
      auth: {
        getUser: async () => {
          h.log.push('getUser');
          return { data: { user: h.user }, error: null };
        },
      },
      rpc: async (fn: string, args: { p_account: string }) => {
        h.log.push(`session.rpc ${fn}`);
        h.rpcArgs.push(args);
        if (h.roleError) return { data: null, error: h.roleError };
        return { data: h.roles[args.p_account] ?? null, error: null };
      },
      from: (table: string) => {
        h.log.push(`session.from ${table}`);
        let id = '';
        const q = {
          select: () => q,
          eq: (col: string, v: string) => {
            if (col === 'id') id = v;
            return q;
          },
          is: () => q,
          maybeSingle: async () => ({
            data: h.roles[id] ? (h.accounts[id] ?? null) : null,
            error: null,
          }),
        };
        return q;
      },
    };
  },
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    return {
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string, bytes: Uint8Array, opts: Record<string, unknown>) => {
            h.uploads.push({ bucket, path, bytes, opts });
            return h.uploadError
              ? { data: null, error: h.uploadError }
              : { data: { path }, error: null };
          },
        }),
      },
      from: (table: string) => ({
        upsert: (row: Record<string, unknown>, opts: unknown) => {
          h.upserts.push({ table, row, opts });
          const q = {
            select: () => q,
            single: async () =>
              h.upsertError
                ? { data: null, error: h.upsertError }
                : {
                    data: {
                      agency_name: row.agency_name,
                      logo_path: 'logo_path' in row ? row.logo_path : h.storedLogo,
                    },
                    error: null,
                  },
          };
          return q;
        },
      }),
    };
  },
}));

// A counter with the `rate_limits` increment's behaviour: each call counts, and a call past the
// limit in the window is refused.
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (key: string, limit: number, windowMs: number, opts: unknown) => {
    h.rateCalls.push({ key, limit, windowMs, opts });
    const n = (h.buckets.get(key) ?? 0) + 1;
    h.buckets.set(key, n);
    return { allowed: n <= limit, remaining: Math.max(0, limit - n), resetAt: new Date() };
  },
}));

// The real validator, counted, so a test can show the bytes never reached it.
vi.mock('@/lib/logo-validation', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../lib/logo-validation')>();
  return {
    ...real,
    validateLogo: (bytes: Uint8Array) => {
      h.validateCalls++;
      return real.validateLogo(bytes);
    },
  };
});

import { handleEdge } from '../../../../middleware';
import { POST } from './route';

// ─── fixtures ───────────────────────────────────────────────────────────────────────────────────

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
/** A PNG signature and IHDR chunk with the given dimensions, then `pad` zero bytes. */
function png(w: number, hgt: number, pad = 0): Uint8Array {
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...[0, 0, 0, 13],
    ...ascii('IHDR'),
    ...be32(w),
    ...be32(hgt),
    8,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    ...new Array<number>(pad).fill(0),
  ]);
}

function accountRow(tier: 'free' | 'pro' | 'agency', id = ACCOUNT): Record<string, unknown> {
  return {
    id,
    kind: tier === 'agency' ? 'agency' : 'personal',
    name: 'Acme',
    state: tier,
    tier,
    past_due_tier: null,
    past_due_since: null,
    trial_variant: null,
    trial_ends_at: null,
    trial_used_at: null,
    timezone: 'UTC',
    seat_limit: 5,
    site_limit: 25,
    competitor_limit: 3,
    state_history: [],
  };
}

interface Fields {
  /** The query string's account; null sends none. */
  account?: string | null;
  /** An `accountId` field in the body, which the route must not read. */
  formAccountId?: string;
  agencyName?: string | null;
  logo?: { bytes: Uint8Array; name?: string; type?: string } | null;
}

function form(f: Fields = {}): FormData {
  const fd = new FormData();
  if (f.formAccountId !== undefined) fd.append('accountId', f.formAccountId);
  const name = f.agencyName === undefined ? 'Acme Agency' : f.agencyName;
  if (name !== null) fd.append('agencyName', name);
  if (f.logo) {
    fd.append(
      'logo',
      new File([f.logo.bytes as BlobPart], f.logo.name ?? 'logo.png', {
        type: f.logo.type ?? 'image/png',
      }),
    );
  }
  return fd;
}

/** The last request `post` sent, and how many of its body bytes the route pulled. */
let last: { req: Request; seen: { pulled: number } } | null = null;

/** POST the form as a counted stream, so a test can say whether the route read the body. */
async function post(f: Fields = {}): Promise<Response> {
  const { bytes, type } = await encoded(f);
  last = streamed(bytes, type, {}, AT(f.account));
  return POST(last.req);
}

/** The last request's body was never read: no reader took it, and at most the first chunk queued. */
function expectBodyUnread() {
  expect(last?.req.bodyUsed).toBe(false);
  expect(last?.seen.pulled).toBeLessThanOrEqual(4096);
}

/** The form's encoded bytes and its multipart content type, as a browser would send them. */
async function encoded(f: Fields): Promise<{ bytes: Uint8Array; type: string }> {
  const res = new Response(form(f));
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    type: res.headers.get('content-type') ?? '',
  };
}

/** A body stream that counts the bytes the route pulls from it. */
function countedStream(bytes: Uint8Array, chunk = 4096) {
  const seen = { pulled: 0 };
  let at = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (at >= bytes.length) return c.close();
      const part = bytes.subarray(at, at + chunk);
      at += part.length;
      seen.pulled += part.length;
      c.enqueue(part);
    },
  });
  return { stream, seen };
}

function streamed(
  bytes: Uint8Array,
  type: string,
  headers: Record<string, string> = {},
  url = AT(),
) {
  const { stream, seen } = countedStream(bytes);
  const req = new Request(url, {
    method: 'POST',
    headers: { 'content-type': type, ...headers },
    body: stream,
    duplex: 'half',
  } as RequestInit);
  return { req, seen };
}

const sha16 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex').slice(0, 16);

function expectNoWrite() {
  expect(h.uploads).toEqual([]);
  expect(h.upserts).toEqual([]);
}

beforeEach(() => {
  vi.stubEnv('V2_ACCOUNT_DOOR', '1');
  h.user = { id: 'u-1', email: 'a@b.co' };
  h.roles = { [ACCOUNT]: 'owner' };
  h.roleError = null;
  h.accounts = { [ACCOUNT]: accountRow('agency'), [OTHER]: accountRow('agency', OTHER) };
  h.log = [];
  h.rpcArgs = [];
  h.uploads = [];
  h.uploadError = null;
  h.upserts = [];
  h.upsertError = null;
  h.storedLogo = null;
  h.buckets = new Map();
  h.rateCalls = [];
  h.validateCalls = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ─── 1. same-origin ─────────────────────────────────────────────────────────────────────────────

async function throughEdge(headers: Record<string, string>) {
  const init = { method: 'POST', headers, body: form() };
  const edge = await handleEdge(
    new NextRequest(new Request(AT(), init)),
    (r) => Promise.resolve(NextResponse.next({ request: r })),
    () => {},
  );
  if (edge.headers.get('x-middleware-next') !== '1') return edge;
  return POST(new Request(AT(), { method: 'POST', headers, body: form() }));
}

/** The refusal's advice, written out: what a refused agency name must change. */
const NAME_RULE =
  'Use 1 to 60 characters, with no @, colon or slash, no dot followed by another character, and no number of 7 digits or more.';

describe('1. same-origin POST', () => {
  it('refuses another site’s Origin with 403 cross_site before the route runs', async () => {
    const res = await throughEdge({ origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Cross-site request refused', code: 'cross_site' });
    expect(h.log).toEqual([]);
    expectNoWrite();
  });

  it('lets our own page’s multipart post through to the route (the control)', async () => {
    const res = await throughEdge({ origin: 'https://crawlmouse.com' });
    expect(res.status).toBe(200);
    expect(h.log).toContain('getUser');
  });
});

// ─── 2. feature switch ──────────────────────────────────────────────────────────────────────────

describe('2. feature switch', () => {
  it('answers 404 while the account door is off, with the body unread and no session read', async () => {
    vi.stubEnv('V2_ACCOUNT_DOOR', '');
    const { bytes, type } = await encoded({ logo: { bytes: png(10, 10) } });
    const { req, seen } = streamed(bytes, type);
    const res = await POST(req);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'not_found' });
    expect(req.bodyUsed).toBe(false);
    expect(seen.pulled).toBeLessThanOrEqual(4096);
    expect(h.log).toEqual([]);
    expectNoWrite();
  });

  it('answers 404 while agency_white_label is hidden, with the body unread and no session read', async () => {
    vi.stubEnv('V2_HIDE_FEATURES', 'agency_white_label');
    const { bytes, type } = await encoded({ logo: { bytes: png(10, 10) } });
    const { req, seen } = streamed(bytes, type);
    const res = await POST(req);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'not_found' });
    expect(req.bodyUsed).toBe(false);
    expect(seen.pulled).toBeLessThanOrEqual(4096);
    expect(h.log).toEqual([]);
    expectNoWrite();
  });
});

// ─── 3. signed in ───────────────────────────────────────────────────────────────────────────────

describe('3. signed in', () => {
  it('401 auth_required when signed out, with the body unread', async () => {
    h.user = null;
    const { bytes, type } = await encoded({});
    const { req } = streamed(bytes, type);
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'auth_required' });
    expect(req.bodyUsed).toBe(false);
    expect(h.log).not.toContain('supabaseAdmin');
    expectNoWrite();
  });
});

// ─── 4. role ────────────────────────────────────────────────────────────────────────────────────

describe('4. role, from member_role through the caller’s session', () => {
  it.each(['owner', 'account_manager'])('lets a %s save', async (role) => {
    h.roles = { [ACCOUNT]: role };
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.rpcArgs).toEqual([{ p_account: ACCOUNT }]);
    // the role is asked of the caller's session, before any service-role client exists
    expect(h.log.indexOf('session.rpc member_role')).toBeLessThan(h.log.indexOf('supabaseAdmin'));
  });

  it.each([['developer'], ['viewer'], [null]])(
    'refuses role %s with 403 role_refused and writes nothing',
    async (role) => {
      h.roles = { [ACCOUNT]: role };
      const res = await post();
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ code: 'role_refused' });
      expect(h.log).not.toContain('supabaseAdmin');
      expectBodyUnread();
      expectNoWrite();
    },
  );

  it('answers an account the caller is not a member of exactly as a developer seat, so it says nothing about the account', async () => {
    h.roles = { [ACCOUNT]: 'developer' };
    const developer = await post();
    h.roles = { [ACCOUNT]: 'owner' }; // the caller owns ACCOUNT, and has no seat on OTHER
    const stranger = await post({ account: OTHER });
    expect(h.rpcArgs).toContainEqual({ p_account: OTHER });
    expect(stranger.status).toBe(developer.status);
    expect(await stranger.json()).toEqual(await developer.json());
    expectBodyUnread();
    expectNoWrite();
  });

  it('400 for a missing or malformed account in the query string, before member_role', async () => {
    for (const account of [null, '', 'not-a-uuid', ACCOUNT.toUpperCase()]) {
      const res = await post({ account });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: 'invalid' });
      expectBodyUnread();
    }
    expect(h.rpcArgs).toEqual([]);
    expectNoWrite();
  });

  it('ignores an accountId field in the body: the query string names the account', async () => {
    // the caller owns ACCOUNT and has no seat on OTHER, which the body names
    const res = await post({ formAccountId: OTHER });
    expect(res.status).toBe(200);
    expect(h.rpcArgs).toEqual([{ p_account: ACCOUNT }]);
    expect(h.upserts.map((u) => u.row.account_id)).toEqual([ACCOUNT]);
    // and a body naming the caller's own account does not open one the query names
    h.roles = { [ACCOUNT]: 'owner' };
    const other = await post({ account: OTHER, formAccountId: ACCOUNT });
    expect(other.status).toBe(403);
    expect(h.upserts).toHaveLength(1);
  });

  it('refuses a non-member with 403 before reading the body, even one declared over the limit', async () => {
    h.roles = {};
    const { bytes, type } = await encoded({ logo: { bytes: png(10, 10, 2 * MAX_LOGO_BYTES) } });
    const { req, seen } = streamed(bytes, type, { 'content-length': String(bytes.length) });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: 'role_refused' });
    expect(req.bodyUsed).toBe(false);
    expect(seen.pulled).toBeLessThanOrEqual(4096);
    expectNoWrite();
  });

  it('500 with no detail when member_role errors, and writes nothing', async () => {
    h.roleError = { message: 'permission denied for function member_role' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 'internal' });
    expectNoWrite();
  });
});

// ─── 5. tier ────────────────────────────────────────────────────────────────────────────────────

describe('5. tier', () => {
  it.each(['free', 'pro'] as const)(
    'refuses a %s account with 403 upgrade_required',
    async (tier) => {
      h.accounts[ACCOUNT] = accountRow(tier);
      const res = await post();
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ code: 'upgrade_required', gate: 'agencyBranding' });
      expect(h.rateCalls).toEqual([]);
      expectBodyUnread();
      expectNoWrite();
    },
  );

  it('refuses an Agency account whose past-due grace has run out (the effective tier, not the column)', async () => {
    h.accounts[ACCOUNT] = {
      ...accountRow('agency'),
      state: 'past_due',
      past_due_tier: 'agency',
      past_due_since: '2020-01-01T00:00:00Z',
    };
    const res = await post();
    expect(res.status).toBe(403);
    expectBodyUnread();
    expectNoWrite();
  });

  it('refuses with 403 when the caller’s session cannot read the account', async () => {
    delete h.accounts[ACCOUNT];
    const res = await post();
    expect(res.status).toBe(403);
    expectBodyUnread();
    expectNoWrite();
  });
});

// ─── 6. rate limit ──────────────────────────────────────────────────────────────────────────────

describe('6. rate limit', () => {
  it('the 6th upload in an hour for the account is 429 rate_limited, and is not written', async () => {
    for (let i = 0; i < 5; i++) expect((await post()).status).toBe(200);
    h.uploads = [];
    h.upserts = [];
    const sixth = await post();
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toEqual({ code: 'rate_limited' });
    expectBodyUnread();
    expectNoWrite();
    expect(h.rateCalls.at(-1)).toEqual({
      key: `agency-brand:${ACCOUNT}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
      opts: { failClosed: true },
    });
  });

  it('refuses an over-limit caller with 429 before reading the body, even one declared over the limit', async () => {
    for (let i = 0; i < 5; i++) expect((await post()).status).toBe(200);
    h.uploads = [];
    h.upserts = [];
    const { bytes, type } = await encoded({ logo: { bytes: png(10, 10, 2 * MAX_LOGO_BYTES) } });
    const { req, seen } = streamed(bytes, type, { 'content-length': String(bytes.length) });
    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(req.bodyUsed).toBe(false);
    expect(seen.pulled).toBeLessThanOrEqual(4096);
    expectNoWrite();
  });
});

// ─── 7. brand name ──────────────────────────────────────────────────────────────────────────────

describe('7. brand name', () => {
  it.each([
    ['missing', null],
    ['empty', ''],
    ['whitespace only', ' \t\n  '],
    ['control characters only', '\u0000\u0007\u009f‮'],
    ['61 characters', 'a'.repeat(61)],
  ])('refuses a %s name with 400 invalid_name and writes nothing', async (_label, agencyName) => {
    const res = await post({ agencyName });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'invalid_name', message: NAME_RULE });
    expectNoWrite();
  });

  it('accepts 60 characters, counted as characters rather than UTF-16 units', async () => {
    const sixty = '🦊'.repeat(60);
    const res = await post({ agencyName: sixty });
    expect(res.status).toBe(200);
    expect(h.upserts[0]?.row.agency_name).toBe(sixty);
  });

  it('strips C0, C1 and bidi controls and trims, storing plain text', async () => {
    const raw = '  ‪A\u0000c\u001f\u007fm\u0085e\u009f ‫<b>‬&‭‮ ⁦Co⁧⁨⁩\t ';
    const res = await post({ agencyName: raw });
    expect(res.status).toBe(200);
    expect(h.upserts[0]?.row.agency_name).toBe('Acme <b>& Co');
    expect(await res.json()).toMatchObject({ agencyName: 'Acme <b>& Co' });
  });
});

describe('7b. brand name: format characters and separators', () => {
  it.each([
    ['LRM U+200E', '\u200e'],
    ['RLM U+200F', '\u200f'],
    ['ALM U+061C', '\u061c'],
    ['ZWSP U+200B', '\u200b'],
    ['ZWNJ U+200C', '\u200c'],
    ['ZWJ U+200D', '\u200d'],
    ['BOM U+FEFF', '\ufeff'],
    ['line separator U+2028', '\u2028'],
    ['paragraph separator U+2029', '\u2029'],
  ])('strips the %s from the stored name', async (_label, ch) => {
    const res = await post({ agencyName: `${ch}Acme${ch} Co${ch}` });
    expect(res.status).toBe(200);
    expect(h.upserts[0]?.row.agency_name).toBe('Acme Co');
  });

  it('refuses a name made of them alone with 400 invalid_name', async () => {
    const res = await post({
      agencyName: '\u200e\u200f\u061c\u200b\u200c\u200d\ufeff\u2028\u2029',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'invalid_name', message: NAME_RULE });
    expectNoWrite();
  });
});

describe('7c. brand name that reads as a link or an address', () => {
  it.each([
    ['a host in a sentence', 'Acme reset at evil.tld'],
    ['an https URL', 'https://evil.example/reset'],
    ['an email address', 'help@evil.example'],
    ['a host split by a zero-width space', 'evil\u200b.tld now'],
    ['a dot between letters, as in a brand name like J.Crew', 'J.Crew Studio'],
    ['a telephone-length number', 'Acme 0800 123 4567'],
  ])('refuses %s with 400 invalid_name and writes nothing', async (_label, agencyName) => {
    const res = await post({ agencyName });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'invalid_name', message: NAME_RULE });
    expectNoWrite();
  });

  it('accepts an ordinary name with a trailing full stop (the control)', async () => {
    const res = await post({ agencyName: 'Acme Partners Inc.' });
    expect(res.status).toBe(200);
    expect(h.upserts[0]?.row.agency_name).toBe('Acme Partners Inc.');
  });
});

// ─── 8. logo ────────────────────────────────────────────────────────────────────────────────────

describe('8. logo', () => {
  it('refuses an SVG with 400 unsupported_type, whatever it is called', async () => {
    const svg = Uint8Array.from(
      ascii('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
    );
    const res = await post({ logo: { bytes: svg, name: 'logo.png', type: 'image/png' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'invalid_logo', reason: 'unsupported_type' });
    expectNoWrite();
  });

  it('stores a PNG sent as logo.jpg / image/jpeg as a PNG: the detected type wins', async () => {
    const bytes = png(120, 48);
    const res = await post({ logo: { bytes, name: 'logo.jpg', type: 'image/jpeg' } });
    expect(res.status).toBe(200);
    expect(h.uploads[0]?.opts.contentType).toBe('image/png');
    expect(h.uploads[0]?.path).toBe(`agency/${ACCOUNT}/${sha16(bytes)}.png`);
  });

  it('refuses a declared Content-Length over the limit with 413 before reading the body', async () => {
    const { bytes, type } = await encoded({ logo: { bytes: png(10, 10, 2 * MAX_LOGO_BYTES) } });
    const { req, seen } = streamed(bytes, type, { 'content-length': String(bytes.length) });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ code: 'too_large' });
    expect(req.bodyUsed).toBe(false);
    expect(seen.pulled).toBeLessThanOrEqual(4096);
    expect(h.validateCalls).toBe(0);
    expectNoWrite();
  });

  it('stops reading at the cap a body larger than it declared, with 413', async () => {
    const { bytes, type } = await encoded({ logo: { bytes: png(10, 10, 2 * MAX_LOGO_BYTES) } });
    const { req, seen } = streamed(bytes, type, { 'content-length': '1000' });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(seen.pulled).toBeLessThan(bytes.length);
    // the cap, plus at most the chunk the stream's queue had already pulled ahead
    expect(seen.pulled).toBeLessThanOrEqual(MAX_LOGO_BYTES + 16 * 1024 + 2 * 4096);
    expect(h.validateCalls).toBe(0);
    expectNoWrite();
  });

  it('refuses a logo whose real size is over 200 KB though the request declared a small one', async () => {
    const big = png(10, 10, MAX_LOGO_BYTES - 32); // a little over 200 KB in all
    expect(big.length).toBeGreaterThan(MAX_LOGO_BYTES);
    const { bytes, type } = await encoded({ logo: { bytes: big } });
    const { req } = streamed(bytes, type, { 'content-length': '1000' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'invalid_logo', reason: 'too_large' });
    // refused on the part's size, before its bytes are handed to the validator
    expect(h.validateCalls).toBe(0);
    expectNoWrite();
  });

  it('refuses a logo over 4,096 px a side with 400 bad_dimensions', async () => {
    for (const [w, hgt] of [
      [4097, 10],
      [10, 4097],
    ] as const) {
      const res = await post({ logo: { bytes: png(w, hgt) } });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: 'invalid_logo', reason: 'bad_dimensions' });
    }
    expect((await post({ logo: { bytes: png(4096, 4096) } })).status).toBe(200);
  });

  it('refuses a truncated PNG with 400 malformed', async () => {
    const res = await post({ logo: { bytes: png(10, 10).subarray(0, 20) } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'invalid_logo', reason: 'malformed' });
    expectNoWrite();
  });

  it('refuses a logo field that is text, not a file', async () => {
    const fd = form();
    fd.append('logo', 'not a file');
    const res = await POST(new Request(AT(), { method: 'POST', body: fd }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'invalid_logo', reason: 'unsupported_type' });
    expectNoWrite();
  });

  it('refuses a malformed multipart body with 400 invalid', async () => {
    const { req } = streamed(
      Uint8Array.from(ascii('--x\r\nContent-Disposition: form-data; name="agencyName"\r\n\r\nabc')),
      'multipart/form-data; boundary=x',
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'invalid' });
    expectNoWrite();
  });

  it('refuses a body that is not multipart with 415', async () => {
    const res = await POST(
      new Request(AT(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agencyName: 'Acme' }),
      }),
    );
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ code: 'unsupported_media_type' });
    expectNoWrite();
  });
});

// ─── 9. write ───────────────────────────────────────────────────────────────────────────────────

describe('9. write', () => {
  it('uploads known bytes at agency/<account>/<sha256-16>.<ext>, with upsert false and the detected type', async () => {
    const bytes = png(200, 80);
    const expected = `agency/${ACCOUNT}/${sha16(bytes)}.png`;
    const res = await post({ logo: { bytes } });
    expect(res.status).toBe(200);
    expect(h.uploads).toHaveLength(1);
    const up = h.uploads[0]!;
    expect(up.bucket).toBe('report-logos');
    expect(up.path).toBe(expected);
    expect(up.opts.upsert).toBe(false);
    expect(up.opts.contentType).toBe('image/png');
    expect(Buffer.from(up.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(h.upserts).toEqual([
      {
        table: 'agency_brands',
        row: expect.objectContaining({
          account_id: ACCOUNT,
          agency_name: 'Acme Agency',
          logo_path: expected,
        }),
        opts: { onConflict: 'account_id' },
      },
    ]);
    expect(await res.json()).toEqual({ agencyName: 'Acme Agency', logoPath: expected });
  });

  it('reuses a path that already holds the same bytes rather than overwriting it', async () => {
    const bytes = png(64, 64);
    h.uploadError = {
      message: 'The resource already exists',
      statusCode: '409',
      error: 'Duplicate',
    };
    const res = await post({ logo: { bytes } });
    expect(res.status).toBe(200);
    expect(h.uploads[0]?.opts.upsert).toBe(false);
    expect(await res.json()).toEqual({
      agencyName: 'Acme Agency',
      logoPath: `agency/${ACCOUNT}/${sha16(bytes)}.png`,
    });
  });

  it('without a logo, upserts the name only and answers the stored logo path', async () => {
    h.storedLogo = `agency/${ACCOUNT}/0123456789abcdef.webp`;
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.uploads).toEqual([]);
    expect(h.upserts[0]?.row).not.toHaveProperty('logo_path');
    expect(await res.json()).toEqual({ agencyName: 'Acme Agency', logoPath: h.storedLogo });
  });

  it('an empty file field (no bytes, no file name) is no logo: the name is saved, not a 400', async () => {
    h.storedLogo = `agency/${ACCOUNT}/0123456789abcdef.webp`;
    // Written by hand, as a browser sends a file input left empty: undici's own encoder drops an
    // empty file name and would send a text part instead.
    const b = '----empty-file-field';
    const body = new TextEncoder().encode(
      `--${b}\r\nContent-Disposition: form-data; name="agencyName"\r\n\r\nAcme Agency\r\n` +
        `--${b}\r\nContent-Disposition: form-data; name="logo"; filename=""\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n\r\n--${b}--\r\n`,
    );
    const res = await POST(streamed(body, `multipart/form-data; boundary=${b}`).req);
    expect(res.status).toBe(200);
    expect(h.uploads).toEqual([]);
    expect(h.validateCalls).toBe(0);
    expect(h.upserts[0]?.row).not.toHaveProperty('logo_path');
    expect(await res.json()).toEqual({ agencyName: 'Acme Agency', logoPath: h.storedLogo });
  });

  it('an empty file that has a name is still refused by the validator (the control)', async () => {
    const res = await post({ logo: { bytes: new Uint8Array(0), name: 'logo.png' } });
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'invalid_logo' });
    expectNoWrite();
  });

  it('a storage error is 500 upload_failed without its message, and nothing is upserted', async () => {
    h.uploadError = { message: 'secret storage detail', statusCode: '500' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post({ logo: { bytes: png(10, 10) } });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 'upload_failed' });
    expect(h.upserts).toEqual([]);
  });

  it('a missing bucket is 503 unavailable, as v1 answers it', async () => {
    h.uploadError = { message: 'Bucket not found', statusCode: '404' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post({ logo: { bytes: png(10, 10) } });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: 'unavailable' });
    expect(h.upserts).toEqual([]);
  });

  it('an upsert error is 500 save_failed without the SQL text', async () => {
    h.upsertError = { message: 'violates check constraint "agency_brands_postal"' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 'save_failed' });
  });
});
