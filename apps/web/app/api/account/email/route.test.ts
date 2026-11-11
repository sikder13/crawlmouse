import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import { postgrestOver } from '@/__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '@/__tests__/helpers/v2-check-tables';
import type { AccountEmailEvent } from '@/lib/v2/account/emails';
import type { EmailChangePorts } from '@/lib/v2/account/email-change';

// The email change's five routes (CC-27b D3), end to end over the migrated schema: the session client
// is a stand-in whose user, role answer and claims each test sets; the ports are production's shape
// with the PostgREST stand-in for `rpc`, and recorders for Auth, the mailer and the event sender.

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  role: 'owner' as string | null,
  sessionId: null as string | null,
  log: [] as string[],
  emails: [] as AccountEmailEvent[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: {
      getUser: async () => {
        h.log.push('getUser');
        return { data: { user: h.user }, error: null };
      },
      getClaims: async () => ({
        data: h.user ? { claims: { sub: h.user.id, session_id: h.sessionId } } : null,
        error: null,
      }),
    },
    from: (table: string) => {
      h.log.push(`session.from ${table}`);
      const rows = h.user ? [{ account_id: accountOf.get(h.user.id) }] : [];
      const chain: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
      };
      chain.select = chain.eq = () => chain;
      return chain;
    },
    rpc: async (fn: string) => {
      h.log.push(`session.rpc ${fn}`);
      return { data: h.role, error: null };
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => {
    h.log.push('supabaseAdmin');
    return {};
  },
}));
vi.mock('@/lib/v2/account/email-change-ports', () => ({
  emailChangePorts: (): EmailChangePorts => {
    const sb = postgrestOver(h.db);
    return {
      rpc: (fn, args) => sb.rpc(fn, args),
      auth: {
        async updateEmail(userId, email) {
          h.log.push('auth.updateEmail');
          await h.db.query(`update auth.users set email = $2 where id = $1`, [userId, email]);
          return 'ok';
        },
        async deleteUser() {},
      },
      sendEmails: async (events) => {
        h.emails.push(...events);
      },
      capture: async () => {},
      rateLimit: async () => true,
      report: () => {},
      now: () => new Date(),
    };
  },
}));

const accountOf = new Map<string, string>();

// Applying every migration to a fresh PGlite takes several seconds, more under a parallel run.
beforeAll(async () => {
  h.db = await freshDb();
  await h.db.exec(
    `alter table auth.users add column created_at timestamptz not null default now(), add column banned_until timestamptz;`,
  );
  await applyAllMigrations(h.db);
}, 120_000);
afterAll(async () => h.db.close());
beforeEach(() => {
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://crawlmouse.com');
  h.user = null;
  h.role = 'owner';
  h.sessionId = null;
  h.log.length = 0;
  h.emails.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

const ORIGIN = 'https://crawlmouse.com';
let n = 0;
async function person() {
  n += 1;
  const email = `route${n}@example.com`;
  const id = await signUp(h.db, email);
  const { accountId } = await personalAccount(h.db, id);
  accountOf.set(id, accountId);
  return { id, email, accountId };
}

const load = async () => ({
  request: await import('./route'),
  confirm: await import('./confirm/route'),
  undo: await import('./undo/route'),
  landEmail: await import('../../../account/email/[token]/route'),
  landUndo: await import('../../../account/email-undo/[token]/route'),
});

const post = (path: string, body: string, type: string, cookie?: string) =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': type, origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    body,
  });

const land = async (which: 'landEmail' | 'landUndo', token: string) => {
  const mod = (await load())[which];
  return mod.GET(new Request(`${ORIGIN}/account/x/${token}`), {
    params: Promise.resolve({ token }),
  });
};

/** The `name=value` of the cookie a response sets. */
const setCookie = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]!;

async function rawOf(tokenId: string) {
  const { rows } = await h.db.query<{ token: string }>(
    `select token from public.issue_account_link($1)`,
    [tokenId],
  );
  return rows[0]!.token;
}

/** Signs `p` in, asks for a change to `to`, and returns the confirmation link's raw token. */
async function asked(p: { id: string; email: string }, to: string) {
  h.user = { id: p.id, email: p.email };
  const { request } = await load();
  const res = await request.POST(
    post('/api/account/email', JSON.stringify({ newEmail: to }), 'application/json'),
  );
  expect(res.status).toBe(202);
  const raw = await rawOf(h.emails.at(-1)!.data.tokenId);
  h.user = null;
  return raw;
}

describe('with V2_CHECKS_PUBLIC unset', () => {
  it('each of the five routes answers 404 and reads nothing', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    const m = await load();
    const answers = [
      await m.request.POST(post('/api/account/email', '{}', 'application/json')),
      await m.confirm.POST(
        post('/api/account/email/confirm', '', 'application/x-www-form-urlencoded'),
      ),
      await m.undo.POST(post('/api/account/email/undo', '', 'application/x-www-form-urlencoded')),
      await land('landEmail', 'A'.repeat(43)),
      await land('landUndo', 'A'.repeat(43)),
    ];
    expect(answers.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
    expect(answers.map((r) => r.headers.get('set-cookie'))).toEqual([null, null, null, null, null]);
    expect(h.log).toEqual([]);
  });
});

describe('POST /api/account/email', () => {
  it('asks the owner’s role before the service role, and answers 202', async () => {
    const p = await person();
    await asked(p, 'new-home@example.org');
    expect(h.log).toEqual([
      'getUser',
      'session.from seats',
      'session.rpc member_role',
      'supabaseAdmin',
    ]);
    expect(h.emails.map((e) => e.data.template)).toEqual(['email_change_confirm']);
  });

  it('refuses a manager with 403 not_owner, before the service role', async () => {
    const p = await person();
    h.user = { id: p.id, email: p.email };
    h.role = 'account_manager';
    const { request } = await load();
    const res = await request.POST(
      post('/api/account/email', JSON.stringify({ newEmail: 'm@example.org' }), 'application/json'),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: 'not_owner' });
    expect(h.log).not.toContain('supabaseAdmin');
    expect(h.emails).toEqual([]);
  });

  it('refuses a caller with no session, and a body with another field', async () => {
    const { request } = await load();
    const anon = await request.POST(
      post('/api/account/email', JSON.stringify({ newEmail: 'x@example.org' }), 'application/json'),
    );
    expect(anon.status).toBe(401);
    const p = await person();
    h.user = { id: p.id, email: p.email };
    const extra = await request.POST(
      post(
        '/api/account/email',
        JSON.stringify({ newEmail: 'x@example.org', accountId: p.accountId }),
        'application/json',
      ),
    );
    expect(extra.status).toBe(400);
    expect(h.emails).toEqual([]);
  });

  it('answers a taken address exactly as a free one', async () => {
    const p = await person();
    const holder = await person();
    h.user = { id: p.id, email: p.email };
    const { request } = await load();
    const ask = async (to: string) => {
      const res = await request.POST(
        post(
          '/api/account/email',
          `newEmail=${encodeURIComponent(to)}`,
          'application/x-www-form-urlencoded',
        ),
      );
      return [res.status, res.headers.get('location'), await res.text()];
    };
    const free = await ask('free-address@example.org');
    const taken = await ask(holder.email);
    expect(free).toEqual([303, '/settings?email=sent', '']);
    expect(taken).toEqual(free);
  });
});

describe('the confirmation link and its page’s POST', () => {
  it('lands the token in a cookie with no token in the Location, then confirms from the cookie', async () => {
    const p = await person();
    const raw = await asked(p, 'landed@example.org');
    const landed = await land('landEmail', raw);
    expect(landed.status).toBe(303);
    expect(landed.headers.get('location')).toBe(`${ORIGIN}/account/email`);
    expect(setCookie(landed)).toBe(`cm_link_email=${raw}`);
    expect(landed.headers.get('cache-control')).toBe('no-store');
    expect(landed.headers.get('referrer-policy')).toBe('no-referrer');

    const { confirm } = await load();
    const res = await confirm.POST(
      post(
        '/api/account/email/confirm',
        '',
        'application/x-www-form-urlencoded',
        setCookie(landed),
      ),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/account/email?done=1`);
    expect(res.headers.get('location')).not.toContain(raw);
    expect(res.headers.get('set-cookie')).toMatch(/^cm_link_email=; Path=\/; Max-Age=0;/);
    const { rows } = await h.db.query<{ email: string }>(
      `select email from public.users where id = $1`,
      [p.id],
    );
    expect(rows[0]!.email).toBe('landed@example.org');
  });

  it('has no GET, so Next answers a GET with 405', async () => {
    const { confirm, undo } = await load();
    expect(Object.keys(confirm).filter((k) => k !== 'POST')).toEqual([]);
    expect(Object.keys(undo).filter((k) => k !== 'POST')).toEqual([]);
  });

  it('refuses a token sent in the body, and answers no cookie as an unusable link', async () => {
    const p = await person();
    const raw = await asked(p, 'body@example.org');
    const { confirm } = await load();
    const inBody = await confirm.POST(
      post('/api/account/email/confirm', `token=${raw}`, 'application/x-www-form-urlencoded'),
    );
    expect(inBody.status).toBe(400);
    const none = await confirm.POST(
      post('/api/account/email/confirm', '', 'application/x-www-form-urlencoded'),
    );
    expect(none.headers.get('location')).toBe(`${ORIGIN}/account/email?error=link_unusable`);
    expect(none.headers.get('set-cookie')).toBeNull();
  });

  it('clears the cookie when a used link is posted again, and says so', async () => {
    const p = await person();
    const raw = await asked(p, 'again@example.org');
    const { confirm } = await load();
    const cookie = `cm_link_email=${raw}`;
    await confirm.POST(
      post('/api/account/email/confirm', '', 'application/x-www-form-urlencoded', cookie),
    );
    const again = await confirm.POST(
      post('/api/account/email/confirm', '{}', 'application/json', cookie),
    );
    expect(again.status).toBe(410);
    expect(await again.json()).toEqual({ code: 'link_unusable' });
    expect(again.headers.get('set-cookie')).toMatch(/^cm_link_email=;/);
  });

  it('keeps the confirming browser’s session when it is the person’s, and ends the others', async () => {
    const p = await person();
    const raw = await asked(p, 'kept@example.org');
    const mine = '00000000-0000-4000-8000-0000000000f1';
    const other = '00000000-0000-4000-8000-0000000000f2';
    for (const id of [mine, other])
      await h.db.query(`insert into auth.sessions (id, user_id) values ($1, $2)`, [id, p.id]);
    h.user = { id: p.id, email: p.email };
    h.sessionId = mine;
    const { confirm } = await load();
    const res = await confirm.POST(
      post('/api/account/email/confirm', '{}', 'application/json', `cm_link_email=${raw}`),
    );
    expect(await res.json()).toEqual({ done: true });
    const { rows } = await h.db.query<{ id: string }>(
      `select id from auth.sessions where user_id = $1`,
      [p.id],
    );
    expect(rows.map((r) => r.id)).toEqual([mine]);
  });
});

describe('the undo link and its page’s POST', () => {
  it('lands its token in its own cookie, and an undo token in the confirm’s cookie is refused', async () => {
    const p = await person();
    const raw = await asked(p, 'undo-me@example.net');
    const { confirm, undo } = await load();
    await confirm.POST(
      post('/api/account/email/confirm', '{}', 'application/json', `cm_link_email=${raw}`),
    );
    const undoRaw = await rawOf(h.emails.at(-1)!.data.tokenId);

    const crossed = await confirm.POST(
      post('/api/account/email/confirm', '{}', 'application/json', `cm_link_email=${undoRaw}`),
    );
    expect(crossed.status).toBe(410);

    const landed = await land('landUndo', undoRaw);
    expect(landed.headers.get('location')).toBe(`${ORIGIN}/account/email-undo`);
    expect(setCookie(landed)).toBe(`cm_link_email_undo=${undoRaw}`);
    const res = await undo.POST(
      post('/api/account/email/undo', '', 'application/x-www-form-urlencoded', setCookie(landed)),
    );
    expect(res.headers.get('location')).toBe(`${ORIGIN}/account/email-undo?done=1`);
    expect(res.headers.get('set-cookie')).toMatch(/^cm_link_email_undo=;/);
    const { rows } = await h.db.query<{ email: string }>(
      `select email from public.users where id = $1`,
      [p.id],
    );
    expect(rows[0]!.email).toBe(p.email);
  });
});
