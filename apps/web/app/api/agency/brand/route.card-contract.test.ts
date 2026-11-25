import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_LOGO_BYTES } from '../../../../lib/logo-validation';

// The Settings Branding card against the real route (V2R register row 24): each body the card's own
// `brandBody` builds is posted to this handler, with Supabase mocked as route.test.ts mocks it, and
// the handler's real answer is fed to the card's `brandOutcome`. A change to a status, a code or a
// reason the route answers with then fails here, not only in hand-written responses.

const ACCOUNT = 'aaaaaaaa-1111-4111-8111-111111111111';
const URL_ = `https://crawlmouse.com/api/agency/brand?account=${ACCOUNT}`;

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

import { fixture } from '../../../../lib/v2/fixtures';
import { brandBody, brandOutcome, type BrandMessages } from '../../../../lib/v2/view/brand-card';
import { settingsView } from '../../../../lib/v2/view/settings';
import { POST } from './route';

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

const d = fixture('challenged-site');
const messages: BrandMessages = settingsView(d, {
  accountId: 'a0000000-0000-4000-8000-0000000000c9',
  now: d.as_of,
}).branding!.messages;

/** Post what the card would post, and say the route's answer as the card would. */
async function card(name: string, logo: File | null = null) {
  const res = await POST(new Request(URL_, { method: 'POST', body: brandBody(name, logo) }));
  return { status: res.status, outcome: brandOutcome(res.status, await res.json(), messages) };
}

const file = (bytes: Uint8Array, name = 'logo.png') =>
  new File([bytes as BlobPart], name, { type: 'image/png' });

beforeEach(() => {
  vi.stubEnv('V2_ACCOUNT_DOOR', '1');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.co');
  h.user = { id: 'u-1', email: 'a@b.co' };
  h.roles = { [ACCOUNT]: 'owner' };
  h.roleError = null;
  h.accounts = { [ACCOUNT]: accountRow('agency') };
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

describe('the card’s body, through the real route, said as the card says it', () => {
  it('200: saved, with the stored name and the stored logo’s https URL', async () => {
    const bytes = png(10, 10);
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    expect(await card('  Acme Agency ', file(bytes))).toEqual({
      status: 200,
      outcome: {
        ok: true,
        agencyName: 'Acme Agency',
        logoUrl: `https://ref.supabase.co/storage/v1/object/public/report-logos/agency/${ACCOUNT}/${hash}.png`,
        hasLogo: true,
      },
    });
  });

  it('200 with no logo stored: no URL, and no logo', async () => {
    expect(await card('Acme Agency')).toEqual({
      status: 200,
      outcome: { ok: true, agencyName: 'Acme Agency', logoUrl: null, hasLogo: false },
    });
  });

  it('400 invalid_name: the name rule, under the name', async () => {
    expect(await card('acme.com')).toEqual({
      status: 400,
      outcome: {
        ok: false,
        field: 'name',
        text: 'Use 1 to 60 characters, with no @, colon or slash, no dot followed by another character, and no number of 7 digits or more.',
      },
    });
  });

  it.each([
    [
      'an SVG',
      file(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')),
      'That file is not a PNG, JPEG or WebP image.',
    ],
    ['an empty file', file(new Uint8Array(0)), 'That file is empty. Choose an image.'],
    [
      'a PNG 0 pixels wide',
      file(png(0, 16)),
      'That logo must be between 1 and 4,096 pixels on each side.',
    ],
    [
      'a PNG 4,097 pixels wide',
      file(png(4097, 16)),
      'That logo must be between 1 and 4,096 pixels on each side.',
    ],
    [
      'a truncated PNG',
      file(png(10, 10).subarray(0, 20)),
      'That image could not be read. Export it again and choose the new file.',
    ],
    [
      'a logo over 200 KB',
      file(png(10, 10, MAX_LOGO_BYTES)),
      'That logo is over 200 KB. Choose a smaller file.',
    ],
  ])('400 invalid_logo for %s: its sentence, under the logo', async (_l, logo, text) => {
    expect(await card('Acme Agency', logo)).toEqual({
      status: 400,
      outcome: { ok: false, field: 'logo', text },
    });
  });

  it('413: a body over the cap, said as the logo’s size', async () => {
    expect(await card('Acme Agency', file(png(10, 10, 2 * MAX_LOGO_BYTES)))).toEqual({
      status: 413,
      outcome: {
        ok: false,
        field: 'logo',
        text: 'That logo is over 200 KB. Choose a smaller file.',
      },
    });
  });

  it('429: the sixth save in an hour', async () => {
    for (let i = 0; i < 5; i++) expect((await card('Acme Agency')).status).toBe(200);
    expect(await card('Acme Agency')).toEqual({
      status: 429,
      outcome: {
        ok: false,
        field: null,
        text: 'Branding can be saved five times an hour. Try again in an hour.',
      },
    });
  });

  it('401: signed out, with the sign-in link', async () => {
    h.user = null;
    expect(await card('Acme Agency')).toEqual({
      status: 401,
      outcome: {
        ok: false,
        field: null,
        text: 'Your session has ended. Sign in again, then save.',
        link: { label: 'Sign in', href: '/login?next=/settings' },
      },
    });
  });

  it('403 role_refused: a developer seat', async () => {
    h.roles = { [ACCOUNT]: 'developer' };
    expect(await card('Acme Agency')).toEqual({
      status: 403,
      outcome: {
        ok: false,
        field: null,
        text: 'Your role on this account cannot set branding. The owner or an account manager can.',
      },
    });
  });

  it('403 upgrade_required: a Pro account', async () => {
    h.accounts = { [ACCOUNT]: accountRow('pro') };
    expect(await card('Acme Agency')).toEqual({
      status: 403,
      outcome: { ok: false, field: null, text: 'This account’s plan does not include branding.' },
    });
  });

  it('404: agency_white_label hidden', async () => {
    vi.stubEnv('V2_HIDE_FEATURES', 'agency_white_label');
    expect(await card('Acme Agency')).toEqual({
      status: 404,
      outcome: { ok: false, field: null, text: 'Branding is not available right now.' },
    });
  });
});
