import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// PUT /api/sites/[id]/alert-rules (CC-28 D8, owner ruling Q7) over PGlite with every migration
// applied: the caller's session is the PostgREST stand-in signed in as them, the service role is the
// stand-in as service_role. The guards are CC-27b's account-level route's: the session's membership
// first, the service role after it, another account's site a 404.

const h = vi.hoisted(() => ({
  db: null as unknown as PGlite,
  user: null as { id: string; email: string } | null,
  log: [] as string[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', async () => {
  const { postgrestOver } = await import('@/__tests__/helpers/postgrest-pglite');
  return {
    supabaseServer: async () => {
      const as = h.user ? { userId: h.user.id } : undefined;
      const client = postgrestOver(h.db, as ? { as } : {}) as unknown as Record<string, unknown>;
      return {
        ...client,
        rpc: (fn: string, args: Record<string, unknown>) => {
          h.log.push(`rpc:${fn}`);
          return (client.rpc as (f: string, a: Record<string, unknown>) => unknown)(fn, args);
        },
        auth: {
          getUser: async () => {
            h.log.push('getUser');
            return { data: { user: h.user }, error: null };
          },
        },
      };
    },
  };
});
vi.mock('@/lib/supabase/admin', async () => {
  const { postgrestOver } = await import('@/__tests__/helpers/postgrest-pglite');
  return {
    supabaseAdmin: () => {
      h.log.push('supabaseAdmin');
      return postgrestOver(h.db);
    },
  };
});

import { applyAllMigrations, freshDb } from '@/__tests__/helpers/pglite-migrations';
import { personalAccount, signUp } from '@/__tests__/helpers/v2-check-tables';
import { POST, PUT } from './route';

const ORIGIN = 'https://crawlmouse.com';

beforeAll(async () => {
  h.db = await freshDb();
  await applyAllMigrations(h.db);
}, 300_000);
afterAll(async () => h.db.close());

beforeEach(() => {
  h.log.length = 0;
  h.user = null;
  vi.stubEnv('V2_CHECKS_PUBLIC', '1');
});

/** A member with one live site and the account-level rules `kinds`. */
async function member(tag: string, tier: 'free' | 'pro', channels = ['email']) {
  const email = `${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const id = await signUp(h.db, email);
  const { accountId } = await personalAccount(h.db, id);
  if (tier === 'pro') {
    await h.db.query(
      `update public.accounts
          set state = 'pro_trial', tier = 'pro', trial_variant = 'no_card',
              trial_ends_at = now() + interval '7 days', trial_used_at = now(),
              state_history = state_history || jsonb_build_array(
                jsonb_build_object('state', 'pro_trial', 'since', now()))
        where id = $1`,
      [accountId],
    );
  }
  const site = await h.db.query<{ id: string }>(
    `insert into public.sites (account_id, host) values ($1, $2) returning id`,
    [accountId, `${tag}-${randomUUID().slice(0, 8)}.example.com`],
  );
  await h.db.query(
    `insert into public.alert_rules (account_id, site_id, kind, enabled, threshold_points, channels)
     values ($1, null, 'any_change', true, null, $2), ($1, null, 'text_drop', true, 10, $2)`,
    [accountId, channels],
  );
  return { user: { id, email }, accountId, siteId: site.rows[0]!.id };
}

const put = (siteId: string, body: unknown) =>
  new Request(`${ORIGIN}/api/sites/${siteId}/alert-rules`, {
    method: 'PUT',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const form = (siteId: string, body: string) =>
  new Request(`${ORIGIN}/api/sites/${siteId}/alert-rules`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** Every alert rule of the account, as `scope kind enabled channels threshold`, the account's first. */
async function rulesOf(accountId: string): Promise<string[]> {
  const { rows } = await h.db.query<{ r: string }>(
    `select concat_ws(' ', coalesce(site_id::text, 'account'), kind, enabled::text, array_to_string(channels, '+'),
                      coalesce(threshold_points::text, '-')) r
       from public.alert_rules where account_id = $1 order by site_id nulls first, kind`,
    [accountId],
  );
  return rows.map((x) => x.r);
}

describe('PUT /api/sites/[id]/alert-rules', () => {
  it('is a 404 with V2_CHECKS_PUBLIC off, for both verbs, before anything else runs', async () => {
    vi.stubEnv('V2_CHECKS_PUBLIC', '');
    const id = randomUUID();
    expect((await PUT(put(id, { rule: 'any_change', enabled: false }), ctx(id))).status).toBe(404);
    expect(
      (await POST(form(id, '_method=PUT&rule=any_change&enabled=false'), ctx(id))).status,
    ).toBe(404);
    expect(h.log).toEqual([]);
  });

  it('answers 401 to a signed-out caller', async () => {
    const id = randomUUID();
    const res = await PUT(put(id, { rule: 'any_change', enabled: false }), ctx(id));
    expect(res.status).toBe(401);
    expect(h.log).toEqual(['getUser']);
  });

  it('writes the site’s override from the account’s rule, after the session’s membership check', async () => {
    const m = await member('override', 'pro');
    h.user = m.user;
    const res = await PUT(put(m.siteId, { rule: 'text_drop', enabled: false }), ctx(m.siteId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      rule: { kind: 'text_drop', enabled: false, channels: ['email'] },
    });
    expect(await rulesOf(m.accountId)).toEqual([
      'account any_change true email -',
      'account text_drop true email 10',
      `${m.siteId} text_drop false email 10`,
    ]);
    const firstMembership = Math.min(
      h.log.indexOf('rpc:is_member_for_site'),
      h.log.indexOf('rpc:member_role'),
    );
    expect(firstMembership).toBeGreaterThan(-1);
    expect(h.log.indexOf('supabaseAdmin')).toBeGreaterThan(h.log.indexOf('rpc:member_role'));
  });

  it('a second switch updates the one override row; the account’s rule is never touched', async () => {
    const m = await member('again', 'free');
    h.user = m.user;
    await PUT(put(m.siteId, { rule: 'any_change', enabled: false }), ctx(m.siteId));
    const res = await PUT(put(m.siteId, { rule: 'any_change', enabled: true }), ctx(m.siteId));
    expect(res.status).toBe(200);
    expect(await rulesOf(m.accountId)).toEqual([
      'account any_change true email -',
      'account text_drop true email 10',
      `${m.siteId} any_change true email -`,
    ]);
  });

  it('a site’s form posting PUT in _method switches the override and goes back to the site', async () => {
    const m = await member('form', 'free');
    h.user = m.user;
    const res = await POST(
      form(m.siteId, '_method=PUT&rule=any_change&enabled=false'),
      ctx(m.siteId),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/sites/${m.siteId}`);
    expect(await rulesOf(m.accountId)).toContain(`${m.siteId} any_change false email -`);
  });

  it('sets the override’s channels; Slack on a paid tier only, 402 on Free with nothing written', async () => {
    const paid = await member('slack-paid', 'pro');
    h.user = paid.user;
    const ok = await PUT(
      put(paid.siteId, { rule: 'any_change', channels: ['email', 'slack'] }),
      ctx(paid.siteId),
    );
    expect(ok.status).toBe(200);
    expect(await rulesOf(paid.accountId)).toContain(`${paid.siteId} any_change true email+slack -`);

    const free = await member('slack-free', 'free');
    h.user = free.user;
    h.log.length = 0;
    const no = await PUT(
      put(free.siteId, { rule: 'any_change', channels: ['slack'] }),
      ctx(free.siteId),
    );
    expect(no.status).toBe(402);
    expect(await no.json()).toEqual({ code: 'upgrade_required', gate: 'slack' });
    expect(h.log).not.toContain('supabaseAdmin');
    const back = await POST(
      form(free.siteId, '_method=PUT&rule=any_change&channels=email%2Cslack'),
      ctx(free.siteId),
    );
    expect(back.headers.get('location')).toBe(`/sites/${free.siteId}?notice=upgrade_required`);
    expect(await rulesOf(free.accountId)).toEqual([
      'account any_change true email -',
      'account text_drop true email 10',
    ]);
  });

  it('an override made on Free from an account rule that kept Slack after a downgrade drops Slack', async () => {
    // The account's rule kept Slack (alert_rules_entitlement_check lets an existing one stay); a new
    // row with it would be refused, so the override takes the channels the tier allows.
    const m = await member('downgraded', 'pro', ['email', 'slack']);
    await h.db.query(
      `update public.accounts set state = 'free', tier = 'free', trial_variant = null,
              trial_ends_at = null,
              state_history = state_history || jsonb_build_array(
                jsonb_build_object('state', 'free', 'since', now()))
        where id = $1`,
      [m.accountId],
    );
    h.user = m.user;
    const res = await PUT(put(m.siteId, { rule: 'any_change', enabled: false }), ctx(m.siteId));
    expect(res.status).toBe(200);
    expect(await rulesOf(m.accountId)).toContain(`${m.siteId} any_change false email -`);
  });

  it('answers 404 for another account’s site, a removed site, a malformed id, and a kind the account has no rule of', async () => {
    const mine = await member('mine', 'pro');
    const theirs = await member('theirs', 'pro');
    h.user = mine.user;
    h.log.length = 0;
    const res = await PUT(
      put(theirs.siteId, { rule: 'any_change', enabled: false }),
      ctx(theirs.siteId),
    );
    expect(res.status).toBe(404);
    expect(h.log).not.toContain('supabaseAdmin');
    expect(await rulesOf(theirs.accountId)).toEqual([
      'account any_change true email -',
      'account text_drop true email 10',
    ]);
    // A form for a stranger's site is answered with JSON, not sent back to a page.
    const asForm = await POST(
      form(theirs.siteId, '_method=PUT&rule=any_change&enabled=false'),
      ctx(theirs.siteId),
    );
    expect(asForm.status).toBe(404);

    await h.db.query(`update public.sites set removed_at = now() where id = $1`, [mine.siteId]);
    expect(
      (await PUT(put(mine.siteId, { rule: 'any_change', enabled: false }), ctx(mine.siteId)))
        .status,
    ).toBe(404);
    expect((await PUT(put('not-an-id', { rule: 'any_change' }), ctx('not-an-id'))).status).toBe(
      404,
    );

    const other = await member('nokind', 'pro');
    h.user = other.user;
    const none = await PUT(
      put(other.siteId, { rule: 'new_orphans', enabled: false }),
      ctx(other.siteId),
    );
    expect(none.status).toBe(404);
    expect(await rulesOf(other.accountId)).toHaveLength(2);
  });

  it('answers 404 to a member of a marked account, with no service-role client', async () => {
    const m = await member('marked', 'pro');
    await h.db.query(
      `update public.accounts set deletion_confirmed_at = now(), purge_after = now() + interval '7 days'
        where id = $1`,
      [m.accountId],
    );
    h.user = m.user;
    const res = await PUT(put(m.siteId, { rule: 'any_change', enabled: false }), ctx(m.siteId));
    expect(res.status).toBe(404);
    expect(h.log).not.toContain('supabaseAdmin');
  });

  it.each([
    ['an unknown kind', { rule: 'everything', enabled: false }],
    ['no change asked for', { rule: 'any_change' }],
    ['an account id', { rule: 'any_change', enabled: false, accountId: randomUUID() }],
    ['a site id in the body', { rule: 'any_change', enabled: false, siteId: randomUUID() }],
    ['a threshold', { rule: 'text_drop', enabled: false, threshold_points: 0 }],
    ['no channel', { rule: 'any_change', channels: [] }],
    ['an unknown channel', { rule: 'any_change', channels: ['sms'] }],
    ['a repeated channel', { rule: 'any_change', channels: ['email', 'email'] }],
  ])('refuses %s with 400 before the service role', async (_name, body) => {
    const m = await member('bad', 'pro');
    h.user = m.user;
    h.log.length = 0;
    const res = await PUT(put(m.siteId, body), ctx(m.siteId));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'invalid' });
    expect(h.log).not.toContain('supabaseAdmin');
  });

  it('a POST that does not name PUT is refused with 405, and changes nothing', async () => {
    const m = await member('verb', 'pro');
    h.user = m.user;
    const res = await POST(
      new Request(`${ORIGIN}/api/sites/${m.siteId}/alert-rules`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ rule: 'any_change', enabled: false }),
      }),
      ctx(m.siteId),
    );
    expect(res.status).toBe(405);
    expect(await rulesOf(m.accountId)).toHaveLength(2);
  });
});
