import { createHash, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import { insertRow, ROWS } from '@/__tests__/helpers/v2-check-tables';
import {
  addSeat,
  adminOver,
  keptSite,
  makePaid,
  person,
  sessionOver,
  type Person,
} from '@/lib/v2/account/sites-test-support';
import { GONE_PAGE, isShareToken } from '@/lib/v2/reports/share';

// The share routes (CC-31 D7): POST and DELETE /api/report-files/[id]/share, and GET /s/[token].
// The session and service-role clients are the PostgREST stand-in over PGlite with every migration
// applied, so row security, `seat_may` and migration 20261114000002's share functions run for real.
// The bucket, the rate limit and the event capture are fakes: nothing here calls Storage.

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  /** Each service-role client made and each function it called. */
  log: [] as string[],
  /** How many times a route asked for the session client. */
  sessions: 0,
  capture: vi.fn(async (..._a: unknown[]) => undefined),
  signed: [] as { bucket: string; path: string; seconds: number }[],
  limits: [] as { key: string; limit: number; windowMs: number; failClosed: boolean }[],
  over: new Set<string>(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => {
    h.sessions += 1;
    return sessionOver(h.db, h.user);
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    const admin = adminOver(h.db);
    return {
      from: (table: string) => admin.from(table),
      rpc: (fn: string, args: object) => {
        h.log.push(`admin.rpc ${fn}`);
        return admin.rpc(fn, args);
      },
      storage: {
        from: (bucket: string) => ({
          createSignedUrl: async (path: string, seconds: number) => {
            h.signed.push({ bucket, path, seconds });
            return {
              data: { signedUrl: `https://files.example/${path}?signed=1` },
              error: null,
            };
          },
        }),
      },
    };
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (
    key: string,
    limit: number,
    windowMs: number,
    opts?: { failClosed?: boolean },
  ) => {
    h.limits.push({ key, limit, windowMs, failClosed: opts?.failClosed === true });
    return {
      allowed: !h.over.has(key.split(':')[0]!),
      remaining: 0,
      resetAt: new Date(Date.now() + 90_000),
    };
  },
}));
vi.mock('@/lib/v2/agency/events', async (original) => ({
  ...(await original<typeof import('@/lib/v2/agency/events')>()),
  agencyCaptureFor: () => h.capture,
}));

import { GET as OPEN } from '../../../../s/[token]/route';
import { DELETE, POST } from './route';

const ORIGIN = 'https://crawlmouse.com';
const FORM = 'application/x-www-form-urlencoded';
const IP = '203.0.113.9';
const sha256 = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});

beforeEach(() => {
  h.user = null;
  h.log.length = 0;
  h.sessions = 0;
  h.signed.length = 0;
  h.limits.length = 0;
  h.over = new Set();
  h.capture.mockClear();
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', ORIGIN);
});
afterEach(() => vi.unstubAllEnvs());

const as = (p: Pick<Person, 'id' | 'email'> | null) => {
  h.user = p && { id: p.id, email: p.email };
};

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function request(path: string, method: string, body?: string, type = 'application/json') {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      'x-forwarded-for': IP,
      ...(body === undefined ? {} : { 'content-type': type }),
    },
    ...(body === undefined ? {} : { body }),
  });
}

const share = (id: string) => POST(request(`/api/report-files/${id}/share`, 'POST', '{}'), ctx(id));
const shareForm = (id: string, body = '') =>
  POST(request(`/api/report-files/${id}/share`, 'POST', body, FORM), ctx(id));
const revoke = (id: string) => DELETE(request(`/api/report-files/${id}/share`, 'DELETE'), ctx(id));
const open = (token: string) =>
  OPEN(request(`/s/${token}`, 'GET'), { params: Promise.resolve({ token }) });

interface World {
  owner: Person;
  manager: Person;
  /** A developer whose seat covers the report's site. */
  developer: Person;
  /** An account manager whose seat covers another client only. */
  elsewhere: Person;
  stranger: Person;
  siteId: string;
  /** A PDF with a stored file. */
  pdf: string;
  pdfPath: string;
  /** A proof page with its stored document. */
  proof: string;
  /** A report whose file is not stored. */
  pending: string;
}

async function seedReport(
  accountId: string,
  siteId: string,
  columns: Record<string, unknown>,
): Promise<string> {
  const id = randomUUID();
  // A report names its object from its first write; `storage_path: true` asks for a stored file.
  await insertRow(h.db, 'reports', {
    ...ROWS.reports(id, accountId, siteId, randomUUID()),
    ...columns,
    storage_path: `${accountId}/${id}.${columns.format === 'html' ? 'doc.json' : 'pdf'}`,
    file_state: columns.storage_path === true ? 'stored' : 'pending',
  });
  return id;
}

async function world(tier: 'pro' | 'agency' | null = 'agency'): Promise<World> {
  const owner = await person(h.db, 'owner');
  if (tier) await makePaid(h.db, owner.accountId, tier);
  const [site, other] = [
    await keptSite(h.db, owner.accountId),
    await keptSite(h.db, owner.accountId),
  ];
  const [manager, developer, elsewhere, stranger] = [
    await person(h.db, 'manager'),
    await person(h.db, 'developer'),
    await person(h.db, 'elsewhere'),
    await person(h.db, 'stranger'),
  ];
  await addSeat(h.db, owner.accountId, manager, 'account_manager');
  await addSeat(h.db, owner.accountId, developer, 'developer', [site.id]);
  await addSeat(h.db, owner.accountId, elsewhere, 'account_manager', [other.id]);
  const pdf = await seedReport(owner.accountId, site.id, { storage_path: true });
  return {
    owner,
    manager,
    developer,
    elsewhere,
    stranger,
    siteId: site.id,
    pdf,
    pdfPath: `${owner.accountId}/${pdf}.pdf`,
    proof: await seedReport(owner.accountId, site.id, {
      kind: 'compare',
      format: 'html',
      byte_count: null,
      storage_path: true,
    }),
    pending: await seedReport(owner.accountId, site.id, { byte_count: null }),
  };
}

interface LinkRow {
  token_hash: string;
  view_count: number;
  revoked_at: Date | null;
  expires_at: Date;
  created_by: string | null;
}
const links = async (reportId: string) =>
  (
    await h.db.query<LinkRow>(
      `select * from public.share_links where report_id = $1 order by created_at, token_hash`,
      [reportId],
    )
  ).rows;

/** A link made by the owner: its token. */
async function shared(w: World, reportId: string): Promise<string> {
  as(w.owner);
  const res = await share(reportId);
  expect(res.status).toBe(201);
  const { url } = (await res.json()) as { url: string };
  h.capture.mockClear();
  h.log.length = 0;
  h.limits.length = 0;
  return url.slice(`${ORIGIN}/s/`.length);
}

describe('POST /api/report-files/[id]/share', () => {
  it('answers 404 with the flag off, before the session is read', async () => {
    const w = await world();
    as(w.owner);
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    const res = await share(w.pdf);
    expect(res.status).toBe(404);
    expect(h.sessions).toBe(0);
    expect(await links(w.pdf)).toEqual([]);
  });

  it('answers 401 signed out', async () => {
    const w = await world();
    as(null);
    expect((await share(w.pdf)).status).toBe(401);
    expect(h.log).toEqual([]);
  });

  it('makes the link for the owner: the address once, the expiry, and only the token’s sha256 stored', async () => {
    const w = await world();
    as(w.owner);
    const before = Date.now();
    const res = await share(w.pdf);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { url: string; expiresAt: string };
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'url']);
    const token = body.url.slice(`${ORIGIN}/s/`.length);
    expect(body.url).toBe(`${ORIGIN}/s/${token}`);
    expect(isShareToken(token)).toBe(true);

    const [link] = await links(w.pdf);
    expect(link).toMatchObject({
      token_hash: sha256(token),
      created_by: w.owner.id,
      view_count: 0,
      revoked_at: null,
    });
    expect(link!.expires_at.toISOString()).toBe(body.expiresAt);
    const days = (Date.parse(body.expiresAt) - before) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(30);
    expect(days).toBeLessThan(30.01);
    // The token is in no column of the database.
    const dump = await h.db.query<{ t: string }>(
      `select row_to_json(l)::text t from public.share_links l
        union all select row_to_json(r)::text from public.reports r`,
    );
    expect(dump.rows.some((r) => r.t.includes(token))).toBe(false);
    expect(h.capture.mock.calls).toEqual([
      ['report_shared', w.owner.accountId, { kind: 'audit_pdf', format: 'pdf' }],
    ]);
  });

  it('lets an account manager share', async () => {
    const w = await world();
    as(w.manager);
    expect((await share(w.pdf)).status).toBe(201);
  });

  it('refuses a developer whose seat covers the site: 403 role_refused, and nothing is written', async () => {
    const w = await world();
    as(w.developer);
    const res = await share(w.pdf);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: 'role_refused' });
    expect(await links(w.pdf)).toEqual([]);
    expect(h.log).toEqual([]);
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('answers 404 for a seat that does not cover the report’s site, a stranger, an unknown id and a malformed one', async () => {
    const w = await world();
    for (const [who, id] of [
      [w.elsewhere, w.pdf],
      [w.stranger, w.pdf],
      [w.owner, randomUUID()],
      [w.owner, 'not-an-id'],
    ] as const) {
      as(who);
      const res = await share(id);
      expect(res.status, `${who.email} ${id}`).toBe(404);
      expect(await res.json()).toEqual({ code: 'not_found' });
    }
    expect(await links(w.pdf)).toEqual([]);
    expect(h.log).toEqual([]);
  });

  it('answers 402 with the gate’s name on a plan without exports', async () => {
    const w = await world(null);
    as(w.owner);
    const res = await share(w.pdf);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ code: 'upgrade_required', gate: 'exports' });
    expect(await links(w.pdf)).toEqual([]);
  });

  it('answers 409 not_ready for a report whose file is not stored', async () => {
    const w = await world();
    as(w.owner);
    const res = await share(w.pending);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'not_ready' });
    expect(h.capture).not.toHaveBeenCalled();
  });

  it('answers 429 past the account’s bound, which fails closed and is keyed by the account', async () => {
    const w = await world();
    as(w.owner);
    h.over.add('share-link');
    const res = await share(w.pdf);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(h.limits).toEqual([
      {
        key: `share-link:account:${w.owner.accountId}`,
        limit: 60,
        windowMs: 3_600_000,
        failClosed: true,
      },
    ]);
    expect(await links(w.pdf)).toEqual([]);
  });

  it('answers a form with a 303 to /reports: the link in an HttpOnly cookie of that page, never in the address', async () => {
    const w = await world();
    as(w.owner);
    const res = await shareForm(w.pdf);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/reports?notice=share_made');
    const set = res.headers.get('set-cookie')!;
    const value = /^cm_share_made=([^;]+);/.exec(set)![1]!;
    const [reportId, token] = value.split('.');
    expect(reportId).toBe(w.pdf);
    expect((await links(w.pdf))[0]!.token_hash).toBe(sha256(token!));
    for (const attr of ['Path=/reports', 'Max-Age=120', 'HttpOnly', 'Secure', 'SameSite=Strict']) {
      expect(set).toContain(attr);
    }
    expect(res.headers.get('location')).not.toContain(token);
    expect(await res.text()).toBe('');
  });

  it('a second link replaces the first: the first is gone, the second opens', async () => {
    const w = await world();
    const first = await shared(w, w.pdf);
    const second = await shared(w, w.pdf);
    expect((await open(first)).status).toBe(410);
    expect((await open(second)).status).toBe(302);
  });
});

describe('DELETE /api/report-files/[id]/share', () => {
  it('revokes the link: it answers 410 from then on, and the report shows no link', async () => {
    const w = await world();
    const token = await shared(w, w.pdf);
    expect((await open(token)).status).toBe(302);
    as(w.manager);
    const res = await revoke(w.pdf);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: true });
    expect((await links(w.pdf))[0]!.revoked_at).not.toBeNull();
    const {
      rows: [r],
    } = await h.db.query<{ share_expires_at: Date | null }>(
      `select share_expires_at from public.reports where id = $1`,
      [w.pdf],
    );
    expect(r!.share_expires_at).toBeNull();
    expect((await open(token)).status).toBe(410);
  });

  it('is the form’s POST with _method=DELETE, answered with a notice', async () => {
    const w = await world();
    const token = await shared(w, w.pdf);
    as(w.owner);
    const res = await shareForm(w.pdf, '_method=DELETE');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/reports?notice=share_revoked');
    expect((await open(token)).status).toBe(410);
    expect(await links(w.pdf)).toHaveLength(1);
  });

  it('refuses a developer (403) and a seat out of scope (404), and the link still opens', async () => {
    const w = await world();
    const token = await shared(w, w.pdf);
    as(w.developer);
    expect((await revoke(w.pdf)).status).toBe(403);
    as(w.elsewhere);
    expect((await revoke(w.pdf)).status).toBe(404);
    as(w.stranger);
    expect((await revoke(w.pdf)).status).toBe(404);
    expect((await open(token)).status).toBe(302);
  });
});

const HEADERS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
};
const headersOf = (res: Response) =>
  Object.fromEntries(Object.keys(HEADERS).map((k) => [k, res.headers.get(k)]));

describe('GET /s/[token]', () => {
  it('redirects a file’s link to a signed URL of the stored object that lives 60 seconds, and counts the view', async () => {
    const w = await world();
    const token = await shared(w, w.pdf);
    as(null);
    const res = await open(token);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`https://files.example/${w.pdfPath}?signed=1`);
    expect(h.signed).toEqual([{ bucket: 'reports', path: w.pdfPath, seconds: 60 }]);
    expect(headersOf(res)).toEqual(HEADERS);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect((await links(w.pdf))[0]!.view_count).toBe(1);
    await open(token);
    expect((await links(w.pdf))[0]!.view_count).toBe(2);
    expect(h.capture.mock.calls[0]).toEqual([
      'share_link_opened',
      w.owner.accountId,
      { kind: 'audit_pdf', format: 'pdf' },
    ]);
    expect(h.limits[0]).toEqual({
      key: `share-open:ip:${sha256(IP)}`,
      limit: 60,
      windowMs: 3_600_000,
      failClosed: false,
    });
  });

  it('sends a proof page’s link to /s/view/<report>, the token in that page’s HttpOnly cookie and in no address', async () => {
    const w = await world();
    const token = await shared(w, w.proof);
    as(null);
    const res = await open(token);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/s/view/${w.proof}`);
    expect(res.headers.get('location')).not.toContain(token);
    expect(res.headers.get('set-cookie')).toBe(
      `cm_share=${token}; Path=/s/view/${w.proof}; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(headersOf(res)).toEqual(HEADERS);
    expect(h.signed).toEqual([]);
    expect((await links(w.proof))[0]!.view_count).toBe(1);
  });

  it('answers 410 with the static page once the link has expired, and counts no view', async () => {
    const w = await world();
    const token = await shared(w, w.pdf);
    await h.db.query(
      `update public.share_links set expires_at = now() - interval '1 second' where report_id = $1`,
      [w.pdf],
    );
    const res = await open(token);
    expect(res.status).toBe(410);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toBe(GONE_PAGE);
    expect(headersOf(res)).toEqual(HEADERS);
    expect(res.headers.get('location')).toBeNull();
    expect(h.signed).toEqual([]);
    expect(h.capture).not.toHaveBeenCalled();
    expect((await links(w.pdf))[0]!.view_count).toBe(0);
  });

  it('answers 410 once the link is revoked, and counts no view', async () => {
    const w = await world();
    const token = await shared(w, w.pdf);
    as(w.owner);
    await revoke(w.pdf);
    const res = await open(token);
    expect(res.status).toBe(410);
    expect(h.signed).toEqual([]);
    expect((await links(w.pdf))[0]!.view_count).toBe(0);
  });

  it('answers 404 for a token no link holds, with the same headers', async () => {
    await world();
    const res = await open('AAAAAAAAAAAAAAAAAAAAAA');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'not_found' });
    expect(headersOf(res)).toEqual(HEADERS);
  });

  it('answers 404 for a value that is not token-shaped, before the rate limit and any database call', async () => {
    for (const bad of ['short', 'A'.repeat(21), 'A'.repeat(23), `${'A'.repeat(21)}.`, 'view']) {
      const res = await open(bad);
      expect(res.status, bad).toBe(404);
      expect(headersOf(res)).toEqual(HEADERS);
    }
    expect(h.limits).toEqual([]);
    expect(h.log).toEqual([]);
  });

  it('answers 404 with the flag off, for a link that would open', async () => {
    const w = await world();
    const token = await shared(w, w.pdf);
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    const res = await open(token);
    expect(res.status).toBe(404);
    expect(h.log).toEqual([]);
    expect((await links(w.pdf))[0]!.view_count).toBe(0);
  });

  it('answers 429 past the address’s bound, before the link is read', async () => {
    const w = await world();
    const token = await shared(w, w.pdf);
    h.over.add('share-open');
    const res = await open(token);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(headersOf(res)).toEqual(HEADERS);
    expect(h.log).toEqual([]);
    expect((await links(w.pdf))[0]!.view_count).toBe(0);
  });
});

describe('the gone page', () => {
  it('holds no script, and no link but the home page', () => {
    expect(GONE_PAGE).not.toMatch(/<script|javascript:|\son\w+=/i);
    expect([...GONE_PAGE.matchAll(/(?:href|src|action)="([^"]*)"/g)].map((m) => m[1])).toEqual([
      '/',
    ]);
    expect(GONE_PAGE).toContain('<meta name="robots" content="noindex, nofollow">');
  });
});
