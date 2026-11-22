import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import {
  addSeat,
  adminOver,
  keptSite,
  makePaid,
  person,
  sessionOver,
  type Person,
} from '@/lib/v2/account/sites-test-support';

// POST /api/checks for a person signed in and acting in an account (RC-02, F-001): the home form's
// check belongs to that account. The session and service-role clients are the PostgREST stand-in
// over PGlite with every migration applied, so the viewer, row security, `seat_may`,
// `is_member_for_site`, `add_site` and `request_capped_check` run for real. Inngest's send, the
// engine's DNS check, the address bucket, Turnstile and the event senders are fakes.

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  /** The switcher cookie's value on this request, or null for none. */
  chosen: null as string | null,
  sent: [] as unknown[],
  captured: [] as unknown[][],
  publicCaptured: [] as unknown[][],
  /** What the address bucket was asked: `[ip, signedIn]`. */
  ipAsked: [] as unknown[][],
  ipAllowed: true,
  turnstile: [] as unknown[][],
  refused: new Set<string>(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (task: () => unknown) => void Promise.resolve().then(task),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'cm_account' && h.chosen !== null ? { name, value: h.chosen } : undefined,
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => sessionOver(h.db, h.user),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => adminOver(h.db) }));
vi.mock('../../../../../inngest/client', () => ({
  inngest: { send: async (e: unknown) => void h.sent.push(e) },
}));
vi.mock('@/lib/inngest', () => ({ inngest: { send: async (e: unknown) => void h.sent.push(e) } }));
vi.mock('@/lib/auth/admit-site', () => ({
  admitSiteHost: async (host: string) => !h.refused.has(host),
}));
vi.mock('./_lib/start-limits', () => ({
  startLimits: {
    global: async () => true,
    ip: async (...args: unknown[]) => {
      h.ipAsked.push(args);
      return { allowed: h.ipAllowed, resetAt: new Date(Date.UTC(2026, 10, 23)) };
    },
    domain: async () => true,
    replay: async () => true,
  },
}));
vi.mock('@/lib/turnstile', () => ({
  verifyTurnstileToken: async (...args: unknown[]) => {
    h.turnstile.push(args);
    return args[0] === 'good';
  },
}));
vi.mock('@/lib/v2/account/events', async (original) => ({
  ...(await original<typeof import('@/lib/v2/account/events')>()),
  captureFor:
    () =>
    async (...a: unknown[]) =>
      void h.captured.push(a),
}));
vi.mock('@/lib/v2/agency/events', async (original) => ({
  ...(await original<typeof import('@/lib/v2/agency/events')>()),
  agencyCaptureFor:
    () =>
    async (...a: unknown[]) =>
      void h.captured.push(['agency', ...a]),
}));
vi.mock('./_lib/events', () => ({
  capturePublicEventAfterResponse: async (...a: unknown[]) => void h.publicCaptured.push(a),
}));

import { checkStarted } from '@/lib/v2/account/events';
import { agencyAccount } from '@/lib/v2/agency/test-support';
import { POST } from './route';

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
}, 300_000);
afterAll(async () => {
  await h.db?.close();
});

beforeEach(() => {
  h.user = null;
  h.chosen = null;
  h.sent.length = 0;
  h.captured.length = 0;
  h.publicCaptured.length = 0;
  h.ipAsked.length = 0;
  h.ipAllowed = true;
  h.turnstile.length = 0;
  h.refused = new Set(['private.example']);
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('V2_PIPELINE', '1');
  vi.stubEnv('CRAWL_PAUSED', '');
});
afterEach(() => vi.unstubAllEnvs());

const IP = '203.0.113.9';
const as = (p: Pick<Person, 'id' | 'email'> | null) => {
  h.user = p && { id: p.id, email: p.email };
};

const home = (url: string, more: Record<string, string> = {}) =>
  new Request('https://crawlmouse.com/api/checks', {
    method: 'POST',
    headers: {
      origin: 'https://crawlmouse.com',
      'content-type': 'application/json',
      'x-forwarded-for': IP,
    },
    body: JSON.stringify({ url, requestId: randomUUID(), ...more }),
  });

const read = async (res: Response) => ({
  status: res.status,
  body: (await res.json()) as Record<string, unknown>,
});

/** Lets the tasks handed to `after` run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const sitesOf = async (accountId: string) =>
  (
    await h.db.query<{ id: string; host: string; schedule_cadence: string | null }>(
      `select id, host, schedule_cadence from public.sites
        where account_id = $1 and removed_at is null order by created_at`,
      [accountId],
    )
  ).rows;

const checkRow = async (checkId: string) =>
  (
    await h.db.query<{
      site_id: string;
      account_id: string | null;
      trigger: string;
      status: string;
    }>(
      `select c.site_id, s.account_id, c.trigger, c.status
         from public.checks c join public.sites s on s.id = c.site_id where c.id = $1`,
      [checkId],
    )
  ).rows[0];

/** Every site and check row of an account, to compare before and after a stranger's request. */
const snapshot = async (accountId: string) =>
  (
    await h.db.query(
      `select s.id, s.host, s.removed_at, c.id as check_id, c.status
         from public.sites s left join public.checks c on c.site_id = s.id
        where s.account_id = $1 order by s.id, c.id`,
      [accountId],
    )
  ).rows;

async function addCheck(siteId: string, status: 'queued' | 'running' | 'failed'): Promise<string> {
  const id = randomUUID();
  await h.db.query(
    `insert into public.checks (id, site_id, status, trigger, grade_version, queued_at, started_at,
                                finished_at, failure_reason, progress)
     values ($1, $2, $3, 'manual', '2.0.0', now() - interval '1 hour',
             case when $3 = 'queued' then null else now() - interval '1 hour' end,
             case when $3 = 'failed' then now() - interval '1 hour' end,
             case when $3 = 'failed' then 'internal' end,
             case when $3 = 'running' then '{}'::jsonb end)`,
    [id, siteId, status],
  );
  return id;
}

describe('POST /api/checks, a person acting in an account (F-001)', () => {
  it('a Free person’s first home check adds the site to their account, with its first audit', async () => {
    const p = await person(h.db, 'first');
    as(p);
    const { status, body } = await read(await POST(home('https://Shop.Example/products')));
    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual(['checkId']);
    const checkId = body.checkId as string;

    const sites = await sitesOf(p.accountId);
    expect(sites).toEqual([
      { id: expect.any(String), host: 'shop.example', schedule_cadence: 'monthly' },
    ]);
    expect(await checkRow(checkId)).toEqual({
      site_id: sites[0]!.id,
      account_id: p.accountId,
      trigger: 'first_audit',
      status: 'queued',
    });
    expect(h.sent).toHaveLength(1);
    await settle();
    const key = { accountId: p.accountId, userId: p.id };
    expect(h.captured).toEqual([
      ['site_added', key, { n: 1 }],
      ['check_started', key, checkStarted('first_audit', checkId)],
    ]);
    expect(h.publicCaptured).toEqual([]);
  });

  it('counts the address bucket at the signed-in limit, and asks for Turnstile over it', async () => {
    const p = await person(h.db, 'bucket');
    as(p);
    h.ipAllowed = false;
    expect(await read(await POST(home('bucket.example')))).toEqual({
      status: 429,
      body: {
        code: 'captcha_required',
        error: 'Confirm you are not a robot to start another audit.',
        resetAt: '2026-11-23T00:00:00.000Z',
      },
    });
    expect(h.ipAsked).toEqual([[IP, true]]);
    expect(await sitesOf(p.accountId)).toEqual([]);

    expect((await POST(home('bucket.example', { turnstileToken: 'bad' }))).status).toBe(429);
    expect(await sitesOf(p.accountId)).toEqual([]);
    expect((await POST(home('bucket.example', { turnstileToken: 'good' }))).status).toBe(200);
    expect(h.turnstile).toEqual([
      ['bad', IP],
      ['good', IP],
    ]);
    expect((await sitesOf(p.accountId)).map((s) => s.host)).toEqual(['bucket.example']);
  });

  it('a host the SSRF guard refuses, or with a port, is the public start’s `invalid_url`', async () => {
    const p = await person(h.db, 'ssrf');
    as(p);
    for (const url of ['https://private.example/', 'https://ok.example:8443/']) {
      expect(await read(await POST(home(url)))).toEqual({
        status: 400,
        body: { code: 'invalid_url', error: 'Enter the address of a public website.' },
      });
    }
    expect(await sitesOf(p.accountId)).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it('at the Free limit: 409 `site_limit` in words, and nothing is written or sent', async () => {
    const p = await person(h.db, 'limit');
    const kept = await keptSite(h.db, p.accountId);
    as(p);
    expect(await read(await POST(home('second.example')))).toEqual({
      status: 409,
      body: {
        code: 'site_limit',
        error:
          'Your Free plan keeps one site, and this account keeps it already. Open your dashboard to check it again.',
      },
    });
    expect((await sitesOf(p.accountId)).map((s) => s.id)).toEqual([kept.id]);
    expect(h.sent).toEqual([]);
    await settle();
    expect(h.captured).toEqual([]);
  });

  it('at the Pro limit the sentence names Pro’s five sites', async () => {
    const p = await person(h.db, 'prolimit');
    await makePaid(h.db, p.accountId, 'pro');
    for (let i = 0; i < 5; i++) await keptSite(h.db, p.accountId);
    as(p);
    expect(await read(await POST(home('sixth.example')))).toEqual({
      status: 409,
      body: {
        code: 'site_limit',
        error:
          'Your Pro plan keeps five sites, and this account keeps them already. Open your dashboard to check one of them again.',
      },
    });
  });

  it('a host the account keeps is checked again on that site, not added twice', async () => {
    const p = await person(h.db, 'again');
    const kept = await keptSite(h.db, p.accountId);
    await addCheck(kept.id, 'failed');
    as(p);
    const { status, body } = await read(await POST(home(`https://${kept.host}/`)));
    expect(status).toBe(200);
    expect(await checkRow(body.checkId as string)).toEqual({
      site_id: kept.id,
      account_id: p.accountId,
      trigger: 'manual',
      status: 'queued',
    });
    expect((await sitesOf(p.accountId)).map((s) => s.id)).toEqual([kept.id]);
    await settle();
    expect(h.captured).toEqual([
      [
        'check_started',
        { accountId: p.accountId, userId: p.id },
        checkStarted('manual', body.checkId as string),
      ],
    ]);
  });

  it.each(['queued', 'running'] as const)(
    'while the site’s latest check is %s, that check is the answer and nothing is requested',
    async (state) => {
      const p = await person(h.db, `busy-${state}`);
      const kept = await keptSite(h.db, p.accountId);
      const busy = await addCheck(kept.id, state);
      as(p);
      expect(await read(await POST(home(kept.host)))).toEqual({
        status: 200,
        body: { checkId: busy },
      });
      expect(h.sent).toEqual([]);
      await settle();
      expect(h.captured).toEqual([]);
    },
  );

  it('a double submit of a new host starts one crawl: the second answer is the first check', async () => {
    const p = await person(h.db, 'double');
    as(p);
    const first = await read(await POST(home('twice.example')));
    const second = await read(await POST(home('twice.example')));
    expect(first.status).toBe(200);
    expect(second).toEqual({ status: 200, body: first.body });
    expect(await sitesOf(p.accountId)).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
  });

  it('a person acting in their agency (the switcher) adds the site to the agency', async () => {
    const p = await person(h.db, 'agency-owner');
    const agency = await agencyAccount(h.db, p, 'Switch Agency');
    as(p);
    h.chosen = agency.accountId;
    const { status, body } = await read(await POST(home('client.example')));
    expect(status).toBe(200);
    expect((await checkRow(body.checkId as string))?.account_id).toBe(agency.accountId);
    expect(await sitesOf(p.accountId)).toEqual([]);
    await settle();
    expect(h.captured.map((c) => c[0])).toEqual(['site_added', 'agency', 'check_started']);
  });
});

describe('POST /api/checks, somebody else’s data (J4)', () => {
  it('B’s home check of a host A keeps is a site of B’s own; A’s rows are untouched', async () => {
    const a = await person(h.db, 'j4-a');
    const aSite = await keptSite(h.db, a.accountId);
    const aCheck = await addCheck(aSite.id, 'queued');
    const before = await snapshot(a.accountId);

    const b = await person(h.db, 'j4-b');
    as(b);
    const { status, body } = await read(await POST(home(aSite.host)));
    expect(status).toBe(200);
    expect(body.checkId).not.toBe(aCheck);
    expect((await checkRow(body.checkId as string))?.account_id).toBe(b.accountId);
    expect((await sitesOf(b.accountId)).map((s) => s.host)).toEqual([aSite.host]);
    expect(await snapshot(a.accountId)).toEqual(before);
  });

  it('a switcher cookie naming an account B has no seat on is ignored', async () => {
    const a = await person(h.db, 'j4-cookie-a');
    const before = await snapshot(a.accountId);
    const b = await person(h.db, 'j4-cookie-b');
    as(b);
    h.chosen = a.accountId;
    const { status, body } = await read(await POST(home('cookie.example')));
    expect(status).toBe(200);
    expect((await checkRow(body.checkId as string))?.account_id).toBe(b.accountId);
    expect(await snapshot(a.accountId)).toEqual(before);
  });

  it('a seat scoped to other clients cannot add a site, nor learn of a client it does not cover', async () => {
    const owner = await person(h.db, 'scope-owner');
    await makePaid(h.db, owner.accountId, 'agency');
    const covered = await keptSite(h.db, owner.accountId);
    const hidden = await keptSite(h.db, owner.accountId);
    const hiddenCheck = await addCheck(hidden.id, 'queued');
    const dev = await person(h.db, 'scope-dev');
    await addSeat(h.db, owner.accountId, dev, 'developer', [covered.id]);
    as(dev);
    h.chosen = owner.accountId;
    const before = await snapshot(owner.accountId);

    expect(await read(await POST(home('new-client.example')))).toEqual({
      status: 403,
      body: {
        code: 'role_refused',
        error: 'Your seat on this account cannot add a site. Ask the account’s owner to add it.',
      },
    });
    const refused = await read(await POST(home(hidden.host)));
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).not.toContain(hiddenCheck);
    expect(JSON.stringify(refused.body)).not.toContain(hidden.id);
    expect(await snapshot(owner.accountId)).toEqual(before);
    expect(h.sent).toEqual([]);
  });

  it('signed out, the check is of a site no account keeps, as before', async () => {
    as(null);
    const { status, body } = await read(await POST(home('anon.example')));
    expect(status).toBe(200);
    expect((await checkRow(body.checkId as string))?.account_id).toBeNull();
    expect(h.ipAsked).toEqual([[IP, false]]);
    expect(h.captured).toEqual([]);
  });
});
